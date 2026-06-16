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

## 🚀 What's New in v4.1.0

> **🚀 v4.1.0 Major Update**:
> 1. **Modular Architecture V2**: Refactored cloud and local handlers into a clean modular architecture with dedicated paste handlers, drop handlers, batch uploaders, and batch processors.
> 2. **Ollama Support**: OCR/LaTeX now supports local Ollama models (OpenAI-compatible API endpoint).
> 3. **Context Menu Refactoring**: Rewrote the image context menu system for better maintainability and richer interaction model (copy as base64, crop/rotate/flip, align submenu).
> 4. **Unified Batch Modal**: Consolidated all batch operations (note / folder / vault scope) into a single unified modal with a consistent review-and-confirm workflow.
> 5. **URL Image Caption Rendering**: Improved caption rendering for network images.
> 6. **Secret Storage**: API keys migrated to Obsidian's native Secret Storage (requires Obsidian v1.11.4+).

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
- **Download Only** — Just download, don't touch the links
- **Replace Only** — Assume already downloaded, swap URLs to local paths

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

- Pencil, arrow, text, rectangle, circle, line, eraser tools
- 3 color pickers, opacity, blend mode, stroke size
- 3 preset slots per tool type (drawing / arrow / text)
- Undo/Redo (Ctrl+Z / Ctrl+Shift+Z)
- Saves directly to the original file

### Batch Operations
Process or upload multiple images at once:

| Scope | Local Processing | Cloud Upload |
|-------|-----------------|-------------|
| Current note | ✅ | ✅ |
| Selected folder | ✅ | ✅ |
| Entire vault | ✅ | ✅ |

---

## 3. Image Alignment & Captions

### Alignment
Right-click any image to align it **left / center / right** with optional **text wrap**.

Settings control the default alignment and whether wrap applies in edit mode.

### Captions
Automatically extracts the `alt` text from image links and renders it as a styled caption below the image.

Fully customizable: font size, color, style, weight, background, border, padding, alignment, and more.

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
- Optionally indexes fenced code blocks and Obsidian admonitions for reference tracking

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

### Alignment & Captions
Enable/disable individually in Settings. All caption styles (font, color, background, border, spacing) are fully customizable.

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

- **Core**: Pure TypeScript — no heavy runtime dependencies
- **UI**: Obsidian's native Settings API + Fabric.js for annotation
- **Protocol**: PicGo / PicList server API
- **i18n**: Full English and Simplified Chinese support

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
