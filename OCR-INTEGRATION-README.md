# OCR & LaTeX 功能集成说明

## 功能概述

Image Assistant 插件现已成功集成 OCR & LaTeX 功能,支持将剪贴板图片转换为 LaTeX 或 Markdown 格式。

## 已实现的核心改进

### 1. LaTeX 语法 $ 包裹的自动清洗
- 自动移除 LLM 输出中的多余 $ 符号
- 移除 markdown 代码块标记 (```latex 或 ```)
- 确保 LaTeX 结果干净可用

### 2. gather 环境的智能化添加
- 自动检测多行公式中的换行符 (\\)
- 智能添加 gather 环境包裹多行公式
- 优化 LaTeX 渲染效果

### 3. 内联/多行模式改进逻辑
- 内联模式：使用单 $ 包裹
- 多行模式：使用 $$ 包裹,并智能添加环境
- 符合 LaTeX 最佳实践

### 4. LLM 支持
- 支持 OpenAI-compatible API endpoint
- 可自定义 LaTeX 和 Markdown 提示词
- 灵活的 maxTokens 配置
- 完整的错误处理

## 可用命令

1. **OCR: Generate multiline LaTeX from clipboard image**
   - 将剪贴板图片转换为多行 LaTeX 公式 (使用 $$)
   
2. **OCR: Generate inline LaTeX from clipboard image**
   - 将剪贴板图片转换为内联 LaTeX 公式 (使用 $)

3. **OCR: Generate markdown from clipboard image**
   - 将剪贴板图片转换为 Markdown 格式

## 支持的 OCR 提供商

### 1. SimpleTex
- 网络服务
- 需要 API token
- 配置: `settings.ocrSettings.simpleTexToken`

### 2. Pix2Tex
- 自托管服务
- 支持基本认证
- 配置:
  - `settings.ocrSettings.pix2tex.url`
  - `settings.ocrSettings.pix2tex.username`
  - `settings.ocrSettings.pix2tex.password`

### 3. Texify
- 自托管服务
- 支持 LaTeX 和 Markdown
- 配置:
  - `settings.ocrSettings.texify.url`
  - `settings.ocrSettings.texify.username`
  - `settings.ocrSettings.texify.password`

### 4. LLM (OpenAI-compatible)
- 支持任何 OpenAI-compatible API
- 高度可定制
- 配置:
  - `settings.ocrSettings.aiModel.endpoint`
  - `settings.ocrSettings.aiModel.model`
  - `settings.ocrSettings.aiModel.apiKey`
  - `settings.ocrSettings.aiModel.maxTokens`
  - `settings.ocrSettings.aiModel.prompts.latex`
  - `settings.ocrSettings.aiModel.prompts.markdown`

## 配置方法

由于设置面板 UI 尚未实现,暂时需要手动编辑配置文件:

1. 打开 `.obsidian/plugins/image-assistant/data.json`
2. 找到 `ocrSettings` 部分
3. 修改相应的配置项

### 配置示例

```json
{
  "ocrSettings": {
    "simpleTexToken": "your-token-here",
    "latexProvider": "LLM",
    "markdownProvider": "LLM",
    "texify": {
      "url": "http://127.0.0.1:5000/predict",
      "username": "",
      "password": ""
    },
    "pix2tex": {
      "url": "http://127.0.0.1:8502/predict/",
      "username": "",
      "password": ""
    },
    "aiModel": {
      "endpoint": "https://api.openai.com/v1/chat/completions",
      "model": "gpt-4-vision-preview",
      "apiKey": "sk-your-api-key",
      "maxTokens": 300,
      "prompts": {
        "latex": "Convert the math equation in the image to LaTeX format. Output only the LaTeX code without wrapping $ or $$.",
        "markdown": "Convert the content in the image to Markdown format."
      }
    }
  }
}
```

## 使用流程

1. 复制包含数学公式或文本的图片到剪贴板
2. 在 Obsidian 中打开命令面板 (Ctrl/Cmd + P)
3. 选择对应的 OCR 命令:
   - 多行 LaTeX: `OCR: Generate multiline LaTeX from clipboard image`
   - 内联 LaTeX: `OCR: Generate inline LaTeX from clipboard image`
   - Markdown: `OCR: Generate markdown from clipboard image`
4. 等待处理完成,结果将自动插入到光标位置

## 功能独立性

**重要**: OCR 功能与图片处理功能完全独立:
- OCR 转换**不会**自动触发图床上传
- OCR 转换**不会**触发本地图片处理
- OCR 只负责将剪贴板图片转换为文本结果
- 插入的是文本内容,不是图片链接

## Frontmatter 笔记级别模式控制

现在可以通过 Frontmatter 为单个笔记设置粘贴模式:

1. 执行命令: `Image Assistant: Configure paste mode for current note`
2. 在弹出的模态框中选择:
   - 📁 Set to Local Mode
   - ☁️ Set to Cloud Mode
   - 🔄 Use Global Setting

这将在当前笔记的 Frontmatter 中添加/修改/删除 `image_paste_mode` 字段,仅影响当前笔记。

## 待完成项

1. **设置面板 UI**: OCR 配置的可视化界面
2. **文件结构重组**: 模块化目录结构优化
3. **更多测试**: 各种OCR提供商的测试验证

## 技术细节

### 文件结构

```
src/
├── ocr/
│   ├── OCRSettings.ts          # OCR 设置接口和默认值
│   ├── EditorInteract.ts       # 编辑器交互类
│   └── providers/
│       ├── index.ts            # Provider 工厂函数
│       ├── AIModelConverter.ts # LLM Provider (包含4个核心改进)
│       ├── SimpleTex.ts        # SimpleTex Provider
│       ├── Pix2Tex.ts          # Pix2Tex Provider
│       └── Texify.ts           # Texify Provider
├── main.ts                     # 主插件文件 (添加了OCR命令和方法)
├── ImageConverterSettings.ts   # 主设置 (添加了ocrSettings字段)
└── PasteModeConfigModal.ts    # Frontmatter 模式配置模态框
```

### 核心改进实现位置

所有4个核心改进都在 `src/ocr/providers/AIModelConverter.ts` 中实现:
- 第75-82行: 核心改进 1 (LaTeX 清洗)
- 第91-100行: 核心改进 2 & 3 (gather环境 + 内联/多行模式)
- 第25-68行: 核心改进 4 (LLM 支持)

## 故障排除

### 问题: "No image found in clipboard"
- 确保已经复制了图片到剪贴板
- 尝试使用屏幕截图工具重新截图

### 问题: "Failed to read clipboard image"
- 确保在桌面端运行 (需要 Electron)
- 检查 Obsidian 是否有权限访问剪贴板

### 问题: OCR 请求失败
- 检查网络连接
- 验证 API key 或 token 是否正确
- 检查自托管服务是否运行
- 查看控制台错误日志获取详细信息

## 贡献

本集成基于以下原始项目:
- obsidian-ocrlatex (原始插件 + 用户改进)
- obsidian-image-auto-upload-plugin
- obsidian-image-converter

感谢这些项目的作者和贡献者。
