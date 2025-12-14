# 设置 UI 实现指南

## 概述
这是在 `ImageConverterSettings.ts` 的 `display()` 方法中需要添加的 UI 代码,用于配置粘贴模式和图床设置。

## 添加位置
在 `display()` 方法中,建议在 "Global Preset Selector" 之后,其他设置之前添加。

## 完整代码

```typescript
// ========================================
// 粘贴处理模式设置
// ========================================
containerEl.createEl("h2", { text: "粘贴处理设置" });

new Setting(containerEl)
    .setName("粘贴处理模式 🛈")
    .setDesc("选择粘贴/拖放图片时的处理方式")
    .setTooltip("本地模式: 处理后保存到本地\n图床模式: 上传到图床\n关闭: 不处理,使用 Obsidian 默认行为")
    .addDropdown((dropdown) => {
        dropdown
            .addOption("local", "本地模式 (Local)")
            .addOption("cloud", "图床模式 (Cloud)")
            .addOption("disabled", "关闭 (Disabled)")
            .setValue(this.plugin.settings.pasteHandlingMode)
            .onChange(async (value: "local" | "cloud" | "disabled") => {
                this.plugin.settings.pasteHandlingMode = value;
                await this.plugin.saveSettings();
                // 刷新设置页面以显示/隐藏图床配置
                this.display();
            });
    });

// ========================================
// 图床配置(仅在图床模式下显示)
// ========================================
if (this.plugin.settings.pasteHandlingMode === 'cloud') {
    containerEl.createEl("h3", { text: "图床配置" });

    // 上传器类型
    new Setting(containerEl)
        .setName("上传器类型 🛈")
        .setDesc("选择使用 PicGo 或 PicGo-Core")
        .setTooltip("PicGo: 使用 PicGo/PicList 应用的 HTTP 接口\nPicGo-Core: 使用 PicGo-Core 命令行工具")
        .addDropdown((dropdown) => {
            dropdown
                .addOption("PicGo", "PicGo / PicList")
                .addOption("PicGo-Core", "PicGo-Core")
                .setValue(this.plugin.settings.cloudUploadSettings.uploader)
                .onChange(async (value) => {
                    this.plugin.settings.cloudUploadSettings.uploader = value;
                    await this.plugin.saveSettings();
                    this.display(); // 刷新以显示/隐藏相关配置
                });
        });

    // PicGo 服务器地址
    if (this.plugin.settings.cloudUploadSettings.uploader === 'PicGo') {
        new Setting(containerEl)
            .setName("PicGo 服务器地址 🛈")
            .setDesc("PicGo/PicList 的上传接口地址")
            .setTooltip("默认: http://127.0.0.1:36677/upload")
            .addText((text) => {
                text.setPlaceholder("http://127.0.0.1:36677/upload")
                    .setValue(this.plugin.settings.cloudUploadSettings.uploadServer)
                    .onChange(async (value) => {
                        this.plugin.settings.cloudUploadSettings.uploadServer = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttr('spellcheck', 'false');
            });

        new Setting(containerEl)
            .setName("PicList 删除服务器地址 🛈")
            .setDesc("PicList 的删除接口地址(可选)")
            .setTooltip("仅 PicList 支持,默认: http://127.0.0.1:36677/delete")
            .addText((text) => {
                text.setPlaceholder("http://127.0.0.1:36677/delete")
                    .setValue(this.plugin.settings.cloudUploadSettings.deleteServer)
                    .onChange(async (value) => {
                        this.plugin.settings.cloudUploadSettings.deleteServer = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttr('spellcheck', 'false');
            });

        new Setting(containerEl)
            .setName("远程服务器模式 🛈")
            .setDesc("是否使用远程 PicGo 服务")
            .setTooltip("移动端必须开启此选项")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.cloudUploadSettings.remoteServerMode)
                    .onChange(async (value) => {
                        this.plugin.settings.cloudUploadSettings.remoteServerMode = value;
                        await this.plugin.saveSettings();
                    })
            );
    }

    // PicGo-Core 路径
    if (this.plugin.settings.cloudUploadSettings.uploader === 'PicGo-Core') {
        new Setting(containerEl)
            .setName("PicGo-Core 可执行文件路径 🛈")
            .setDesc("PicGo-Core 命令行工具的路径")
            .setTooltip("留空则使用系统 PATH 中的 picgo 命令")
            .addText((text) => {
                text.setPlaceholder("/usr/local/bin/picgo")
                    .setValue(this.plugin.settings.cloudUploadSettings.picgoCorePath)
                    .onChange(async (value) => {
                        this.plugin.settings.cloudUploadSettings.picgoCorePath = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttr('spellcheck', 'false');
            });
    }

    // 图片尺寸设置
    containerEl.createEl("h4", { text: "图片尺寸标记" });
    
    new Setting(containerEl)
        .setName("图片宽度 🛈")
        .setDesc("在链接中显示的图片宽度(像素)")
        .setTooltip("留空则不限制宽度。设置后生成如 ![|800x](url) 的链接")
        .addText((text) => {
            text.setPlaceholder("例如: 800")
                .setValue(
                    this.plugin.settings.cloudUploadSettings.imageSizeWidth !== undefined
                        ? String(this.plugin.settings.cloudUploadSettings.imageSizeWidth)
                        : ""
                )
                .onChange(async (value) => {
                    const width = value.trim() === "" ? undefined : Number(value);
                    if (width !== undefined && (isNaN(width) || width <= 0)) {
                        new Notice("宽度必须是正整数");
                        return;
                    }
                    this.plugin.settings.cloudUploadSettings.imageSizeWidth = width;
                    await this.plugin.saveSettings();
                });
            text.inputEl.type = "number";
            text.inputEl.min = "1";
        });

    new Setting(containerEl)
        .setName("图片高度 🛈")
        .setDesc("在链接中显示的图片高度(像素)")
        .setTooltip("留空则不限制高度。设置后生成如 ![|x600](url) 的链接")
        .addText((text) => {
            text.setPlaceholder("例如: 600")
                .setValue(
                    this.plugin.settings.cloudUploadSettings.imageSizeHeight !== undefined
                        ? String(this.plugin.settings.cloudUploadSettings.imageSizeHeight)
                        : ""
                )
                .onChange(async (value) => {
                    const height = value.trim() === "" ? undefined : Number(value);
                    if (height !== undefined && (isNaN(height) || height <= 0)) {
                        new Notice("高度必须是正整数");
                        return;
                    }
                    this.plugin.settings.cloudUploadSettings.imageSizeHeight = height;
                    await this.plugin.saveSettings();
                });
            text.inputEl.type = "number";
            text.inputEl.min = "1";
        });

    // 高级选项
    containerEl.createEl("h4", { text: "高级选项" });

    new Setting(containerEl)
        .setName("应用网络图片 🛈")
        .setDesc("是否也上传已经在网络上的图片")
        .setTooltip("启用后会上传粘贴的网络图片URL")
        .addToggle((toggle) =>
            toggle
                .setValue(this.plugin.settings.cloudUploadSettings.workOnNetWork)
                .onChange(async (value) => {
                    this.plugin.settings.cloudUploadSettings.workOnNetWork = value;
                    await this.plugin.saveSettings();
                })
        );

    new Setting(containerEl)
        .setName("网络图片域名黑名单 🛈")
        .setDesc("不上传的网络图片域名列表,每行一个")
        .setTooltip("示例:\nexample.com\ncdn.example.net")
        .addTextArea((text) => {
            text.setValue(this.plugin.settings.cloudUploadSettings.newWorkBlackDomains)
                .onChange(async (value) => {
                    this.plugin.settings.cloudUploadSettings.newWorkBlackDomains = value;
                    await this.plugin.saveSettings();
                });
            text.inputEl.rows = 4;
            text.inputEl.setAttr('spellcheck', 'false');
        });

    new Setting(containerEl)
        .setName("剪贴板包含文本和图片时上传 🛈")
        .setDesc("如从 Excel 复制时同时有文本和图片,是否上传图片")
        .setTooltip("启用后即使剪贴板中有文本也会上传图片")
        .addToggle((toggle) =>
            toggle
                .setValue(this.plugin.settings.cloudUploadSettings.applyImage)
                .onChange(async (value) => {
                    this.plugin.settings.cloudUploadSettings.applyImage = value;
                    await this.plugin.saveSettings();
                })
        );

    new Setting(containerEl)
        .setName("上传后删除本地源文件 🛈")
        .setDesc("上传成功后是否删除本地临时文件")
        .setTooltip("启用后上传成功会自动删除本地文件,谨慎使用!")
        .addToggle((toggle) =>
            toggle
                .setValue(this.plugin.settings.cloudUploadSettings.deleteSource)
                .onChange(async (value) => {
                    this.plugin.settings.cloudUploadSettings.deleteSource = value;
                    await this.plugin.saveSettings();
                })
        );
}

// 分割线
containerEl.createEl("hr");
```

## 样式建议

可以在插件的 `styles.css` 中添加以下样式:

```css
/* 粘贴处理模式设置区域 */
.image-converter-settings-tab h2 {
    margin-top: 20px;
    margin-bottom: 10px;
    color: var(--text-accent);
}

.image-converter-settings-tab h3 {
    margin-top: 15px;
    margin-bottom: 8px;
    color: var(--text-muted);
    font-size: 1.1em;
}

.image-converter-settings-tab h4 {
    margin-top: 12px;
    margin-bottom: 6px;
    color: var(--text-faint);
    font-size: 1em;
}

/* 图床配置区域高亮 */
.image-converter-settings-tab .setting-item[data-cloud-setting] {
    border-left: 3px solid var(--interactive-accent);
    padding-left: 10px;
}
```

## 验证步骤

添加 UI 代码后:

1. **重启 Obsidian**
2. **打开插件设置**
3. **验证功能**:
   - [ ] 能看到"粘贴处理设置"标题
   - [ ] 粘贴处理模式下拉框正常显示
   - [ ] 切换到"图床模式"时显示图床配置区域
   - [ ] 切换到"本地模式"或"关闭"时隐藏图床配置
   - [ ] 在"图床模式"下切换上传器类型,相关配置正确显示/隐藏
   - [ ] 所有输入框和开关都能正常保存设置

## 调试技巧

### 查看设置是否保存
在浏览器控制台中运行:
```javascript
console.log(app.plugins.plugins['obsidian-image-converter'].settings);
```

### 强制刷新设置页面
在代码中调用 `this.display()` 会刷新整个设置页面。

### 检查配置值
添加调试语句:
```typescript
.onChange(async (value) => {
    console.log('Setting changed:', value);
    this.plugin.settings.cloudUploadSettings.uploadServer = value;
    await this.plugin.saveSettings();
});
```

## 注意事项

1. **数字输入验证**: 宽度和高度必须是正整数
2. **URL 验证**: 服务器地址应该是有效的 HTTP URL
3. **刷新时机**: 切换模式或上传器类型时需要调用 `this.display()` 刷新界面
4. **工具提示**: 使用 `setTooltip()` 提供详细说明
5. **描述文本**: 使用 `setDesc()` 提供简短描述

## 完成后的效果

设置页面应该显示:

```
┌─────────────────────────────────────┐
│  粘贴处理设置                         │
│  ├─ 粘贴处理模式 [下拉: 本地/图床/关闭]│
├─────────────────────────────────────┤
│  图床配置(仅在图床模式下显示)         │
│  ├─ 上传器类型 [PicGo/PicGo-Core]    │
│  ├─ PicGo 服务器地址 [文本框]         │
│  ├─ PicList 删除服务器地址 [文本框]   │
│  ├─ 远程服务器模式 [开关]             │
│  │                                    │
│  ├─ 图片尺寸标记                     │
│  │   ├─ 图片宽度 [数字输入]           │
│  │   └─ 图片高度 [数字输入]           │
│  │                                    │
│  └─ 高级选项                         │
│      ├─ 应用网络图片 [开关]           │
│      ├─ 网络图片域名黑名单 [文本域]   │
│      ├─ 剪贴板包含文本和图片时上传    │
│      └─ 上传后删除本地源文件 [开关]   │
├─────────────────────────────────────┤
│  (其他原有设置...)                   │
└─────────────────────────────────────┘
```

祝你实现顺利! 🚀
