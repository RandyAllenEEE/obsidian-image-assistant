# Changelog

## 5.0.0 - 2026-07-13

### Major Changes

- Unified current-note, selected-folder, and full-vault operations across local conversion, cloud upload, and network download in one cancellable batch workflow.
- Removed duplicate legacy batch backends and undocumented proxy APIs; the supported workflow is now the unified modal and headless workers.
- Upgraded annotation to Fabric 7.4.0 with explicit object origins and updated event/type handling.
- Raised the minimum supported Obsidian version to 1.11.4 and standardized the build target on ES2022.

### Data Safety

- Added `ProcessedImageResult` with verified output data, MIME type, extension, outcome, and reason so original bytes are never mislabeled as a converted format.
- Added magic-byte validation for conversion, crop, annotation, upload, and download outputs.
- Added detailed Markdown, Wiki, URL, code-block, and Canvas reference scans with complete/failed/uncertain results.
- Made conversion, upload, download, context-menu deletion, and unused-file cleanup preserve source objects whenever scanning or replacement is incomplete.
- Added a second reference verification immediately before destructive deletion and explicit confirmation for zero-reference deletion.
- Kept partial successes without automatic rollback while reporting exactly which files succeeded, failed, or remained uncertain.

### Paste, Replacement, and Captions

- Fixed local image paste/drop by deferring `preventDefault()` until a handler confirms it will process every file.
- Added shared guarded editor placeholder replacement for OCR, LaTeX, and upload workflows.
- Added shared image reference replacement that preserves Markdown/Wiki syntax, alt text, titles, pipe attributes, dimensions, URL queries, and paths containing spaces.
- Rebuilt caption rendering around an idempotent resolver/DOM renderer for Live Preview, Reading Mode, local and network images, and flexible pipe syntax ordering.
- Replaced direct CodeMirror DOM mutation with managed caption decorations, preventing a render loop on Obsidian 1.11.4 while keeping Source Mode free of visible caption widgets.
- Preserved native image `alt` and `title` attributes and added main-window/popout document cleanup.
- Added shared source-aware Caption scanning for callouts and `ad-*` Admonitions, incremental Live Preview updates, renderer ownership isolation, and all-leaf refresh across splits and popouts.
- Added Reading/Live Preview toggles, inline-image policy, image/container width behavior, line clamping, a live settings preview, and a style-only reset.
- Unified image and Caption alignment precedence so captions follow explicit PipeSyntax and image defaults before using the Caption fallback; repeated network URLs in Live Preview now resolve through exact CodeMirror source positions.
- Replaced duplicate image/embed float classes with one layout owner, including safe standalone wrap fallback, Resize ownership transfer, Source Mode cleanup, and split/popout observers.
- Processed the initial Live Preview image snapshot whenever an observer attaches, so network-image PipeSyntax size and alignment cannot lag behind an already-rendered Caption after startup, mode switches, splits, or popout creation.
- Bound auto-width Live Preview Caption boxes to the precisely matched image's rendered left edge and width, including images without a Pipe size, avoiding theme-dependent CodeMirror block-widget centering drift.

### Batch and Network

- Added bounded concurrency through `global.batchConcurrency`, with migration from the legacy cloud upload concurrency setting.
- Added cancellation, stable task ordering, duplicate-action protection, and detailed result modals across all nine batch combinations.
- Added format-aware downloads for PNG, JPEG, GIF, WebP, BMP, ICO, TIFF, AVIF, HEIC, HEIF, and SVG, correcting misleading URL extensions from verified bytes.
- Added safe `reuse`, `increment`, `skip`, and `overwrite` behavior with Undo that deletes created files, restores overwritten bytes, and leaves reused/skipped files untouched.
- Added 60-second upload/download/delete timeouts, a 100 MiB download limit, response validation, exact/subdomain blacklist matching, DNS/IP checks, and documented redirect-validation limitations.

### OCR and Settings

- Added 120-second abortable OCR/LaTeX requests with non-2xx, empty response, and schema validation for SimpleTex, Pix2Tex, Texify, OpenAI-compatible, and Ollama providers.
- Added Pix2Tex and Texify HTTP Basic Auth settings backed by Obsidian Secret Storage, including migration from legacy plaintext passwords.
- Exposed all existing caption style fields plus cleaner file types/custom trash, paste cursor/ignore patterns, editor width constraints, and direct external-tool path settings.
- Added structure-aware settings merge and normalization so malformed JSON, nulls, invalid arrays, enums, dimensions, opacity, presets, and concurrency values fall back safely.
- Hardened upload history validation, deduplication, immutable reads, FIFO writes, atomic replacement, startup degradation, and failure recovery.

### Lifecycle and Delivery

- Fixed caption observer loops, stale preview results, annotation intervals, Blob URL leaks, deferred embed observers, unload races, and popout context-menu listener retention.
- Added a zero-dependency DevTools runtime smoke test and verified plugin load, local paste/drop, all nine batch entries, Reading/Live Preview captions, Fabric canvas rendering, settings, commands, and lifecycle cleanup on Obsidian 1.11.4 and 1.12.7.
- Added fail-safe command guards for Markdown/Canvas scopes and Markdown-only frontmatter configuration.
- Updated Vitest/coverage to 3.2.7 and happy-dom to 20.10.6; removed obsolete type/UI packages and resolved non-optional dependency audit findings.
- Unified CI and release checks around lint, source/test TypeScript, coverage, production build, release metadata verification, and `npm audit --omit=optional`.
- Added 1,059 automated tests across 118 files with 76.73% global line coverage at release preparation time.

### Compatibility Notes

- This release remains desktop-only.
- Obsidian's `requestUrl` does not expose the final redirect destination, so redirected network targets cannot be fully revalidated.
- External PicGo/PicList, OCR providers, FFmpeg/pngquant binaries, operating-system trash behavior, paste/drop input, Fabric editing, and destructive batch confirmations still require environment-specific smoke testing.

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
