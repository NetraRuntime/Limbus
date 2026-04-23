use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

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
