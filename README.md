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
- 📐 **Interactive Resize** — Drag image corners or scroll to resize. Non-destructive, persisted via pipe syntax.
- 🖼️ **Image Alignment** — Align images left/center/right with optional text wrap.
- 📝 **Captions** — Auto-extract and render image alt-text as elegant captions.
- 🧹 **Unused File Cleaner** — Find and remove unreferenced attachments.
- 🌐 **Network Image Download** — One-click download of online images into your vault.

---

## What's New in v5.0.0

Version 5.0.0 is the delivery-hardening release. It keeps the full note/folder/vault by local/upload/download matrix while making destructive operations fail closed.

1. **Safe conversion commits**: Output bytes are verified by magic bytes, reference changes are reported per file, and source images are deleted only after complete Markdown and Canvas replacement.
2. **Reliable paste and replacement**: Paste/drop handlers claim events only after accepting the image, while OCR, LaTeX, and upload placeholders share a guarded editor replacement utility.
3. **Unified cancellable batch processing**: All nine scope/mode combinations use bounded concurrency, stable result ordering, cancellation, duplicate-action protection, and detailed partial-failure review.
4. **Format-aware network downloads**: PNG, JPEG, GIF, WebP, BMP, ICO, TIFF, AVIF, HEIC, HEIF, and SVG downloads are named from verified bytes and support safe conflict handling and Undo.
5. **Reference-safe deletion**: Markdown, Wiki, URL, code-block, and Canvas references participate in deletion checks; incomplete scans preserve local and cloud sources.
6. **Consistent captions**: Live Preview, Reading Mode, local files, network URLs, Markdown links, Wiki links, and flexible pipe ordering share one idempotent renderer.
7. **Settings and lifecycle hardening**: Existing caption, cleaner, paste, resize, external-tool, OCR Basic Auth, and concurrency settings are exposed and validated; corrupt settings/history and popout cleanup no longer disable the plugin.
8. **Fabric 7 and delivery tooling**: Annotation now targets Fabric 7.4.0, the runtime targets ES2022 and Obsidian 1.11.4+, and CI enforces lint, two TypeScript checks, coverage, production build, release metadata consistency, and dependency audit.

Upgrade notes:

- Obsidian 1.11.4 or newer is required, and the plugin remains desktop-only.
- Legacy cloud upload concurrency migrates to `global.batchConcurrency`.
- Legacy Pix2Tex/Texify plaintext passwords migrate to Obsidian Secret Storage.
- Undocumented duplicate batch backends and legacy multi-preset settings are no longer part of the supported runtime surface.

> **🚀 v4.0.0 Major Update**:
> 1. **Modular Architecture**: Complete refactoring of core handlers and UI modals for better performance and extensibility.
> 2. **i18n Refinement**: Standardized internationalization with parametric translation support across the entire plugin.
> 3. **Secret Storage**: Sensitive API keys migrated to Obsidian's native Secret Storage (requires Obsidian v1.11.4+).
> 4. **Stability**: Improved link reference management and concurrent processing reliability.

---

## 1. Auto Paste / Drop Handling

When you paste or drop an image into a note, the plugin processes it automatically based on your settings.

### Paste Mode: Local

Offline-first, optimizes your vault archive.

- **Auto-convert**: Convert to WebP, JPEG, PNG, or AVIF.
- **Auto-compress**: Reduce file size with quality control, pngquant, or FFmpeg.
- **Auto-rename**: Rename using templates like `{notename}-{timestamp}` or `{MD5}`.
- **Non-destructive resize**: Auto-calculate and inject width/height pipe syntax (`|300`).
- **Smart conflict resolution**: Skip, reuse, increment, or overwrite duplicates.

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
![[https://example.com/photo.png|right|300|A network caption]]
![A Markdown caption|left-wrap|640x360](images/photo.png)
![right|300|A permissive-order caption](https://example.com/photo.png)
```

Mode toggles independently control Reading Mode and Live Preview. Inline captions can apply to every captioned image or standalone images only; width can follow the image or its container, and long captions can be clamped to 1–5 lines while retaining the full hover text. In Live Preview, auto-width captions use the precisely matched rendered image bounds when available and retain editor-content width as the safe fallback.

Caption alignment follows the resolved image layout: an explicit PipeSyntax alignment wins, then the image default, and the Caption alignment setting is used only as a fallback when image alignment is disabled or unavailable. `left-wrap` and `right-wrap` float a reliable standalone image/Caption layout; inline images, multi-image lines, and Live Preview images without a known width safely fall back to horizontal alignment.

Visual settings cover font size, color, style, weight, background, border, padding, fallback alignment, and spacing. The settings page includes a live preview and a style-only reset that preserves all behavior choices.

---

## 4. Interactive Drag Resize

Resize images by **dragging corner handles** or **scrolling the mouse wheel**.

- 8 resize handles (corners + edges)
- Optional aspect ratio lock
- Scroll resize with configurable sensitivity and modifier key
- Dimensions persisted via Obsidian pipe syntax (`![[image.png|300]]`)
- Visual resize in reading mode (non-destructive)

---

## 5. Unused File Cleaner

Scans any attachment folder for files not referenced anywhere in your vault.

- Configurable scan path, file types, and delete mode (system trash / Obsidian trash / custom folder)
- Preview list before deleting
- Always tracks rendered Obsidian callouts and legacy Admonition `ad-*` blocks; ordinary fenced-code references remain optional for safety scans

---

## 6. Right-Click Context Menu

Right-click any image in the editor for quick access to:

- **Rename** — rename file and update all references across the vault
- **Cut / Copy / Copy as Base64**
- **Convert / Compress** — single image processing modal
- **Crop / Rotate / Flip**
- **Annotate** — open annotation editor
- **Align** (left / center / right / wrap submenu)
- **Upload & Replace** (cloud mode)
- **Auto Delete** (file + link)
- **Show in explorer / navigation**
- **Sidebar file menu**: Process single image, upload, or process all images in note/folder

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

## 📥 Installation

1. Download `main.js`, `styles.css`, and `manifest.json` from [Releases](https://github.com/RandyAllenEEE/obsidian-image-assistant/releases).
2. Place them in `.obsidian/plugins/obsidian-image-assistant/`.
3. Restart Obsidian and enable the plugin.

*Or install via BRAT: search for `RandyAllenEEE/obsidian-image-assistant` in BRAT.*

---

## 🔧 Tech Stack

- **Core**: TypeScript with focused image-processing utilities
- **UI**: Obsidian's native Settings API + Fabric.js for annotation
- **Protocol**: PicGo / PicList server API
- **i18n**: English and Simplified Chinese settings and core workflows

### Runtime Smoke Test

Release candidates can be checked against a running desktop Obsidian instance started with a local DevTools port:

```bash
npm run smoke:obsidian -- --port=9229 --version=5.0.0 --note=Acceptance.md
```

The smoke test verifies plugin loading, command registration, settings navigation, local and network captions in Reading Mode and Live Preview, repeated-network-URL alignment and bounds, Source Mode cleanup, and unload/reload cleanup. Use `--enable-community-plugins=true` only with an isolated Obsidian profile; it explicitly disables Restricted Mode for that profile.

Obsidian 1.11.4 does not reliably acknowledge the CDP `Runtime.enable` request. Add `--runtime-events=false` for that version; all state, DOM, command, and lifecycle assertions still run.

Add `--extended=true` only for a disposable vault. Extended smoke creates local paste/drop fixtures, opens and closes all nine scope/mode batch entries, and verifies that Fabric annotation renders a non-empty canvas and releases its modal state.

---

## 📜 License & Acknowledgments

### License
MIT License

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
