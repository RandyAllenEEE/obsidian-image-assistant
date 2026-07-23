# Changelog

## 5.1.1 - 2026-07-22

### Reference Index and Responsiveness

- Moved V3 index hydration, Markdown/Canvas parsing, reverse-bucket construction, and serialization into a persistent Worker so delayed plugin startup no longer performs the heavy parse on Obsidian's UI thread.
- Prefer a Chromium Blob Web Worker in Obsidian and retain Node `worker_threads` only as a fallback, covering Electron builds whose V8 platform cannot construct Node Workers.
- Added activity-aware warmup, bounded main-thread Vault reads, incremental dirty updates, open-editor overlays, basename lookup buckets, topology reconciliation, and idle atomic persistence.
- Added a single controlled restart for runtime Worker failures with full cache rehydration; environments that support neither transport degrade immediately without repeating the same failed construction.

### Deletion and Menu Safety

- Reused reverse-index inventory generations across deletion phases, added cancellable preflight/progress handling, and limited final checks to changed topology and the target reference buckets.
- Kept source deletion blocked by ordinary fenced-code references, Canvas uncertainty, stale open documents, ambiguous paths, incomplete scans, or changed source revisions.
- Added configurable local deletion destinations, including Obsidian's own trash preference, vault trash, system trash, and a collision-safe custom folder.
- Hid mutation, transfer, batch, and source-deletion menu entries while the index is loading or degraded; execution also rechecks readiness and fails closed if service state changes after the menu opens.
- Made readiness lookup failures non-fatal to Obsidian's official menus and kept safe read-only image actions available where their source context is reliable.
- Removed duplicate reveal, system-explorer, cut, and new-window actions from rendered-image menus, relying on Obsidian's native navigation and editor interactions while keeping URL menus free of empty overflow groups.

### Caption and Layout Responsiveness

- Replaced per-image Reading Mode resize observers with one document-scoped, animation-frame-batched tracker, preventing synchronous measure/write feedback on image-heavy notes.
- Deferred asynchronous section rescans to the next frame, avoided unchanged Reading Mode ownership writes, and made Live Preview settle cycles immune to repeated geometry-signal resets.
- Explicitly remove Live Preview Caption widgets from CodeMirror while a leaf is in Reading Mode, then restore automatic Live Preview ownership when the leaf returns to source rendering.
- Moved Live Preview DOM-to-source resolution into CodeMirror's measured read phase and delayed all plugin DOM mutations until its write phase; reduced geometry observers and quantized visual offsets to avoid editor measure-loop feedback.
- Added deterministic block-widget height estimates and deferred image reconciliation beyond the mode-change measure cycle, preventing viewport restabilization loops when returning from Reading Mode to Live Preview.

### Networking and Delivery

- Unified remote deletion with the abortable Electron HTTP transport, bounded response handling, redirect rejection, timeout cancellation, and ownership-history validation.
- Preserved current V3 cache compatibility and the canonical `obsidian-image-assistant` plugin identity; no settings or note migration is required.
- Passed lint, source and test TypeScript checks, focused recovery/menu regressions, and the full automated delivery pipeline. Runtime smoke was intentionally not executed for this release.

## 5.1.0 - 2026-07-20

### Source-Aware Editing and Layout

- Bound paste, drop, OCR, LaTeX, resize, and image-property updates to the originating editor, file, view, document, and tracked source range instead of the active pane.
- Added CodeMirror-mapped async ranges so edits before a loading placeholder or uploaded URL no longer detach the eventual replacement; user edits inside a managed range are preserved.
- Made editor mutations transactional with stale-range validation, owner-view saves, conditional rollback, rollback persistence, and explicit uncertain outcomes.
- Unified single-sided dimensions as `|W` and `|xH`, clearing stale opposite dimensions and preserving the image's intrinsic aspect ratio.
- Made insertion-size units explicit and conditional in settings, with `px/%` field labels and immediate unit refresh so a fixed width such as 500 cannot be mistaken for 500%.
- Made interactive resize commit once at drag or wheel completion while preserving captions, titles, alignment, wrapping, empty pipes, and existing PipeSyntax ordering.
- Stabilized Live Preview image and Caption binding across side-panel movement, view changes, duplicate URLs, tabs, lists, callouts, `ad-*` Admonitions, Minimal theme logical margins, and popouts.

### Menus and Reference Workflows

- Rebuilt rendered-image and file-manager context menus around source-first resolution, capability policies, shared handlers, compact action groups, and one lifecycle-managed coordinator.
- Preserved original URL identity when Obsidian or another plugin renders a proxy, cached, or Blob URL; destructive actions still require an exact source binding.
- Added the public Obsidian menu bridge needed for Live Preview URL images while keeping Image Assistant actions in one dedicated section.
- Consolidated note, folder, and vault batch launchers and all nine scope/mode combinations around shared range discovery.
- Replaced note-local mass actions with a reusable full-vault decision workflow for clicked-reference, mutable-reference, and source-object operations.
- Split mutable, protected-fence, out-of-boundary, Canvas, failed, and uncertain references so confirmations explain the actual deletion constraint.

### Safety, Performance, and Networking

- Added a persistent, versioned reference index with bounded background construction, dirty-file refresh, open-editor overlays, and generation revalidation before destructive changes.
- Kept ordinary fenced code in every deletion-safety scan even when code-block mutation is disabled; incomplete Markdown or Canvas scans continue to preserve source objects.
- Added source-revision and SHA-256 checks plus per-path FIFO commit locks for crop, annotation, conversion, rename, and binary writes.
- Added compatibility-copy protection when a moved image cannot have every old reference repaired.
- Added Electron streaming downloads with redirect revalidation, abort support, total and idle timeouts, and a hard 100 MiB chunk limit, with a documented constrained `requestUrl` fallback.
- Treated extensionless Canvas and Markdown URLs as unverified candidates and created files only after status, MIME, size, and magic-byte validation.

### Naming, Settings, and Maintenance

- Added a tokenized naming engine with one operation snapshot, lazy source evaluation, non-recursive replacement, validated MD5/SHA lengths, Web Crypto randomness, and persistent atomic counters.
- Centralized path planning, Unicode normalization, reserved-name handling, extension correction, and conflict strategies across paste, drop, rename, and attachment writes.
- Made local link serialization consistently honor Markdown/Wiki, shortest/relative/absolute, and relative `./` settings while preserving PipeSyntax and quoted titles.
- Removed the obsolete hidden-folder setting and exposed the independent interactive-resize controls.
- Hardened modal generation guards, binary resource refresh, upload history validation, popout cleanup, and batch preparation against duplicate starts.
- Locked the canonical plugin ID to `obsidian-image-assistant` and added manifest-driven local deployment validation.

### Verification

- Added regression coverage for source mapping, async placeholders, save rollback, naming sessions, reference indexing, streaming fetches, context-menu event order, split panes, popouts, batch preparation, and revision-guarded edits.
- Passed 1,322 tests across 145 files with 80.22% line coverage and 77.88% branch coverage.
- Passed lint, source and test TypeScript checks, production build validation, release metadata checks, and `npm audit --omit=optional` with zero vulnerabilities.
- Obsidian runtime smoke was intentionally not executed for this release preparation pass.

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
