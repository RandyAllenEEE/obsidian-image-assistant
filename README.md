# Image Assistant for Obsidian

**Image Assistant** 是一个功能强大的 Obsidian 图片管理插件，集成了**本地图片处理**与**云端图床管理**功能。它能够自动转换、压缩、调整图片大小，并支持将图片上传至图床或下载网络图片到本地，让您的笔记图片管理更加便捷高效。

> 本项目基于 **[Image Converter](https://github.com/xRyul/obsidian-image-converter)** 和 **[Image Auto Upload](https://github.com/renmu123/obsidian-image-auto-upload-plugin)** 开发。
> 
> 核心图片处理逻辑归功于原作者 **xRyul**，云端上传功能归功于 **renmu123**。本项目在此基础上进行了深度整合与定制化增强，实现了本地处理与云端管理的无缝切换。
>
> This project is an enhanced integration based on **[Image Converter](https://github.com/xRyul/obsidian-image-converter)** and **[Image Auto Upload Plugin](https://github.com/renmu123/obsidian-image-auto-upload-plugin)**. All credits for core image processing go to **xRyul**, and cloud upload features to **renmu123**. This version provides seamless switching between local processing and cloud management.

---

## ✨ 主要功能 (Features)

### 🎛️ 智能粘贴处理模式

**三种模式自由切换**，满足不同场景需求：

1. **本地模式 (Local Mode)**：
   - 自动转换、压缩、重命名粘贴/拖放的图片
   - 保存到本地附件文件夹
   - 完整保留 Image Converter 的所有处理能力

2. **图床模式 (Cloud Mode)**：
   - 自动上传粘贴/拖放的图片到图床（支持 PicGo/PicList）
   - 自动插入带尺寸标记的图床链接
   - 支持批量上传当前笔记的所有本地图片

3. **关闭模式 (Disabled)**：
   - 使用 Obsidian 默认行为
   - 不进行任何处理

### 🖼️ 本地图片处理 (Local Image Processing)

**支持格式**: WEBP, JPG, PNG, HEIC, TIF, AVIF

- **转换 (Convert)**: 自动转换图片为 WEBP、JPG 或 PNG 格式
- **压缩 (Compress)**: 通过 Quality 值 (1-100) 减小文件大小
- **调整大小 (Resize)**:
  - **非破坏性调整**: 自动读取图片尺寸并应用到链接 (`|widthxheight`)
  - **拖拽调整**: 拖动图片边缘或使用 **Cmd+滚轮** 调整大小
  - **原图调整**: 按宽度、高度、最长边、最短边、适配、填充等模式调整

### 🎨 图片编辑工具 (Image Editing)

- **对齐 (Alignment)**: 左对齐、右对齐、居中，支持文字环绕
- **标注工具 (Annotation)**: 直接在 Obsidian 内绘制、书写、标注图片
- **裁剪、旋转、翻转 (Crop/Rotate/Flip)**: 完整的图片编辑功能
- **题注管理 (Captions)**: 自动为图片添加题注

### ☁️ 云端图床管理 (Cloud Storage)

#### 上传功能 (Upload)

- **粘贴/拖放自动上传**: 在图床模式下自动上传图片到 PicGo/PicList
- **批量上传**: 一键上传当前笔记的所有本地图片到图床
  - 智能跳过已上传的图片
  - 自动替换本地链接为图床链接
  - 可选：上传成功后删除本地文件
- **右键上传**: 右键点击图片快速上传到图床
- **网络图片处理**: 支持粘贴网络图片 URL 并上传到图床

#### 下载功能 (Download) 🆕

**三种下载模式**，灵活处理网络图片：

1. **下载并替换 (Download & Replace)**:
   - 下载网络图片到本地附件文件夹
   - 自动将网络链接替换为本地路径
   - **完整保留尺寸标记** (`|500x600`)

2. **仅下载 (Download Only)**:
   - 只下载图片到本地
   - 不修改笔记中的链接
   - 适合手动处理链接场景

3. **仅替换 (Replace Only)**:
   - 不下载，假设文件已存在本地
   - 智能查找并替换链接
   - 支持多种扩展名和序号匹配

**下载预览界面**:
- 可视化选择要下载的图片
- 支持全选/取消全选
- 显示域名黑名单过滤结果
- 实时进度提示

#### 删除功能 (Delete)

- **智能删除**: 右键菜单 "Auto Delete"
  - 本地图片：删除文件和链接
  - 图床图片：同步删除云端文件（需配置 PicList）

### 📁 文件管理 (File Management)

- **自定义重命名**: 支持变量 (如 `{noteName}`, `{fileName}`, `{date}` 等)
- **智能路径管理**: 遵循 Obsidian 附件路径设置
- **冲突处理**: 自动递增序号避免文件名冲突
- **相对路径**: 自动计算正确的相对路径

### 🔄 批量处理 (Batch Processing)

- 转换、压缩、调整当前笔记或整个 Vault 的所有图片
- 批量上传当前笔记的所有本地图片到图床
- 批量下载当前笔记的所有网络图片到本地

### 🔗 链接格式 (Link Format)

- 支持 **Markdown 链接** (`![](path)`) 和 **Wiki 链接** (`![[path]]`)
- 自动尺寸标记：`![alt|widthxheight](path)`
- 智能路径：最短路径、相对路径、绝对路径

### 🌍 纯离线实现 (Offline Processing)

- 本地图片处理完全使用纯 JavaScript 实现
- 无需外部 API 或二进制依赖 (ImageMagick, FFmpeg 等)
- 轻量、便携、安全

---

## 🚀 使用指南 (Usage)

### 1. 基础配置

#### 设置粘贴模式

1. 打开 **设置 (Settings) → Image Assistant**
2. 找到 **"Paste handling mode"** (粘贴处理模式)
3. 选择您需要的模式：
   - **本地模式**: 处理并保存到本地
   - **图床模式**: 上传到图床
   - **关闭**: 不处理

#### 配置图床（仅图床模式）

1. 选择上传器类型：**PicGo** 或 **PicList**
2. 设置服务器地址（默认: `http://127.0.0.1:36677/upload`）
3. （可选）设置图片尺寸参数
4. （可选）配置域名黑名单

### 2. 日常使用

#### 粘贴/拖放图片

- **本地模式**: 图片自动转换、压缩、重命名并保存
- **图床模式**: 图片自动上传到图床，插入带尺寸的链接
- **关闭模式**: 使用 Obsidian 默认行为

#### 批量上传到图床

1. 按 `Cmd/Ctrl + P` 打开命令面板
2. 输入 **"Upload all images in current note to cloud"**
3. 自动上传所有本地图片并替换链接

#### 下载网络图片

1. 按 `Cmd/Ctrl + P` 打开命令面板
2. 输入 **"Download all network images in current note"**
3. 在预览对话框中：
   - 选择要下载的图片（支持全选/取消）
   - 选择下载模式（下载并替换/仅下载/仅替换）
   - 点击 **"开始"**

#### 右键菜单

右键点击图片可以：
- **Upload to cloud**: 上传到图床
- **Auto delete**: 智能删除（本地文件或云端同步）
- **Copy to clipboard**: 复制图片
- **Copy as Base64**: 复制为 Base64 编码
- **Resize**: 调整原图大小

### 3. 预设管理 (Presets)

#### Drop/paste Presets（仅本地模式）

快速应用预定义的处理组合：
- **转换预设**: 输出格式、质量、色深、调整模式
- **文件名预设**: 重命名规则、冲突处理
- **文件夹预设**: 输出路径
- **链接格式预设**: Markdown/Wiki、路径格式
- **尺寸预设**: 非破坏性调整参数

---

## 📥 安装 (Installation)

### 方法一：手动安装

1. 从 [Releases](https://github.com/RandyAllenEEE/obsidian-image-assistant/releases) 下载最新版本的 `main.js`, `styles.css`, `manifest.json`
2. 在您的 Obsidian 仓库中创建文件夹：`.obsidian/plugins/image-assistant/`
3. 将下载的文件放入该文件夹
4. 重启 Obsidian
5. 在 **设置 → 第三方插件** 中启用 **Image Assistant**

### 方法二：BRAT 安装（开发版）

1. 安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件
2. 在 BRAT 设置中添加：`RandyAllenEEE/obsidian-image-assistant`
3. 启用插件

---

## ⚙️ 配置说明 (Configuration)

### 粘贴处理设置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| Paste handling mode | 粘贴处理模式（本地/图床/关闭） | 本地模式 |
| Show window | 粘贴时是否显示预设选择窗口 | 从不显示 |

### 图床配置（图床模式）

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| Uploader | 上传器类型（PicGo/PicList/PicGo-Core） | PicGo |
| Upload server | PicGo 服务器地址 | `http://127.0.0.1:36677/upload` |
| Image width | 图片显示宽度（插入链接时的尺寸标记） | 未设置 |
| Image height | 图片显示高度 | 未设置 |
| Work on network | 是否处理网络图片 URL | 否 |
| Delete source | 上传成功后删除本地文件 | 否 |

### 本地处理配置（本地模式）

详见插件设置页面的各个预设选项卡。

---

## 🎯 使用场景 (Use Cases)

### 场景 1: 学术写作

**需求**: 粘贴大量截图，需要压缩并统一格式

**解决方案**:
1. 设置为本地模式
2. 创建转换预设：WEBP 格式，85% 质量，自动调整最长边 1200px
3. 粘贴图片自动处理，文件大小减少 60%

### 场景 2: 博客写作

**需求**: 所有图片上传到图床，使用 CDN 加速

**解决方案**:
1. 配置 PicList 或 PicGo
2. 设置为图床模式
3. 粘贴图片自动上传，插入图床链接
4. 使用批量上传功能处理已有图片

### 场景 3: 离线归档

**需求**: 将网络文章保存到本地，图片也要下载

**解决方案**:
1. 复制含有网络图片的文章到 Obsidian
2. 使用 "Download all network images" 命令
3. 选择 "下载并替换" 模式
4. 所有网络图片自动下载并替换为本地路径

### 场景 4: 混合管理

**需求**: 小图片本地存储，大图片上传图床

**解决方案**:
1. 默认使用本地模式
2. 对于大图片，右键选择 "Upload to cloud"
3. 灵活切换，按需处理

---

## 📚 文档 (Documentation)

- [变量参考指南](docs/Variables%20Reference%20Guide.md)
- [标注工具使用](docs/Annotation%20tool.md)
- [图片压缩最佳实践](docs/How%20to%20compress%20images%20without%20quality%20loss%20-%20empirical%20analysis%20of%20image%20format%20vs%20image%20quality%20vs%20file%20size.md)
- [PngQuant 优化说明](docs/pngquant.md)

---

## 🐛 问题反馈 (Issues & Support)

遇到问题或需要帮助？[提交 Issue](https://github.com/RandyAllenEEE/obsidian-image-assistant/issues)

如果这个插件对您有帮助，您的支持是项目持续发展的动力：

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/randyallen)

---

## 🔧 技术栈 (Tech Stack)

- **纯 JavaScript/TypeScript** - 无外部二进制依赖
- **FabricJS** - 标注功能
- **PicGo 协议** - 图床上传
- **image-type** - 图片类型检测

---

## 📜 开源协议 (License)

MIT License - see [LICENSE](LICENSE)

---

## 🙏 致谢 (Credits)

- **[xRyul](https://github.com/xRyul)** - Image Converter 核心功能
- **[renmu123](https://github.com/renmu123)** - Image Auto Upload 云端上传功能
- **[musug](https://github.com/musug)** - 最初的图片粘贴处理灵感
- **[FabricJS](https://fabricjs.com/)** - 强大的标注工具库

---

## 🗺️ 路线图 (Roadmap)

- [x] 本地图片处理与云端上传整合
- [x] 三种粘贴模式切换
- [x] 网络图片下载功能
- [x] 智能本地文件查找与替换
- [x] 批量上传功能
- [ ] 图床配置模板
- [ ] 更多图床支持（七牛云、又拍云等）
- [ ] 图片压缩质量预览
- [ ] 更多下载模式选项

---

**让图片管理更简单，让笔记创作更专注。**

**Making image management easier, letting you focus on note-taking.**
