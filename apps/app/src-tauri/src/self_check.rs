//! Headless smoke test: verifies the staged PocketBase sidecar is the
//! correct architecture and the sam3 dylib loads, then exits.
//!
//! Invoked by `NetraRT --self-check` (or `NetraRT.exe --self-check`).
//! Used by CI install-rehearsal jobs across all platforms.

use std::path::PathBuf;
use std::process::Command;

pub fn run() -> ! {
    let mut failures = Vec::new();

    // 1. sam3 — calling its version function exercises dylib load + symbol resolve.
    match std::panic::catch_unwind(|| sam3::version().to_string()) {
        Ok(v) => eprintln!("[self-check] sam3 version: {v}"),
        Err(_) => failures.push("sam3 dylib load failed".to_string()),
    }

    // 2. pocketbase — locate the sidecar that ships next to the executable
    // and run `pocketbase --version`. Don't actually start the server.
    let exe = std::env::current_exe().expect("current_exe");
    let exe_dir = exe.parent().expect("exe parent").to_path_buf();
    let pb_path = locate_pocketbase(&exe_dir);

    match pb_path {
        Some(path) => {
            let out = Command::new(&path).arg("--version").output();
            match out {
                Ok(o) if o.status.success() => {
                    let stdout = String::from_utf8_lossy(&o.stdout);
                    eprintln!("[self-check] pocketbase: {}", stdout.trim());
                }
                Ok(o) => failures.push(format!(
                    "pocketbase exited with status {:?}: {}",
                    o.status,
                    String::from_utf8_lossy(&o.stderr).trim()
                )),
                Err(e) => failures.push(format!("pocketbase invocation failed: {e}")),
            }
        }
        None => failures.push(format!("pocketbase sidecar not found near {}", exe_dir.display())),
    }

    if failures.is_empty() {
        eprintln!("[self-check] OK");
        std::process::exit(0);
    }
    for f in &failures {
        eprintln!("[self-check] FAIL: {f}");
    }
    std::process::exit(1);
}

fn locate_pocketbase(exe_dir: &std::path::Path) -> Option<PathBuf> {
    // Tauri stages externalBin as `pocketbase(.exe)` next to the main
    // executable; source trees and older bundles may still use the
    // target-suffixed `pocketbase-*` form.
    let entries = std::fs::read_dir(exe_dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let (prefix, suffix) = if cfg!(windows) {
            ("pocketbase-", ".exe")
        } else {
            ("pocketbase-", "")
        };
        let exact_name = if cfg!(windows) { "pocketbase.exe" } else { "pocketbase" };
        if name_str == exact_name || (name_str.starts_with(prefix) && name_str.ends_with(suffix)) {
            return Some(entry.path());
        }
    }
    None
}
