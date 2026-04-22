//! NetraRT Tauri build script.
//!
//! Runs the standard `tauri_build::build()` and emits an extra macOS
//! rpath of `@executable_path/../Frameworks` so both dev (`target/`
//! sibling `Frameworks/` that `tauri_build` auto-stages from
//! `bundle.macOS.frameworks`) and bundled `.app` builds
//! (`Contents/MacOS/` main binary, `Contents/Frameworks/` dylibs)
//! resolve `libsam3.dylib` at load time.

use std::env;

fn main() {
    tauri_build::build();

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" {
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }
}
