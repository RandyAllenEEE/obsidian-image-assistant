# Image Assistant for Obsidian

**Image Assistant** 是一个功能强大的 Obsidian 图片管理插件，深度集成了**本地图片处理**、**云端图床管理**和**OCR识别**功能。旨在为您提供一站式的图片管理解决方案。

> 本项目基于 **[Image Converter](https://github.com/xRyul/obsidian-image-converter)**、**[Image Auto Upload](https://github.com/renmu123/obsidian-image-auto-upload-plugin)** 和 **[Image2LaTEX](https://github.com/Hugo-Persson/obsidian-ocrlatex)** 开发。
> 核心图片处理逻辑归功于 **xRyul**，云端上传功能归功于 **renmu123**，OCR识别功能归功于 **Hugo Persson**。本项目并在基础上进行了深度整合与优化。

---

## ✨ 核心功能 (Core Features)

插件的功能逻辑分为 **"自动化粘贴处理"** 和 **"按需工具箱"** 两大板块。

### 1. 自动化粘贴处理 (Auto Paste Handling)
当您在笔记中粘贴或拖入图片时，插件会根据设置自动执行处理。
> **🚀 v3.0.0 Major Update**: 
> 1. **Internationalization (i18n)**: Now fully supports **English** and **Simplified Chinese** (UI strings no longer hardcoded).
> 2. **Performance**: New concurrent queue system, batch processing hundreds of images without freezing.
> 3. **Robustness**: Enhanced link cleaning and reference tracking.

支持以下三种模式（在设置中切换）：

*   **🏠 本地模式 (Local Mode)** - *离线优先，优化存档*
    *   **自动转换**: 转为 WebP/JPG/PNG。
    *   **自动压缩**: 减小体积，节省硬盘空间。
    *   **自动重命名**: 基于笔记名或时间戳重命名 (`Date-FileName.webp`)。
    *   **非破坏性调整**: 自动计算并添加尺寸标记 (`|width`)。

*   **☁️ 图床模式 (Cloud Mode)** - *在线分享，节省本地空间*
    *   **自动上传**: 粘贴时直接上传至 PicGo/PicList。
    *   **链接替换**: 自动插入云端链接，而非本地路径。
    *   **批量处理**: 支持一键将当前笔记的所有本地图片批量上传。

*   **🚫 关闭 (Disabled)**
    *   不进行任何自动化处理，保持 Obsidian 原生行为。

### 2. 按需工具箱 (On-Demand Tools)
以下功能通过 **命令面板 (Command Palette)** 或 **快捷键** 触发，随时调用：

*   **🔍 OCR 智能识别 (OCR)**
    *   **功能**: 将**剪贴板**中的图片（如公式截图）转换为文本或 LaTeX。
    *   **触发方式**: `Cmd/Ctrl + P` -> 搜索 `Generate...`
        *   `Generate inline LaTeX`: 生成行内公式 `$ ... $`
        *   `Generate multiline LaTeX`: 生成公式块 `$$ ... $$`
        *   `Generate markdown`: 生成普通文本
    *   **支持服务**: LLM (GPT-4o/Claude等), SimpleTex, Texify, Pix2Tex。

*   **🌐 网络图片本地化 (Downloader)**
    *   **功能**: 一键下载笔记中的网络图片到本地，防止链接失效。
    *   **模式**: 支持 "下载并替换"、"仅下载" 或 "仅替换"。

*   **🎨 图片编辑 (Editing)**
    *   **标注**: 直接在 Obsidian 内对图片进行绘图、标注。
    *   **调整**: 拖拽边缘调整大小，或使用右键菜单编辑。

---

## 🚀 使用指南 (Usage)

### 设置自动粘贴模式
进入 **设置 (Settings) → Image Assistant → Paste handling mode**：
*   选择 `Local`：启用本地压缩、重命名流程。
*   选择 `Cloud`：启用自动上传流程（需配合 PicGo）。

### 使用 OCR 识别
无需切换模式，随时可以使用：
1.  **截图/复制**图片到系统剪贴板。
2.  呼出的命令面板 (`Ctrl/Cmd + P`)。
3.  输入 **OCR** 关键字。
4.  选择对应命令（如转为 LaTeX 公式），结果将自动插入光标处。

### 批量管理
*   **上传笔记图片**: 在图床模式下，使用命令 `Upload all images in current note`。
*   **下载网络图片**: 使用命令 `Download all network images in current note`。

---

## ⚙️ 配置说明 (Configuration)

### 图床配置 (Cloud)
*   需要安装并运行 **PicGo** 或 **PicList**。
*   默认地址: `http://127.0.0.1:36677/upload`

### OCR 配置
*   **推荐**: 使用 **LLM** (OpenAI 兼容接口) 或 **SimpleTex** (公式识别精度高)。
*   可在设置页面的 "OCR & LaTeX 设置" 中配置 API Key。

---

## 📥 安装 (Installation)

1.  从 [Releases](https://github.com/RandyAllenEEE/obsidian-image-assistant/releases) 下载 `main.js`, `styles.css`, `manifest.json`。
2.  放入 `.obsidian/plugins/image-assistant/` 文件夹。
3.  重启 Obsidian 并启用。

*(或者使用 BRAT 插件安装: `RandyAllenEEE/obsidian-image-assistant`)*

---

## 🔧 技术栈 (Tech Stack)
*   **Core**: Pure TypeScript/JavaScript
*   **UI**: FabricJS (Annotation)
*   **Protocol**: PicGo (Upload)

---

## 📜 协议与致谢 (License & Credits)
MIT License.
感谢 **xRyul**, **renmu123**, **Hugo Persson** 以及 **FabricJS** 的开源贡献。
