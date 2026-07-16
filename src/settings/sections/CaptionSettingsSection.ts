import { Notice, Setting, setIcon } from 'obsidian';
import type ImageConverterPlugin from '../../main';
import { t } from '../../lang/helpers';
import { DEFAULT_SETTINGS } from '../defaults';
import type {
    CaptionSettings,
    SettingsUIState
} from '../types';

type CaptionTextKey =
    | 'skipExtensions'
    | 'fontSize'
    | 'fontWeight'
    | 'color'
    | 'letterSpacing'
    | 'backgroundColor'
    | 'marginTop'
    | 'padding'
    | 'border'
    | 'borderRadius';
type CaptionDropdownKey =
    | 'alignment'
    | 'fontStyle'
    | 'textTransform'
    | 'inlinePolicy'
    | 'widthMode';
type CaptionToggleKey = 'showInReadingMode' | 'showInLivePreview';
type CaptionRefreshMode = 'styles' | 'behavior';

const VISUAL_SETTING_KEYS = [
    'fontSize',
    'color',
    'fontStyle',
    'backgroundColor',
    'padding',
    'borderRadius',
    'opacity',
    'fontWeight',
    'textTransform',
    'letterSpacing',
    'border',
    'marginTop',
    'alignment'
] as const satisfies readonly (keyof CaptionSettings)[];

export function renderCaptionSettingsSection(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    settingsUIState: SettingsUIState,
    refreshDisplay: () => void
): void {
    const section = containerEl.createDiv('image-converter-settings-section');
    section.addClass('image-caption-settings-section');
    const content = section.createDiv('settings-section-content');

    const header = new Setting(section)
        .setName(t('SETTING_IMG_CAPTION_SECTION'))
        .setHeading()
        .addToggle(toggle => toggle
            .setValue(plugin.settings.captions.enabled)
            .onChange(async value => {
                plugin.settings.captions.enabled = value;
                await saveCaptionSetting(plugin, 'behavior');
                refreshDisplay();
                if (!value) new Notice(t('NOTICE_IMAGE_CAPTION_DISABLED'), 2000);
            }));

    section.prepend(header.settingEl);
    header.settingEl.addClass('settings-section-header');
    header.settingEl.style.cursor = 'pointer';
    const chevronContainer = header.nameEl.createSpan('settings-chevron-container');
    chevronContainer.style.marginRight = '8px';
    const chevronIcon = chevronContainer.createDiv();
    header.nameEl.prepend(chevronContainer);
    const updateChevron = () => {
        setIcon(chevronIcon, settingsUIState.imageCaptionSectionCollapsed
            ? 'chevron-right'
            : 'chevron-down');
        content.style.display = settingsUIState.imageCaptionSectionCollapsed ? 'none' : 'block';
    };
    updateChevron();
    header.settingEl.onclick = event => {
        if ((event.target as HTMLElement).closest('.checkbox-container')) return;
        settingsUIState.imageCaptionSectionCollapsed = !settingsUIState.imageCaptionSectionCollapsed;
        updateChevron();
    };

    if (!plugin.settings.captions.enabled) {
        content.empty();
        return;
    }

    let updatePreview: () => void = () => undefined;
    renderCaptionToggleSetting(content, plugin, {
        key: 'showInReadingMode',
        nameKey: 'SETTING_CAPTION_SHOW_READING',
        descKey: 'SETTING_CAPTION_SHOW_READING_DESC'
    });
    renderCaptionToggleSetting(content, plugin, {
        key: 'showInLivePreview',
        nameKey: 'SETTING_CAPTION_SHOW_LIVE_PREVIEW',
        descKey: 'SETTING_CAPTION_SHOW_LIVE_PREVIEW_DESC'
    });
    renderCaptionDropdownSetting(content, plugin, {
        key: 'inlinePolicy',
        nameKey: 'SETTING_CAPTION_INLINE_POLICY',
        descKey: 'SETTING_CAPTION_INLINE_POLICY_DESC',
        options: {
            all: t('SETTING_CAPTION_INLINE_ALL'),
            'standalone-only': t('SETTING_CAPTION_INLINE_STANDALONE')
        },
        refreshMode: 'behavior'
    });
    renderCaptionDropdownSetting(content, plugin, {
        key: 'widthMode',
        nameKey: 'SETTING_CAPTION_WIDTH_MODE',
        descKey: 'SETTING_CAPTION_WIDTH_MODE_DESC',
        options: {
            auto: t('SETTING_CAPTION_WIDTH_AUTO'),
            container: t('SETTING_CAPTION_WIDTH_CONTAINER')
        },
        refreshMode: 'behavior'
    });
    renderCaptionMaxLinesSetting(content, plugin, () => updatePreview());
    renderCaptionTextSetting(content, plugin, {
        key: 'skipExtensions',
        nameKey: 'SETTING_CAPTION_SKIP_EXT',
        descKey: 'SETTING_CAPTION_SKIP_EXT_DESC',
        placeholder: t('SETTING_CAPTION_SKIP_EXT_PLACEHOLDER'),
        refreshMode: 'behavior'
    });

    updatePreview = renderCaptionPreview(content, plugin);

    renderCaptionDropdownSetting(content, plugin, {
        key: 'alignment',
        nameKey: 'SETTING_CAPTION_ALIGN',
        descKey: 'SETTING_CAPTION_ALIGN_DESC',
        options: {
            left: t('SETTING_CAPTION_ALIGN_LEFT'),
            center: t('SETTING_CAPTION_ALIGN_CENTER'),
            right: t('SETTING_CAPTION_ALIGN_RIGHT')
        },
        onChange: updatePreview,
        refreshMode: 'behavior'
    });
    renderCaptionTextSetting(content, plugin, {
        key: 'fontSize',
        nameKey: 'SETTING_CAPTION_FONT_SIZE',
        descKey: 'SETTING_CAPTION_FONT_SIZE_DESC',
        placeholder: t('SETTING_CAPTION_FONT_SIZE_PLACEHOLDER'),
        onChange: updatePreview
    });
    renderCaptionDropdownSetting(content, plugin, {
        key: 'fontStyle',
        nameKey: 'SETTING_CAPTION_FONT_STYLE',
        descKey: 'SETTING_CAPTION_FONT_STYLE_DESC',
        options: {
            italic: t('SETTING_CAPTION_FONT_STYLE_ITALIC'),
            normal: t('SETTING_CAPTION_FONT_STYLE_NORMAL')
        },
        onChange: updatePreview
    });
    renderCaptionTextSetting(content, plugin, {
        key: 'fontWeight',
        nameKey: 'SETTING_CAPTION_FONT_WEIGHT',
        descKey: 'SETTING_CAPTION_FONT_WEIGHT_DESC',
        placeholder: 'normal, bold, 600',
        onChange: updatePreview
    });
    renderCaptionTextSetting(content, plugin, {
        key: 'color',
        nameKey: 'SETTING_CAPTION_COLOR',
        descKey: 'SETTING_CAPTION_COLOR_DESC',
        placeholder: t('SETTING_CAPTION_COLOR_PLACEHOLDER'),
        onChange: updatePreview
    });
    renderCaptionOpacitySetting(content, plugin, updatePreview);
    renderCaptionDropdownSetting(content, plugin, {
        key: 'textTransform',
        nameKey: 'SETTING_CAPTION_TRANSFORM',
        descKey: 'SETTING_CAPTION_TRANSFORM_DESC',
        options: {
            none: t('SETTING_CAPTION_TRANSFORM_NONE'),
            uppercase: t('SETTING_CAPTION_TRANSFORM_UPPERCASE'),
            lowercase: t('SETTING_CAPTION_TRANSFORM_LOWERCASE'),
            capitalize: t('SETTING_CAPTION_TRANSFORM_CAPITALIZE')
        },
        onChange: updatePreview
    });

    const remainingTextSettings: Array<{
        key: CaptionTextKey;
        nameKey: Parameters<typeof t>[0];
        descKey: Parameters<typeof t>[0];
        placeholder: string;
    }> = [
        { key: 'letterSpacing', nameKey: 'SETTING_CAPTION_LETTER_SPACING', descKey: 'SETTING_CAPTION_LETTER_SPACING_DESC', placeholder: 'normal, 0.02em, 1px' },
        { key: 'backgroundColor', nameKey: 'SETTING_CAPTION_BG_COLOR', descKey: 'SETTING_CAPTION_BG_COLOR_DESC', placeholder: 'transparent, var(--background-secondary), rgba(0,0,0,0.05)' },
        { key: 'marginTop', nameKey: 'SETTING_CAPTION_MARGIN_TOP', descKey: 'SETTING_CAPTION_MARGIN_TOP_DESC', placeholder: '4px, 0.5em' },
        { key: 'padding', nameKey: 'SETTING_CAPTION_PADDING', descKey: 'SETTING_CAPTION_PADDING_DESC', placeholder: '0, 2px 4px, 4px 8px' },
        { key: 'border', nameKey: 'SETTING_CAPTION_BORDER', descKey: 'SETTING_CAPTION_BORDER_DESC', placeholder: 'none, 1px solid var(--background-modifier-border)' },
        { key: 'borderRadius', nameKey: 'SETTING_CAPTION_BORDER_RADIUS', descKey: 'SETTING_CAPTION_BORDER_RADIUS_DESC', placeholder: '0, 4px' }
    ];
    for (const options of remainingTextSettings) {
        renderCaptionTextSetting(content, plugin, { ...options, onChange: updatePreview });
    }

    new Setting(content)
        .setName(t('SETTING_CAPTION_RESET_STYLES'))
        .setDesc(t('SETTING_CAPTION_RESET_STYLES_DESC'))
        .addExtraButton(button => button
            .setIcon('rotate-ccw')
            .setTooltip(t('SETTING_CAPTION_RESET_STYLES_TOOLTIP'))
            .onClick(async () => {
                resetVisualSettings(plugin.settings.captions);
                updatePreview();
                await saveCaptionSetting(plugin, 'behavior');
                refreshDisplay();
            }));
}

async function saveCaptionSetting(
    plugin: ImageConverterPlugin,
    refreshMode: CaptionRefreshMode
): Promise<void> {
    await plugin.saveSettings();
    if (refreshMode === 'styles') {
        plugin.imageCaption?.updateStyles();
        return;
    }

    plugin.imageCaption?.applyCaptionClass?.();
    if (plugin.imageCaption?.refreshAllViews) {
        plugin.imageCaption.refreshAllViews();
        plugin.imageCaption.updateStyles();
    } else {
        plugin.imageCaption?.refresh();
    }
}

function renderCaptionTextSetting(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    options: {
        key: CaptionTextKey;
        nameKey: Parameters<typeof t>[0];
        descKey?: Parameters<typeof t>[0];
        placeholder?: string;
        refreshMode?: CaptionRefreshMode;
        onChange?: () => void;
    }
): void {
    const setting = new Setting(containerEl).setName(t(options.nameKey));
    if (options.descKey) setting.setDesc(t(options.descKey));
    setting.addText(text => text
        .setPlaceholder(options.placeholder ?? '')
        .setValue(plugin.settings.captions[options.key])
        .onChange(async value => {
            setCaptionSetting(plugin.settings.captions, options.key, value);
            options.onChange?.();
            await saveCaptionSetting(plugin, options.refreshMode ?? 'styles');
        }));
}

function renderCaptionDropdownSetting<K extends CaptionDropdownKey>(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    options: {
        key: K;
        nameKey: Parameters<typeof t>[0];
        descKey?: Parameters<typeof t>[0];
        options: Record<string, string>;
        refreshMode?: CaptionRefreshMode;
        onChange?: () => void;
    }
): void {
    const setting = new Setting(containerEl).setName(t(options.nameKey));
    if (options.descKey) setting.setDesc(t(options.descKey));
    setting.addDropdown(dropdown => dropdown
        .addOptions(options.options)
        .setValue(plugin.settings.captions[options.key])
        .onChange(async value => {
            if (!Object.prototype.hasOwnProperty.call(options.options, value)) return;
            setCaptionSetting(
                plugin.settings.captions,
                options.key,
                value as CaptionSettings[K]
            );
            options.onChange?.();
            await saveCaptionSetting(plugin, options.refreshMode ?? 'styles');
        }));
}

function renderCaptionToggleSetting(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    options: {
        key: CaptionToggleKey;
        nameKey: Parameters<typeof t>[0];
        descKey: Parameters<typeof t>[0];
    }
): void {
    new Setting(containerEl)
        .setName(t(options.nameKey))
        .setDesc(t(options.descKey))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.captions[options.key])
            .onChange(async value => {
                setCaptionSetting(plugin.settings.captions, options.key, value);
                await saveCaptionSetting(plugin, 'behavior');
            }));
}

function renderCaptionOpacitySetting(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    onChange: () => void
): void {
    new Setting(containerEl)
        .setName(t('SETTING_CAPTION_OPACITY'))
        .setDesc(t('SETTING_CAPTION_OPACITY_DESC'))
        .addSlider(slider => slider
            .setLimits(0, 1, 0.05)
            .setValue(normalizeOpacity(plugin.settings.captions.opacity))
            .setDynamicTooltip()
            .onChange(async value => {
                plugin.settings.captions.opacity = Number(value.toFixed(2)).toString();
                onChange();
                await saveCaptionSetting(plugin, 'styles');
            }));
}

function renderCaptionMaxLinesSetting(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    onChange: () => void
): void {
    const setting = new Setting(containerEl).setName(t('SETTING_CAPTION_MAX_LINES'));
    const updateDescription = (value: number) => setting.setDesc(value === 0
        ? t('SETTING_CAPTION_MAX_LINES_UNLIMITED')
        : t('SETTING_CAPTION_MAX_LINES_LIMIT', [value]));
    updateDescription(plugin.settings.captions.maxLines);
    setting.addSlider(slider => slider
        .setLimits(0, 5, 1)
        .setValue(plugin.settings.captions.maxLines)
        .setDynamicTooltip()
        .onChange(async value => {
            const maxLines = Math.min(5, Math.max(0, Math.round(value)));
            plugin.settings.captions.maxLines = maxLines;
            updateDescription(maxLines);
            onChange();
            await saveCaptionSetting(plugin, 'behavior');
        }));
}

function renderCaptionPreview(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin
): () => void {
    const setting = new Setting(containerEl)
        .setName(t('SETTING_CAPTION_PREVIEW'))
        .setDesc(t('SETTING_CAPTION_PREVIEW_DESC'));
    const preview = setting.controlEl.createDiv('image-assistant-caption-settings-preview');
    const image = preview.createDiv('image-assistant-caption-preview-image');
    image.setAttribute('aria-hidden', 'true');
    const caption = preview.createSpan({ cls: 'image-assistant-caption-preview-text' });
    caption.textContent = t('SETTING_CAPTION_PREVIEW_TEXT');

    const update = () => {
        const settings = plugin.settings.captions;
        Object.assign(caption.style, {
            fontSize: settings.fontSize,
            color: settings.color,
            fontStyle: settings.fontStyle,
            backgroundColor: settings.backgroundColor,
            padding: settings.padding,
            borderRadius: settings.borderRadius,
            opacity: settings.opacity,
            fontWeight: settings.fontWeight,
            textTransform: settings.textTransform,
            letterSpacing: settings.letterSpacing,
            border: settings.border,
            marginTop: settings.marginTop,
            textAlign: settings.alignment
        });
        caption.style.removeProperty('-webkit-line-clamp');
        caption.style.removeProperty('-webkit-box-orient');
        caption.style.overflow = '';
        caption.style.display = 'block';
        caption.title = '';
        if (settings.maxLines > 0) {
            caption.style.display = '-webkit-box';
            caption.style.setProperty('-webkit-box-orient', 'vertical');
            caption.style.setProperty('-webkit-line-clamp', settings.maxLines.toString());
            caption.style.overflow = 'hidden';
            caption.title = caption.textContent ?? '';
        }
    };
    update();
    return update;
}

function resetVisualSettings(settings: CaptionSettings): void {
    for (const key of VISUAL_SETTING_KEYS) {
        setCaptionSetting(settings, key, DEFAULT_SETTINGS.captions[key]);
    }
}

function setCaptionSetting<K extends keyof CaptionSettings>(
    settings: CaptionSettings,
    key: K,
    value: CaptionSettings[K]
): void {
    settings[key] = value;
}

function normalizeOpacity(value: string): number {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(1, Math.max(0, parsed));
}
