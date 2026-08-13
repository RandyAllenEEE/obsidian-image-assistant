# Image Assistant for Obsidian

**Image Assistant** is a powerful all-in-one image management plugin for Obsidian, deeply integrating **local image processing**, **cloud image hosting**, and **OCR recognition**. It seamlessly handles everything from paste to publish.

> This plugin is built upon and inspired by **[Image Converter](https://github.com/xRyul/obsidian-image-converter)**, **[Image Auto Upload](https://github.com/renmu123/obsidian-image-auto-upload-plugin)**, and **[Image2LaTEX](https://github.com/Hugo-Persson/obsidian-ocrlatex)**.

---

## ✨ Highlights

- 🖼️ **Local Processing** — Convert, compress, resize, and rename images directly in your vault. WEBP, PNG, JPEG, AVIF, HEIC, TIFF, BMP, GIF, SVG supported.
- ☁️ **Cloud Upload** — Upload to PicGo/PicList with one click. Batch upload entire notes, folders, or your whole vault.
- 🔍 **Smart Reference Tracking** — Automatically updates every image link across your vault when files are renamed or replaced.
- ✂️ **OCR & LaTeX** — Extract text and math from clipboard images using LLM, SimpleTex, Texify, or Pix2Tex.
- 🎨 **Annotation & Editing** — Draw, arrow, stamp, and markup images directly within Obsidian.
- 📐 **Native Resize** — Uses Obsidian 1.13.4's Live Preview image resize interaction and canonical pipe dimensions.
- 🖼️ **Image Alignment** — Align images left/center/right with optional text wrap.
- 📝 **Captions** — Auto-extract and render image alt-text as elegant captions.
- 🧹 **Unused File Cleaner** — Find and remove unreferenced attachments.
- 🌐 **Network Image Download** — One-click download of online images into your vault.
- 🔷 **Drawing Engines** — Create Draw.io diagrams in the built-in workspace or bridge to the native Excalidraw plugin without bundling either editor runtime.

---

## What's New in v6.0.0

Version 6.0.0 adds first-class drawing workflows and makes Obsidian's native image layout the single source of truth.

1. **Draw.io workspace**: Create and edit `.drawio.svg` diagrams through a configurable standard embed endpoint, with revision-aware Vault saves and optional Next AI Draw.io assistance.
2. **Excalidraw bridge**: Create and reopen native Excalidraw drawings through the separately installed plugin's public automation API, without bundling React or Excalidraw.
3. **Unified image layout**: Local files, network images, Draw.io SVG, and Excalidraw source/preview renders share the same alignment and Caption ownership rules.
4. **Obsidian-native resize**: The custom drag handles, wheel listener, reading-mode visual resize, cursor relocation, and related settings were removed. Live Preview resizing is now owned by Obsidian 1.13.4 or newer.
5. **Preserved processing controls**: Physical image conversion/resizing and insertion-time embed-size presets remain available; only the competing interactive DOM resize layer was removed.
6. **Safer drawing semantics**: Editable drawing sources and managed previews are protected from destructive image mutations while retaining compatible reference, alignment, Caption, and copy actions.

Upgrade notes:

- Obsidian 1.13.4 or newer is required, and the plugin remains desktop-only.
- The canonical plugin ID remains `obsidian-image-assistant`.
- Existing links, canonical PipeSyntax, Caption settings, and attachment names require no migration.
- Removed interactive-resize settings in existing `data.json` are ignored automatically. Resize images in Live Preview with Obsidian's native control.
- Obsidian's native resize keeps aspect ratio and owns its editor selection/drag lifecycle. The removed Image Assistant implementation's edge handles, unlocked aspect ratio, wheel shortcuts, and Reading Mode-only visual size are not migrated.

> **🚀 v4.0.0 Major Update**:
> 1. **Modular Architecture**: Complete refactoring of core handlers and UI modals for better performance and extensibility.
> 2. **i18n Refinement**: Standardized internationalization with parametric translation support across the entire plugin.
> 3. **Secret Storage**: Sensitive API keys migrated to Obsidian's native Secret Storage (requires Obsidian v1.11.4+).
> 4. **Stability**: Improved link reference management and concurrent processing reliability.

---

## Drawing engines

The **Drawing** dropdown chooses the default engine for newly created drawings. When it is set to Draw.io or Excalidraw, existing files are routed by their actual format, so both engines can be used in the same Vault. Setting it to Disabled removes drawing-specific commands and editor entries; file-safety classification and generic non-destructive reference actions remain active so generated previews or editable drawing images cannot be destructively processed.

### Draw.io Drawing Workspace

Enable **Settings → Image Assistant → Drawing → Draw.io** to add these commands:

- `Create Draw.io diagram and embed in current note`
- `Edit Draw.io diagram at cursor`
- `Open in editor` when right-clicking a confirmed `.drawio`/`.drawio.svg` file, editor link, or rendered diagram

New drawings use the existing attachment folder, filename template, link format, and conflict strategy, but are saved as editable `.drawio.svg` files. Legacy `.drawio` files opened through Image Assistant migrate to `.drawio.svg` on their first successful save. Image Assistant owns only its explicit drawing tab: it does not register SVG or Draw.io extensions, replace Obsidian's default file view, or take ownership from another Draw.io/SVG plugin.

The default editor URL is `https://embed.diagrams.net/`. A self-hosted HTTP/HTTPS URL is also supported when it implements the standard `embed=1&proto=json` protocol and passes the connection test. Existing path and query parameters are preserved; Image Assistant forces only the required embed flags. Prefer HTTPS outside localhost.

The drawing workspace exposes Draw.io's native Kennedy, Atlas, Dark, Minimal, Sketch, and Simple interfaces and can follow Obsidian's light/dark appearance. An open editor switches through a hidden replacement iframe: the current XML is flushed, the replacement must complete its own handshake and load, and only then is the old iframe destroyed. The toolbar can export Vault copies as editable `.drawio`/`.drawio.svg` or active-page `.svg`/`.png`; destination collisions use the existing filename policy and overwrite still requires confirmation. The optional chat pane has a draggable desktop width or narrow-window height that lasts only for that View.

### Optional Next AI Draw.io assistant

Next AI is a child setting of Draw.io and communicates with the HTTP API of an unmodified Next AI Draw.io web deployment. It does **not** embed the Next AI page and does **not** require its MCP server. Configure:

1. The Next AI web deployment root URL.
2. Its optional access code through Obsidian Secret Storage.
3. An OpenAI-compatible base URL, API key (Secret Storage), and model ID.
4. Optional custom system instructions and Minimal Style.

The assistant streams text and reasoning and supports `display_diagram`, `edit_diagram`, and `append_diagram`. Server-executed tools such as `get_shape_library` pass through without being reimplemented by the plugin; an unknown client-side tool returns a structured compatibility result instead of hanging the chat. Every change is validated as a transaction, checked against the current canvas revision and active page, reloaded into Draw.io, exported back to editable SVG, and confirmed in the Vault before a successful tool result is returned.

Each request includes the complete latest diagram XML. This gives the model semantic layout context—page structure, cell coordinates and sizes, styles, layers, and connections. On multi-page files, `edit_diagram` is restricted to the active page and PNG/VLM exports explicitly render that page, while `.drawio.svg` saves retain every page. Pixel-level context is sent only for attached images, an explicitly attached canvas screenshot, or optional visual validation.

Visual validation has three modes. **Disabled** makes no screenshot request. **Configured user model** (recommended) sends the current-page PNG directly to the configured OpenAI-compatible Base URL/API key/model, so that model must support image input. **Next AI server** uses the deployment's optional `/api/validate-diagram` endpoint and its server-side validation model. The stock Next AI endpoint returns the same empty `valid` result when validation is disabled, unconfigured, unsupported, or fails; because the response contains no execution marker, Image Assistant labels an empty success only as “server reported” rather than claiming a verified VLM pass. A reported issue still enters the bounded automatic improvement loop, and any unavailable validator leaves the already-saved diagram intact.

The native chat panel accepts up to five images, PDFs, text files, or extracted public URLs. Images and canvas screenshots are limited to 2 MiB each; PDF/text source files are limited to 25 MiB and extracted text to 150k characters. PDF extraction runs locally through Obsidian's PDF.js. `/api/parse-url` and `/api/validate-diagram` are optional deployment capabilities: a 404/405 disables only that feature. Visual validation performs bounded improvement retries and keeps the already saved diagram with an explicit warning if quality issues remain.

Messages can be copied, edited, retried, or regenerated from an earlier user message. Regeneration first restores the XML snapshot captured before that message. Recent Chats defaults to the current drawing but can search all 25 retained sessions across the Vault; results include a saved active-page thumbnail, and opening one for another file first opens or focuses its drawing View, waits for the Draw.io handshake, and only then restores the session. Chats and the latest 20 pre-AI diagram snapshots—with prompt, time, and bounded SVG preview—persist in `<vault>/.obsidian/plugins/obsidian-image-assistant/next-ai-sessions.json`; the versioned sidecar is written atomically, tolerates individual damaged records, deduplicates attachment data, and is capped at 32 MiB.

Prompt templates support title, description, body, pinning, creation/update timestamps, usage counts, search, create/edit/copy/delete, and JSON import/export. They use the separate atomic `<vault>/.obsidian/plugins/obsidian-image-assistant/next-ai-templates.json` sidecar; older templates in `data.json` migrate on first use. Built-in examples are generated in memory and are not persisted unless copied. The provider remains intentionally fixed to OpenAI-compatible Base URL + API Key + one model ID.

Security note: the configured Next AI deployment receives the current diagram XML, user text, extracted URL/document content, explicitly attached images, its access code, and BYOK provider credentials. Server-mode VLM additionally sends it the active-page PNG; user-model VLM sends that PNG and API key directly to the configured OpenAI-compatible endpoint. Remote cleartext HTTP is blocked by default for both destinations; loopback HTTP is allowed for local development, and non-loopback HTTP requires an explicit opt-in. Credential-bearing desktop requests reject redirects.

The official `embed.diagrams.net` editor may log a harmless `/notifications` 404 from its own origin. Image Assistant does not enable `offline=1` or `extAuth=1` merely to hide it because those flags change editor behavior.

Next AI Draw.io integration is based on the public HTTP/tool contracts of the Apache-2.0-licensed [Next AI Draw.io](https://github.com/DayuanJiang/next-ai-draw-io) project. Image Assistant uses an independent Obsidian-native client and does not bundle its React/Next.js application.

Draw.io diagrams are excluded from conversion, compression, crop, annotation, destructive batch processing, and upload-link replacement because those operations can strip the embedded editable model. Uploading one diagram manually keeps the local source and links unchanged.

### Excalidraw native bridge

Choose **Settings → Image Assistant → Drawing → Excalidraw** to use the separately installed and enabled [Obsidian Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) plugin. Image Assistant does not bundle Excalidraw, React, the external plugin, or any AGPL implementation. It dynamically uses the documented `window.ExcalidrawAutomate.getAPI()` surface and creates a fresh isolated API object for each operation, so disabling or hot-reloading the external plugin is detected on the next action.

The independent **Use Image Assistant file management** switch controls ownership of new-file placement. It defaults to enabled for backward compatibility: new drawings use Image Assistant's attachment destination, filename template, compound-suffix handling, and conflict policy, while the external API creates the actual modern `.excalidraw.md` source and the validated result is reconciled to that plan. When disabled, Image Assistant omits filename and folder parameters and accepts Excalidraw's own default filename, configured folder and unique-path result without relocating it. Configured Excalidraw templates remain available in both modes. Existing `.excalidraw`, `.excalidraw.md`, and generated `.excalidraw.svg`/`.png` theme variants route back to one verified source; an ambiguous or missing source leaves the image on the ordinary image path.

The default **Source** embed inserts a wiki transclusion without dimensions and lets Excalidraw render it live. **Native SVG auto-export preview** follows the external plugin's own image-embed workflow: Image Assistant writes `excalidraw-autoexport: svg` to the new source (or preserves an existing PNG preference as `both`), creates the standard zero-size sibling `.excalidraw.svg`, and inserts it. Excalidraw replaces that transparent placeholder with the real canvas on its first save and keeps it updated on later saves, even when global SVG auto-export is disabled.

Preview mode therefore intentionally keeps two files: `.excalidraw.md` is the editable source and `.excalidraw.svg` is the rendered image linked by the note. Deleting either breaks editing or preview synchronization. Source mode embeds the `.md` directly and does not need the sibling SVG.

Image Assistant does not maintain a background exporter or copy Excalidraw's renderer. It observes only managed preview-file modifications and version-refreshes matching rendered images, avoiding the stale zero-size resource cache without reloading the note. New sources are first planned with the same local destination, naming template, compound suffix, and conflict policy as Draw.io; after the public external API returns a validated file, Image Assistant uses Obsidian's public rename operation to reconcile any external default-folder fallback with that plan. When opening an older preview created by Image Assistant, it repairs the same per-file auto-export preference before opening the source. A custom Excalidraw export-path hook may redirect exports away from the standard sibling file; Image Assistant deliberately does not access or track that private hook, so **Source** embedding is recommended in that configuration.

The external plugin remains the sole owner of its View, saving, resources, scripts, export, and AI functionality. Image Assistant does not register Excalidraw extensions or View types, invoke internal command IDs, access the plugin instance, or force a Markdown file into a private View. If a drawing remains in Markdown view, check the external plugin's `excalidraw-open-md` behavior or use its native view switch.

Excalidraw sources and previews that resolve uniquely to a source are protected from in-place conversion, compression, crop, annotation, destructive batch processing, and upload-link replacement. Ordinary SVG/PNG files—including Excalidraw-looking previews without a reliable source—remain ordinary images.

Right-clicking an exactly resolved native Excalidraw render or managed preview retains Image Assistant's safe shared actions: edit link caption/size/alignment, copy the rendered image or Base64, remove a reviewed reference, and open the verified source in the editor. Generated SVG/PNG previews may be uploaded only as independent copies; Markdown sources are never sent to an image host as though they were pixels. Standard same-stem source/preview renames are serialized, collision-checked, revision-checked, performed previews-first, and rolled back as a group when a later move fails. Physical source deletion cleans up only unreferenced, unchanged sibling previews after the source is safely removed; referenced or concurrently changed previews are retained and reported.

---

## 1. Auto Paste / Drop Handling

When you paste or drop an image into a note, the plugin processes it automatically based on your settings.

### Paste Mode: Local

Offline-first, optimizes your vault archive.

- **Auto-convert**: Convert to WebP, JPEG, PNG, or AVIF.
- **Auto-compress**: Reduce file size with quality control, pngquant, or FFmpeg.
- **Auto-rename**: Rename using templates like `{notename}-{timestamp}`, `{MD5:time}`, or `{sha256:image:12}`.
- **Embed-size planning**: Auto-calculate and inject Obsidian's official width (`|300`) or exact width-by-height (`|640x360`) syntax.
- **Smart conflict resolution**: Skip, reuse, increment, or overwrite duplicates.

Naming templates are evaluated once per paste/drop operation. Date variables,
`{timestamp}`, random values, folder templates, and filename templates share the
same operation snapshot. `{MD5:time}` and `{sha256:time}` hash Unix milliseconds;
path conflicts are still resolved atomically, so two operations in the same
millisecond cannot overwrite each other. Hash sources are case-insensitive, while
custom hash text preserves its original case, spaces, and punctuation. Unknown or
malformed tokens stop the write instead of becoming a literal filename.

`{imagename}` is the source stem, `{filetype}` has no leading dot,
`{notepath}` includes `.md`, `{imagepath}`/`{fullpath}` use the vault path for
vault files, `{rootfolder}` is the vault name, and `{vaultpath}` is the desktop
vault base path. Counters are persistent and isolated by target folder and
template; validation and preview do not consume them.

### Paste Mode: Cloud

Online sharing, saves local vault space.

- **Auto-upload**: Paste directly uploads to PicGo/PicList server.
- **Link replacement**: Inserts the cloud URL instead of a local path.
- **Batch upload**: One command to upload all images in the current note.
- **Network image upload**: Upload images from URLs directly to your cloud host.
- **Review before deleting**: Upload review dialogs can replace links and delete local source files after confirmation.
- **Remote server mode**: Send vault-relative paths to a remote PicGo/PicList service; network URL uploads are disabled in this mode.

### Per-Note Override

Set `image_paste_mode: local|cloud|disabled` in a note's frontmatter to override the global setting for that note only.

---

## 2. On-Demand Tools

Available any time via the **Command Palette** or right-click menu:

### OCR / LaTeX / Markdown
Converts clipboard images (e.g. screenshots of equations) into text.

| Command | Output |
|---------|--------|
| `Generate inline LaTeX` | `$...$` inline formula |
| `Generate multiline LaTeX` | `$$...$$` display formula |
| `Generate markdown` | Plain text |

**Supported providers**: LLM (OpenAI or local Ollama), SimpleTex, Texify, Pix2Tex.

### Network Image Downloader
One-click download of online images referenced in notes to your local vault.

- **Download & Replace** — Download and swap the URL for a local path
- **Download Only** — Close the review after download and leave source links unchanged
- **Download & Replace & Delete Cloud** — Available for PicList-owned uploads after complete reference verification

Scope: current note, folder (recursive), or entire vault.

### Source Plugin Compatibility

Image Assistant aims for practical feature parity with its source plugins rather than a one-to-one copy of every legacy setting.

- Image Auto Upload's `image-auto-upload` frontmatter is replaced by `image_paste_mode: local|cloud|disabled`.
- Image Converter's old conversion/folder/filename multi-preset model is deprecated; Image Assistant now uses one local processing configuration plus operation defaults.
- Local batch processing focuses on original/WebP/JPEG/PNG workflows; AVIF and pngquant remain available through single-image and local processing paths.
- Cloud source deletion is confirmation-based in upload review dialogs instead of an automatic global toggle.
- OCR includes the original provider styles plus the newer LLM/Ollama-compatible provider.

### Image Annotation
Draw, arrow, stamp text, and markup images directly inside Obsidian.

- Pencil, arrow, and text tools
- 3 color pickers, opacity, blend mode, stroke size
- 3 preset slots per tool type (drawing / arrow / text)
- Undo/Redo (Ctrl+Z / Ctrl+Shift+Z)
- Saves directly to the original file

In-place crop and annotation are offered for JPEG, PNG, WebP, and AVIF. Export bytes are verified before overwrite; when the runtime encoder falls back to another format, the original file is preserved.

### Batch Operations
Process or upload multiple images at once:

| Scope | Local Processing | Cloud Upload | Network Download |
|-------|-----------------|-------------|------------------|
| Current note | ✅ | ✅ | ✅ |
| Selected folder | ✅ | ✅ | ✅ |
| Entire vault | ✅ | ✅ | ✅ |

Network downloads reject private, loopback, link-local, and reserved destinations before the request. Obsidian's `requestUrl` API does not expose the final redirect URL, so redirected destinations cannot be fully revalidated; this is a hard platform limitation rather than a claim of complete SSRF protection.

---

## 3. Image Alignment & Captions

### Alignment
Right-click any image to align it **left / center / right** with optional **text wrap**.

Settings control the default alignment and whether wrap applies in edit mode.

### Captions
Automatically extracts the `alt` text from image links and renders it as a styled caption below the image.

Captions are rendered consistently in **Reading Mode** and **Live Preview**, including local images, network URL images, Markdown image links, and Wiki image embeds. Source Mode intentionally remains raw Markdown with no synthetic caption widgets.

Rendered Obsidian callouts and legacy Admonition `ad-*` blocks use the same caption parser; image-looking text in frontmatter, inline code, HTML comments, and ordinary code fences is ignored.

Supported pipe syntax examples:

```markdown
![[image.png|A local caption|center|420]]
![[https://example.com/photo.png|A network caption|right|300]]
![A Markdown caption|left-wrap|640x360](images/photo.png)
![A network caption|right|300](https://example.com/photo.png)
```

Image Assistant recognizes a display size only when the final unescaped pipe
segment is a positive integer `W` or `WxH`. Alignment, when present, precedes
that size; all earlier segments form the Caption. Legacy `xH`, `Wx`, or
non-final size-like text is preserved as written but is not interpreted or
automatically migrated.

Mode toggles independently control Reading Mode and Live Preview. Inline captions can apply to every captioned image or standalone images only; width can follow the image or its container, and long captions can be clamped to 1–5 lines while retaining the full hover text. In Live Preview, auto-width captions use the precisely matched rendered image bounds when available and retain editor-content width as the safe fallback.

Caption alignment follows the resolved image layout: an explicit PipeSyntax alignment wins, then the image default, and the Caption alignment setting is used only as a fallback when image alignment is disabled or unavailable. `left-wrap` and `right-wrap` float a reliable standalone image/Caption layout; inline images, multi-image lines, and Live Preview images without a known width safely fall back to horizontal alignment.

Visual settings cover font size, color, style, weight, background, border, padding, fallback alignment, and spacing. The settings page includes a live preview and a style-only reset that preserves all behavior choices.

---

## 4. Native Live Preview Resize

Image Assistant delegates interactive image resizing to Obsidian 1.13.4 or newer. Select a rendered image in Live Preview and use Obsidian's native resize control; the resulting width is stored in the note's standard image syntax and is understood by Image Assistant's alignment and Caption pipeline. Native resizing preserves aspect ratio and rewrites an existing `WxH` size as `W` after the first drag.

The former Image Assistant resize overlay is intentionally absent: there are no plugin-owned handles, wheel listeners, body-level wrapper classes, cursor relocation settings, or Reading Mode-only visual sizes. This avoids duplicate layout ownership and keeps local, URL, Draw.io SVG, and Excalidraw renders consistent with the editor.

This change does not remove pixel-level resizing during conversion/compression or the optional embed-size value applied when Image Assistant inserts a new local image.

---

## 5. Unused File Cleaner

Scans any attachment folder for files not referenced anywhere in your vault.

- Configurable scan path, file types, and local-file deletion destination
  (follow Obsidian / system trash / Obsidian `.trash` / custom folder)
- The deletion destination is shared by context-menu source deletion,
  conversion cleanup, download undo, and unused-file cleanup
- A dedicated child switch controls the destructive image-menu entry; it is
  shown only while the master context-menu switch is enabled
- Preview list before deleting
- Always includes Obsidian callouts, legacy Admonition `ad-*` blocks, ordinary fenced code, and Canvas in deletion-safety scans. The fenced-code setting controls mutation eligibility only.

---

## 6. Right-Click Context Menu

Image Assistant appends capability-appropriate actions to Obsidian's official
editor, file, and URL menus. It does not suppress the native menu or create a
separate fallback menu when Obsidian emits no menu event.

- **Resolved local images**: edit properties, open, cut/copy, copy as Base64,
  convert/compress, crop, annotate, upload, delete references or source, and
  reveal in Obsidian or the system explorer.
- **Resolved network images**: edit properties, open, cut, download to the
  vault, and inspect deletion choices.
- **Data, Blob, or unresolved images**: only non-destructive actions supported
  by the resolved source context.
- **File explorer**: process or upload an image file, or launch local/upload/
  download batch processing for a note, Canvas, folder, or the whole vault.

Destructive actions scan the full vault, including Canvas and ordinary fenced
code. References outside the selected mutation scope or protected by the
fenced-code setting keep the source object.

---

## ⚙️ Configuration

### Cloud Upload
Requires **PicGo** or **PicList** running locally (default server: `http://127.0.0.1:36677`).

Settings: upload server URL, delete server URL, PicGo-Core binary path, concurrency (1–10), link format (markdown / wikilink).

### OCR
**Recommended**: Use a local **Ollama** model or **SimpleTex** for formula recognition.

Configure the API key in Settings → OCR & LaTeX. Keys are stored in Obsidian's native Secret Storage.

Pix2Tex and Texify endpoints can also use optional HTTP Basic Auth. Their usernames are stored in plugin settings and passwords are linked through Secret Storage; legacy plaintext passwords migrate automatically.

### Alignment & Captions
Enable/disable individually in Settings. Caption mode, inline, width, and line-limit behavior are configurable independently from the shared visual style.

### External Tools
- **pngquant**: Path to binary + quality range (e.g. `65-80`) for PNG compression
- **FFmpeg**: Path to binary + CRF (0–51) + preset for advanced encoding

---

## Privacy and configured network services

Local conversion, compression, annotation, drawing-file persistence, and Vault file management run on the desktop. Network features are opt-in and send data to the endpoint selected by the user:

- PicGo/PicList and cloud upload providers receive the images selected for upload and the credentials required by that provider.
- OCR/LaTeX providers receive the selected image; OpenAI-compatible visual OCR also receives the configured prompt, model ID, and API credential. Credential-bearing OCR requests reject redirects and require HTTPS outside loopback.
- A configured Draw.io embed receives the diagram loaded into its iframe. Next AI additionally receives the complete diagram XML, user prompts, extracted document/URL content, explicit attachments, and the credentials described in its settings. Visual-validation modes may send the active-page PNG.
- The Excalidraw bridge itself calls the separately installed local plugin's public API; any network behavior inside that external plugin remains governed by its own settings.

Secrets are stored by reference in Obsidian Secret Storage where supported, but the selected remote service necessarily receives the credential used to authenticate a request. Use only endpoints you trust and review their retention, privacy, and billing policies. See [DISCLAIMER.md](DISCLAIMER.md) for the complete operational notice.

---

## 📥 Installation

Image Assistant 6.0.0 requires desktop Obsidian 1.13.4 or newer.

1. Download `main.js`, `styles.css`, and `manifest.json` from [Releases](https://github.com/RandyAllenEEE/obsidian-image-assistant/releases).
2. Place them in `.obsidian/plugins/obsidian-image-assistant/`.
3. Restart Obsidian and enable the plugin.

*Or install via BRAT: search for `RandyAllenEEE/obsidian-image-assistant` in BRAT.*

For local development, build and deploy with the manifest ID as the target
directory:

```powershell
npm run deploy:local -- --vault="E:\path\to\vault"
```

The deploy command preserves plugin data, atomically replaces the three release
artifacts, removes the legacy `image-assistant` enablement entries, and enables
`obsidian-image-assistant`. Add `--dry-run` to validate without writing.

---

## 🔧 Tech Stack

- **Core**: TypeScript with focused image-processing utilities
- **UI**: Obsidian's native Settings API + Fabric.js for annotation
- **Protocol**: PicGo / PicList server API
- **i18n**: English and Simplified Chinese settings and core workflows

### Runtime Smoke Test

Release candidates can be checked against a running desktop Obsidian instance started with a local DevTools port:

```bash
npm run smoke:obsidian -- --port=9229 --version=6.0.0 --note=Acceptance.md
```

Start Obsidian with an isolated Electron profile before running the command. On Windows, for example:

```powershell
& "$env:LOCALAPPDATA\Obsidian\Obsidian.exe" `
  --user-data-dir="$env:TEMP\obsidian-image-assistant-smoke" `
  --remote-debugging-port=9229
```

The harness waits up to 30 seconds for CDP by default. Use `--cdp-wait-ms=60000` for slower startup and `--cdp-request-timeout-ms=90000` for extended checks on slower machines; `--help` lists all options.

The smoke test verifies plugin loading, command registration, settings navigation, local and network captions in Reading Mode and Live Preview, repeated-network-URL alignment and bounds, Source Mode cleanup, and unload/reload cleanup. Use `--enable-community-plugins=true` only with an isolated Obsidian profile; it explicitly disables Restricted Mode for that profile.

Add `--extended=true` only for a disposable vault. Extended smoke creates local paste/drop fixtures, opens and closes all nine scope/mode batch entries, and verifies that Fabric annotation renders a non-empty canvas and releases its modal state.

Network downloads prefer Electron's streaming network stack, which enforces the byte limit while data arrives and validates every redirect target. If that API is unavailable, Image Assistant uses a restricted `requestUrl` fallback that requires `Content-Length`; the fallback cannot abort the underlying transfer or verify the final redirect URL.

---

## 📜 License & Acknowledgments

### License
Image Assistant's own code is distributed under the MIT License. Bundled third-party portions retain their respective licenses; exact versions, source, modification notes, and license texts are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Release pages also attach the pinned corresponding-source archives for the bundled LGPL HEIC decoder.

### Acknowledgments

**Image Assistant** stands on the shoulders of these excellent open-source projects:

1. **[xRyul](https://github.com/xRyul)** — **[obsidian-image-converter](https://github.com/xRyul/obsidian-image-converter)**
   — Core image conversion, compression, and rename logic.

2. **[renmu123](https://github.com/renmu123)** — **[obsidian-image-auto-upload-plugin](https://github.com/renmu123/obsidian-image-auto-upload-plugin)**
   — PicGo/PicList auto-upload and link replacement foundation.

3. **[Hugo Persson](https://github.com/Hugo-Persson)** — **[obsidian-ocrlatex](https://github.com/Hugo-Persson/obsidian-ocrlatex)**
   — OCR recognition and LaTeX formula conversion inspiration.

4. **[Fabric.js](http://fabricjs.com/)**
   — Canvas-based image annotation and markup layer.
