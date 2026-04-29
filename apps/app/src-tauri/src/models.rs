//! HF model manager — lists, downloads, emits `model-download-progress` events.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;

const HF_REPO: &str = "Rifky/SAM3";
const MODEL_EXT: &str = "sam3";
const MODELS_DIRNAME: &str = "models";
/// Keep in sync with apps/app/src/components/ModelsTab.tsx.
const PROGRESS_EVENT: &str = "model-download-progress";

/// AtomicBool so the streaming loop can poll without taking the outer mutex per chunk.
#[derive(Default)]
pub struct ModelDownloads(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Debug, Serialize, Deserialize)]
struct HfTreeEntry {
    #[serde(rename = "type")]
    kind: String,
    path: String,
    size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModel {
    pub name: String,
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    pub name: String,
    pub size: u64,
    pub path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "phase", rename_all = "camelCase")]
enum ProgressPayload {
    #[serde(rename_all = "camelCase")]
    Started { name: String, total: u64 },
    #[serde(rename_all = "camelCase")]
    Progress {
        name: String,
        downloaded: u64,
        total: u64,
    },
    #[serde(rename_all = "camelCase")]
    Done { name: String, total: u64 },
    #[serde(rename_all = "camelCase")]
    Cancelled { name: String },
    #[serde(rename_all = "camelCase")]
    Error { name: String, message: String },
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data_dir: {e}"))?
        .join(MODELS_DIRNAME);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Rejects anything that could escape the models dir or target the BPE vocab.
fn validate_filename(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
    {
        return Err(format!("invalid filename: {name:?}"));
    }
    if !name.ends_with(&format!(".{MODEL_EXT}")) {
        return Err(format!("only .{MODEL_EXT} files are downloadable: {name:?}"));
    }
    Ok(())
}

#[tauri::command]
pub fn models_dir_path(app: AppHandle) -> Result<String, String> {
    Ok(models_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn models_list_local(app: AppHandle) -> Result<Vec<LocalModel>, String> {
    let dir = models_dir(&app)?;
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(out),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        if ext != MODEL_EXT {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        out.push(LocalModel {
            name: name.to_string(),
            size,
            path: path.to_string_lossy().to_string(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub async fn models_list_remote() -> Result<Vec<RemoteModel>, String> {
    let url = format!("https://huggingface.co/api/models/{HF_REPO}/tree/main");
    let client = reqwest::Client::builder()
        .user_agent("netrart/0.1")
        .build()
        .map_err(|e| format!("reqwest client: {e}"))?;
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("hf list request: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("hf list status: {}", res.status()));
    }
    let entries: Vec<HfTreeEntry> = res
        .json()
        .await
        .map_err(|e| format!("hf list parse: {e}"))?;
    let mut out: Vec<RemoteModel> = entries
        .into_iter()
        .filter(|e| e.kind == "file" && e.path.ends_with(&format!(".{MODEL_EXT}")))
        .map(|e| RemoteModel {
            name: e.path.clone(),
            size: e.size,
            url: format!("https://huggingface.co/{HF_REPO}/resolve/main/{}", e.path),
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub fn models_delete(app: AppHandle, name: String) -> Result<(), String> {
    validate_filename(&name)?;
    let dir = models_dir(&app)?;
    let path = dir.join(&name);
    // Resolve and confirm the candidate path is still inside the models
    // dir — defensive check against a name that survived `validate_filename`
    // but somehow points outside (e.g. via a future filename extension).
    if path.parent() != Some(&dir) {
        return Err(format!("refusing to delete outside models dir: {name}"));
    }
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_file(&path)
        .map_err(|e| format!("remove {}: {e}", path.display()))?;
    Ok(())
}

#[tauri::command]
pub fn models_cancel_download(
    state: State<'_, ModelDownloads>,
    name: String,
) -> Result<(), String> {
    let map = state.0.lock().map_err(|e| format!("lock: {e}"))?;
    if let Some(flag) = map.get(&name) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub async fn models_download(
    app: AppHandle,
    state: State<'_, ModelDownloads>,
    name: String,
    url: String,
) -> Result<(), String> {
    validate_filename(&name)?;
    if !url.starts_with("https://huggingface.co/") {
        return Err(format!("refusing non-huggingface url: {url}"));
    }

    let dir = models_dir(&app)?;
    let final_path = dir.join(&name);
    let tmp_path = dir.join(format!("{name}.part"));

    // Register a fresh cancel flag. If a download is already in-flight for
    // this name, refuse — the partial file is owned by the live task and
    // racing two writers corrupts it.
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = state.0.lock().map_err(|e| format!("lock: {e}"))?;
        if map.contains_key(&name) {
            return Err(format!("download already in progress: {name}"));
        }
        map.insert(name.clone(), cancel.clone());
    }

    let result = stream_to_file(&app, &name, &url, &tmp_path, &final_path, cancel.clone()).await;

    // Always release the slot, even on error / cancel.
    {
        let mut map = state.0.lock().map_err(|e| format!("lock: {e}"))?;
        map.remove(&name);
    }

    match result {
        Ok(total) => {
            let _ = app.emit(PROGRESS_EVENT, ProgressPayload::Done { name, total });
            Ok(())
        }
        Err(DownloadError::Cancelled) => {
            // Best-effort cleanup of the partial; ignore errors (file may
            // already be gone if the writer never opened it).
            let _ = std::fs::remove_file(&tmp_path);
            let _ = app.emit(PROGRESS_EVENT, ProgressPayload::Cancelled { name });
            Ok(())
        }
        Err(DownloadError::Other(message)) => {
            let _ = std::fs::remove_file(&tmp_path);
            let _ = app.emit(
                PROGRESS_EVENT,
                ProgressPayload::Error {
                    name,
                    message: message.clone(),
                },
            );
            Err(message)
        }
    }
}

enum DownloadError {
    Cancelled,
    Other(String),
}

impl<E: std::fmt::Display> From<E> for DownloadError {
    fn from(value: E) -> Self {
        DownloadError::Other(value.to_string())
    }
}

async fn stream_to_file(
    app: &AppHandle,
    name: &str,
    url: &str,
    tmp_path: &std::path::Path,
    final_path: &std::path::Path,
    cancel: Arc<AtomicBool>,
) -> Result<u64, DownloadError> {
    let client = reqwest::Client::builder()
        .user_agent("netrart/0.1")
        .build()
        .map_err(|e| DownloadError::Other(format!("reqwest client: {e}")))?;

    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| DownloadError::Other(format!("hf get: {e}")))?;
    if !res.status().is_success() {
        return Err(DownloadError::Other(format!(
            "hf download status: {}",
            res.status()
        )));
    }
    // Content-Length absent on chunked transfers; UI shows an
    // indeterminate bar in that case.
    let total = res.content_length().unwrap_or(0);

    let _ = app.emit(
        PROGRESS_EVENT,
        ProgressPayload::Started {
            name: name.to_string(),
            total,
        },
    );

    let mut file = tokio::fs::File::create(tmp_path)
        .await
        .map_err(|e| DownloadError::Other(format!("create {}: {e}", tmp_path.display())))?;

    let mut stream = res.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;
    // Emit at most ~one progress event per ~256 KiB of new bytes to keep
    // the IPC channel from saturating on a multi-GB download.
    const PROGRESS_STEP: u64 = 256 * 1024;

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            // Drop the file handle so the OS releases the .part file
            // before we try to remove it.
            drop(file);
            return Err(DownloadError::Cancelled);
        }
        let bytes = chunk.map_err(|e| DownloadError::Other(format!("hf stream: {e}")))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| DownloadError::Other(format!("write {}: {e}", tmp_path.display())))?;
        downloaded += bytes.len() as u64;
        if downloaded - last_emit >= PROGRESS_STEP {
            last_emit = downloaded;
            let _ = app.emit(
                PROGRESS_EVENT,
                ProgressPayload::Progress {
                    name: name.to_string(),
                    downloaded,
                    total,
                },
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| DownloadError::Other(format!("flush {}: {e}", tmp_path.display())))?;
    drop(file);

    // Atomic rename into place — a crash mid-download leaves only the
    // .part file behind, never a corrupt .sam3 the worker would try to
    // load.
    std::fs::rename(tmp_path, final_path).map_err(|e| {
        DownloadError::Other(format!(
            "rename {} -> {}: {e}",
            tmp_path.display(),
            final_path.display()
        ))
    })?;

    Ok(downloaded)
}
