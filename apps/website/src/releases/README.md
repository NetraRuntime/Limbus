# Release / auto-update server (placeholder)

Not implemented. This directory reserves the location for the release
and delta-update system that serves signed update manifests to the
Tauri desktop app.

Goals for the future design:
- Manifest endpoint the Tauri updater polls.
- Delta packaging — ship only changed files, not full installers.
- Signing + rollback story.

Out of scope for the current monorepo restructure (scope A).
