# Changelog

## 4.3.0 - 2026-06-16

### Stability

- Fixed AVIF encoder detection so manual detection probes the current FFmpeg binary instead of reusing a stale saved encoder.
- Added safer vault configuration reads with fallback values when Obsidian or tests do not expose `vault.getConfig`.
- Added Markdown view guards for local and cloud paste handlers to avoid crashes when a paste event fires without an active Markdown editor.
- Made image context menu handling respect events already handled by other plugins.
- Rendered delete confirmation reference previews as plain text so note content cannot be interpreted as modal HTML.
- Validated PicList delete responses before treating them as successful or failed API payloads.

### Maintenance

- Replaced the current-note network upload fallback dynamic `require()` with a static uploader import.
- Removed the tracked `ContextMenu.ts.backup` source backup file to keep source searches and release contents clean.

### Tests

- Added regression coverage for forced AVIF detection, vault config fallbacks, context menu event guards, delete confirmation text rendering, paste view guards, and invalid PicList delete responses.
