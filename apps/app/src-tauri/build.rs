//! NetraRT Tauri build script.
//!
//! Runs the standard `tauri_build::build()` and then copies
//! `libsam3.dylib` from the vendored sam3.c CMake build into the
//! cargo profile output directory, so the `@loader_path` rpath baked
//! by `sam3-sys` resolves when running from `target/<profile>/`.
//!
//! Also emits an additional rpath of `@executable_path/../Frameworks`
//! so bundled `.app` builds (where the main binary sits in
//! `Contents/MacOS/` and the dylib in `Contents/Frameworks/`) can
//! resolve the library too.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();

    // Only macOS is in scope for this milestone. On other platforms,
    // skip dylib copy + extra rpath; `cargo check` should still pass
    // so CI doesn't need macOS to succeed at static analysis.
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "macos" {
        return;
    }

    // Extra rpath so bundled .app finds libsam3 in Contents/Frameworks.
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");

    stage_sam3_dylib();
}

/// Copy libsam3.dylib from vendor/sam3.c/build/ into the cargo profile
/// output dir (e.g. target/debug/) so `@loader_path` resolves at dev-time.
fn stage_sam3_dylib() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());

    // Repo root is three levels above the manifest dir
    // (apps/app/src-tauri -> apps/app -> apps -> repo_root).
    let repo_root = manifest_dir
        .ancestors()
        .nth(3)
        .expect("manifest dir should have a repo root three levels up")
        .to_path_buf();

    let src = repo_root
        .join("vendor")
        .join("sam3.c")
        .join("build")
        .join("libsam3.dylib");

    println!("cargo:rerun-if-changed={}", src.display());

    if !src.is_file() {
        println!(
            "cargo:warning=libsam3.dylib not found at {}; run `pnpm sam3:build` first",
            src.display()
        );
        return;
    }

    let profile_dir = resolve_profile_dir().expect("resolve cargo profile dir");
    let dst = profile_dir.join("libsam3.dylib");

    if should_copy(&src, &dst) {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).expect("create profile dir");
        }
        fs::copy(&src, &dst).unwrap_or_else(|e| {
            panic!("copy {} -> {} failed: {e}", src.display(), dst.display())
        });
        println!("cargo:warning=copied libsam3.dylib to {}", dst.display());
    }
}

/// OUT_DIR looks like `<target>/<profile>/build/<crate>-<hash>/out`.
/// Walk three parents up to reach `<target>/<profile>/`.
fn resolve_profile_dir() -> Option<PathBuf> {
    let out_dir = PathBuf::from(env::var("OUT_DIR").ok()?);
    out_dir.ancestors().nth(3).map(Path::to_path_buf)
}

fn should_copy(src: &Path, dst: &Path) -> bool {
    if !dst.exists() {
        return true;
    }
    let src_mtime = fs::metadata(src).and_then(|m| m.modified()).ok();
    let dst_mtime = fs::metadata(dst).and_then(|m| m.modified()).ok();
    match (src_mtime, dst_mtime) {
        (Some(s), Some(d)) => s > d,
        _ => true,
    }
}
