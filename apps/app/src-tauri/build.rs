//! NetraRT Tauri build script.
//!
//! Runs the standard `tauri_build::build()` and emits an extra macOS
//! rpath of `@executable_path/../Frameworks` so both dev (`target/`
//! sibling `Frameworks/` that `tauri_build` auto-stages from
//! `bundle.macOS.frameworks`) and bundled `.app` builds
//! (`Contents/MacOS/` main binary, `Contents/Frameworks/` dylibs)
//! resolve `libsam3.dylib` at load time.
//!
//! On Windows we also copy `libsam3.dll` from the vendor build dir
//! into the cargo target dir so `netrart.exe` can locate it via the
//! standard DLL search order (same directory as the executable).

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    tauri_build::build();

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" {
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }

    if target_os == "windows" {
        // CARGO_MANIFEST_DIR/../../vendor/sam3.c/build/libsam3.dll
        let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
        let src = manifest_dir
            .join("..")
            .join("..")
            .join("..")
            .join("vendor")
            .join("sam3.c")
            .join("build")
            .join("libsam3.dll");
        if src.is_file() {
            // OUT_DIR = target/<profile>/build/<crate-hash>/out
            // We want target/<profile>/libsam3.dll.
            let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
            let mut profile_dir = out_dir.clone();
            for _ in 0..3 {
                if let Some(parent) = profile_dir.parent() {
                    profile_dir = parent.to_path_buf();
                }
            }
            let dst = profile_dir.join("libsam3.dll");
            if let Err(e) = fs::copy(&src, &dst) {
                println!("cargo:warning=failed to copy {} -> {}: {}", src.display(), dst.display(), e);
            } else {
                println!("cargo:rerun-if-changed={}", src.display());
            }
        } else {
            println!("cargo:warning=libsam3.dll not found at {}; run `pnpm sam3:build` first", src.display());
        }
    }
}