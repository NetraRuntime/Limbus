mod sam3_worker;

use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use sam3_worker::{SegmentResponse, WorkerHandle};

const PB_HOST: &str = "127.0.0.1";
const PB_PORT: u16 = 8090;

#[derive(Default)]
struct PocketBaseProcess(Mutex<Option<CommandChild>>);

fn port_in_use() -> bool {
    TcpStream::connect_timeout(
        &format!("{PB_HOST}:{PB_PORT}").parse().unwrap(),
        Duration::from_millis(200),
    )
    .is_ok()
}

fn start_pocketbase(app: &AppHandle) -> Result<CommandChild, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data_dir: {e}"))?
        .join("pb_data");
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("create pb_data dir {}: {e}", data_dir.display()))?;

    let migrations_dir = app
        .path()
        .resolve("pb_migrations", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("resolve pb_migrations resource: {e}"))?;

    let http_addr = format!("{PB_HOST}:{PB_PORT}");
    let data_arg = data_dir.to_string_lossy().to_string();
    let migrations_arg = migrations_dir.to_string_lossy().to_string();

    let sidecar = app
        .shell()
        .sidecar("pocketbase")
        .map_err(|e| format!("resolve pocketbase sidecar: {e}"))?
        .args([
            "serve",
            "--http",
            &http_addr,
            "--dir",
            &data_arg,
            "--migrationsDir",
            &migrations_arg,
        ]);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("spawn pocketbase: {e}"))?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    eprintln!("[pocketbase] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[pocketbase] terminated: {status:?}");
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

#[tauri::command]
fn pb_url() -> String {
    format!("http://{PB_HOST}:{PB_PORT}")
}

#[tauri::command]
fn sam3_version() -> String {
    sam3::version().to_string()
}

#[tauri::command]
async fn sam3_encode_image(
    app: AppHandle,
    worker: State<'_, WorkerHandle>,
    id: String,
    collection_id: String,
    file: String,
) -> Result<(), String> {
    let src_path = resolve_pb_file_path(&app, &id, &collection_id, &file)?;
    eprintln!("[sam3] encode queued: id={id} path={}", src_path.display());
    let w = worker.inner().clone();
    let id_log = id.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || w.encode_image_blocking(id, src_path))
            .await
            .map_err(|e| format!("join worker: {e}"))?;
    match &result {
        Ok(()) => eprintln!("[sam3] encode done: id={id_log}"),
        Err(e) => eprintln!("[sam3] encode failed: id={id_log}: {e}"),
    }
    result
}

/// Resolve the local PocketBase storage path for an uploaded file.
///
/// Rejects identifiers containing path separators or `..` so a crafted
/// record can't escape the pb_data sandbox. PocketBase only produces
/// `[a-z0-9]{15}` ids in practice, so real records are always accepted.
fn resolve_pb_file_path(
    app: &AppHandle,
    id: &str,
    collection_id: &str,
    file: &str,
) -> Result<PathBuf, String> {
    for (label, s) in [("id", id), ("collection_id", collection_id), ("file", file)] {
        if s.is_empty() || s.contains('/') || s.contains('\\') || s == "." || s == ".." {
            return Err(format!("invalid {label}: {s:?}"));
        }
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data_dir: {e}"))?;
    let path = data_dir
        .join("pb_data/storage")
        .join(collection_id)
        .join(id)
        .join(file);
    if !path.exists() {
        return Err(format!("pb file not found: {}", path.display()));
    }
    Ok(path)
}

#[tauri::command]
async fn sam3_delete_image_cache(
    worker: State<'_, WorkerHandle>,
    id: String,
) -> Result<(), String> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.delete_cache_blocking(id))
        .await
        .map_err(|e| format!("join worker: {e}"))?
}

#[tauri::command]
async fn sam3_cache_status(
    worker: State<'_, WorkerHandle>,
    id: String,
) -> Result<bool, String> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.cache_status_blocking(id))
        .await
        .map_err(|e| format!("join worker: {e}"))?
}

#[tauri::command]
async fn sam3_warmup(worker: State<'_, WorkerHandle>) -> Result<(), String> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.warmup_blocking())
        .await
        .map_err(|e| format!("join worker: {e}"))?
}

#[tauri::command]
async fn sam3_segment_text(
    app: AppHandle,
    worker: State<'_, WorkerHandle>,
    id: String,
    collection_id: String,
    file: String,
    text: String,
) -> Result<SegmentResponse, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("empty text prompt".to_string());
    }
    let src_path = resolve_pb_file_path(&app, &id, &collection_id, &file)?;
    eprintln!("[sam3] segment text: id={id} text={trimmed:?}");
    let w = worker.inner().clone();
    let prompt = trimmed.to_string();
    let id_log = id.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || w.segment_text_blocking(id, src_path, prompt))
            .await
            .map_err(|e| format!("join worker: {e}"))?;
    match &result {
        Ok(r) => eprintln!("[sam3] segment text done: id={id_log} masks={}", r.masks.len()),
        Err(e) => eprintln!("[sam3] segment text failed: id={id_log}: {e}"),
    }
    result
}

/// Segment using a bounding-box prompt. `bbox` is `[x1, y1, x2, y2]` in
/// **normalized `[0, 1]` coordinates** relative to the source image — the
/// worker scales them to libsam3's prompt coordinate space. Normalized input
/// keeps the frontend decoupled from libsam3's internal resize dimensions.
#[tauri::command]
async fn sam3_segment_box(
    app: AppHandle,
    worker: State<'_, WorkerHandle>,
    id: String,
    collection_id: String,
    file: String,
    bbox: [f32; 4],
) -> Result<SegmentResponse, String> {
    let [x1, y1, x2, y2] = bbox;
    for (label, v) in [("x1", x1), ("y1", y1), ("x2", x2), ("y2", y2)] {
        if !v.is_finite() || !(0.0..=1.0).contains(&v) {
            return Err(format!("bbox {label} out of [0, 1]: {v}"));
        }
    }
    if x2 <= x1 || y2 <= y1 {
        return Err(format!("bbox has non-positive extent: [{x1}, {y1}, {x2}, {y2}]"));
    }
    let src_path = resolve_pb_file_path(&app, &id, &collection_id, &file)?;
    eprintln!("[sam3] segment box: id={id} bbox=[{x1:.3}, {y1:.3}, {x2:.3}, {y2:.3}]");
    let w = worker.inner().clone();
    let id_log = id.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || w.segment_box_blocking(id, src_path, bbox))
            .await
            .map_err(|e| format!("join worker: {e}"))?;
    match &result {
        Ok(r) => eprintln!("[sam3] segment box done: id={id_log} masks={}", r.masks.len()),
        Err(e) => eprintln!("[sam3] segment box failed: id={id_log}: {e}"),
    }
    result
}

/// Ordered list of model-file candidates tried on first use.
///
/// 1. `SAM3_MODEL_PATH` env override.
/// 2. `{app_data_dir}/models/sam3_mobileclip_s0.sam3` — user-placed.
/// 3. Debug-build fallback to the vendored file under the workspace so
///    `pnpm tauri:dev` works without extra setup.
fn resolve_model_candidates(app: &AppHandle) -> Vec<Option<PathBuf>> {
    let mut out: Vec<Option<PathBuf>> = Vec::new();
    out.push(std::env::var_os("SAM3_MODEL_PATH").map(PathBuf::from));
    out.push(
        app.path()
            .app_data_dir()
            .ok()
            .map(|d| d.join("models").join("sam3_mobileclip_s0.sam3")),
    );
    if cfg!(debug_assertions) {
        // CARGO_MANIFEST_DIR is apps/app/src-tauri; walk up to repo root.
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        out.push(
            manifest
                .ancestors()
                .nth(3)
                .map(|root| root.join("vendor/sam3.c/models/sam3_mobileclip_s0.sam3")),
        );
    }
    out
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EntryInfo {
    absolute_path: String,
    relative_path: String,
    size: u64,
    extension: String,
}

fn is_supported_ext(ext: &str) -> bool {
    matches!(
        ext,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "bmp" | "heic" | "heif" | "svg" |
        "mp4" | "webm" | "mov" | "m4v" | "mkv" | "ogv" | "avi" | "3gp" |
        "zip"
    )
}

fn walk_into(
    root_name: &str,
    absolute: &std::path::Path,
    out: &mut Vec<EntryInfo>,
) -> std::io::Result<()> {
    let meta = std::fs::metadata(absolute)?;
    if meta.is_file() {
        let ext = absolute
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        if !is_supported_ext(&ext) {
            return Ok(());
        }
        let relative = root_name.to_string();
        out.push(EntryInfo {
            absolute_path: absolute.to_string_lossy().to_string(),
            relative_path: relative,
            size: meta.len(),
            extension: ext,
        });
        return Ok(());
    }
    if !meta.is_dir() {
        return Ok(());
    }
    fn walk_dir(
        prefix: &str,
        dir: &std::path::Path,
        out: &mut Vec<EntryInfo>,
    ) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let next_prefix = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let ft = entry.file_type()?;
            if ft.is_dir() {
                walk_dir(&next_prefix, &path, out)?;
            } else if ft.is_file() {
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_default();
                if !is_supported_ext(&ext) {
                    continue;
                }
                let size = std::fs::metadata(&path)?.len();
                out.push(EntryInfo {
                    absolute_path: path.to_string_lossy().to_string(),
                    relative_path: next_prefix,
                    size,
                    extension: ext,
                });
            }
        }
        Ok(())
    }
    walk_dir(root_name, absolute, out)?;
    Ok(())
}

#[tauri::command]
fn scan_paths(paths: Vec<String>) -> Result<Vec<EntryInfo>, String> {
    let mut out = Vec::new();
    for p in paths {
        let path = std::path::PathBuf::from(&p);
        let root_name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| p.clone());
        walk_into(&root_name, &path, &mut out).map_err(|e| format!("scan {p}: {e}"))?;
    }
    Ok(out)
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(PocketBaseProcess::default())
        .invoke_handler(tauri::generate_handler![
            pb_url,
            sam3_version,
            sam3_warmup,
            sam3_encode_image,
            sam3_delete_image_cache,
            sam3_cache_status,
            sam3_segment_text,
            sam3_segment_box,
            scan_paths,
            read_file_bytes,
        ])
        .setup(|app| {
            if port_in_use() {
                eprintln!("[pocketbase] {PB_HOST}:{PB_PORT} already bound — skipping sidecar, using existing instance");
            } else {
                let handle = app.handle().clone();
                match start_pocketbase(&handle) {
                    Ok(child) => {
                        let state: State<PocketBaseProcess> = app.state();
                        *state.0.lock().unwrap() = Some(child);
                    }
                    Err(err) => eprintln!("failed to start pocketbase: {err}"),
                }
            }

            let handle = app.handle();
            let model_candidates = resolve_model_candidates(handle);
            let bpe_path = handle
                .path()
                .resolve(
                    "models/bpe_simple_vocab_16e6.txt.gz",
                    tauri::path::BaseDirectory::Resource,
                )
                .ok();
            let cache_dir = handle
                .path()
                .app_data_dir()
                .map_err(|e| format!("resolve app_data_dir: {e}"))?
                .join("sam3_cache");
            let worker = sam3_worker::spawn(model_candidates, bpe_path, cache_dir);
            app.manage(worker);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building NetraRT")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                let state: State<PocketBaseProcess> = app.state();
                let child = state.0.lock().unwrap().take();
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        });
}
