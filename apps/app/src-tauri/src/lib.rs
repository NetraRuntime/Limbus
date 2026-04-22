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
    // If something is already serving on 8090, reuse it rather than fighting
    // over the port — common during dev when the user already has
    // `pnpm db:start` running in another shell.
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

    // Bundled migrations ship alongside the app under `Resources/pb_migrations`
    // (mapped from `../pb/pb_migrations` by tauri.conf.json). Point PB at that
    // directory so it auto-applies any new migrations on first boot — no
    // copying into pb_data, no manual setup step.
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

    // Drain the sidecar's stdout/stderr so its pipe buffer never fills up
    // (which would wedge PocketBase). Forward everything to our own stderr
    // so `tauri dev` shows PB logs alongside Vite.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(PocketBaseProcess::default())
        .invoke_handler(tauri::generate_handler![pb_url])
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
