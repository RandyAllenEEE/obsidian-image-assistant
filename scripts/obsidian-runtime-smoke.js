#!/usr/bin/env node

const DEFAULT_COMMAND_IDS = [
    'process-all-vault-images',
    'process-all-images-current-note',
    'open-image-converter-settings',
    'clean-unused-files',
    'process-folder-images',
    'upload-all-vault-images',
    'upload-all-images-current-note',
    'upload-folder-images',
    'download-network-images-current-note',
    'download-network-images-folder',
    'download-network-images-vault',
    'configure-paste-mode-current-note',
    'ocr-latex-multiline',
    'ocr-latex-inline',
    'ocr-markdown',
    'reload-plugin'
];

function readArgument(name, fallback) {
    const prefix = `--${name}=`;
    const argument = process.argv.slice(2).find(value => value.startsWith(prefix));
    return argument ? argument.slice(prefix.length) : fallback;
}

class CdpClient {
    constructor(url) {
        this.url = url;
        this.nextId = 1;
        this.pending = new Map();
        this.events = [];
    }

    async connect() {
        this.socket = new WebSocket(this.url);
        this.socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id);
                clearTimeout(pending.timeout);
                if (message.error) pending.reject(new Error(message.error.message));
                else pending.resolve(message.result);
                return;
            }
            this.events.push(message);
        });
        await new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP request timed out: ${method}`));
            }, 15000);
            this.pending.set(id, { resolve, reject, timeout });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const response = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true
        });
        if (response.exceptionDetails) {
            throw new Error(response.exceptionDetails.exception?.description
                ?? response.exceptionDetails.text);
        }
        return response.result.value;
    }

    close() {
        for (const { reject, timeout } of this.pending.values()) {
            clearTimeout(timeout);
            reject(new Error('CDP connection closed'));
        }
        this.pending.clear();
        this.socket.close();
    }
}

async function getPageTarget(port) {
    let response;
    try {
        response = await fetch(`http://127.0.0.1:${port}/json/list`);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Cannot connect to Obsidian CDP on 127.0.0.1:${port}. `
            + `Start an isolated Obsidian profile with --remote-debugging-port=${port} (${detail}).`
        );
    }
    if (!response.ok) throw new Error(`DevTools target lookup failed with HTTP ${response.status}`);
    const targets = await response.json();
    const page = targets.find(target => target.type === 'page' && target.url.startsWith('app://obsidian.md/'));
    if (!page) throw new Error('No Obsidian page target is available');
    return page;
}

async function main() {
    const port = Number(readArgument('port', '9229'));
    const expectedVersion = readArgument('version', null);
    const notePath = readArgument('note', 'Acceptance.md');
    const enableCommunityPlugins = readArgument('enable-community-plugins', 'false') === 'true';
    const enableRuntimeEvents = readArgument('runtime-events', 'true') === 'true';
    const loadPluginByHarness = readArgument('load-plugin', 'true') === 'true';
    const expectCaptions = readArgument('expect-captions', 'true') === 'true';
    const checkLifecycle = readArgument('lifecycle', 'true') === 'true';
    const extended = readArgument('extended', 'false') === 'true';
    const verbose = readArgument('verbose', 'false') === 'true';
    const progress = message => {
        if (verbose) console.error(`[obsidian-smoke] ${message}`);
    };
    const pluginId = 'obsidian-image-assistant';
    const target = await getPageTarget(port);
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();

    try {
        if (enableRuntimeEvents) {
            await client.send('Runtime.enable');
            await client.send('Log.enable');
        }
        progress('checking startup state');
        const startup = await client.evaluate(`(async () => {
            const timeoutAt = Date.now() + 30000;
            while (Date.now() < timeoutAt) {
                if (globalThis.app?.workspace?.layoutReady) break;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            const application = globalThis.app;
            if (!application?.workspace?.layoutReady) {
                throw new Error('Obsidian workspace did not become ready');
            }
            const managerInitiallyEnabled = application.plugins.isEnabled();
            let managerEnabledByHarness = false;
            if (!managerInitiallyEnabled && ${JSON.stringify(enableCommunityPlugins)}) {
                localStorage.setItem('enable-plugin-' + application.appId, 'true');
                managerEnabledByHarness = true;
            }
            let plugin = application.plugins.plugins[${JSON.stringify(pluginId)}];
            let loadedByHarness = false;
            let harnessLoadError = null;
            if (!plugin
                && ${JSON.stringify(loadPluginByHarness)}
                && application.plugins.manifests[${JSON.stringify(pluginId)}]) {
                try {
                    await application.plugins.loadPlugin(${JSON.stringify(pluginId)});
                    loadedByHarness = true;
                    plugin = application.plugins.plugins[${JSON.stringify(pluginId)}];
                } catch (error) {
                    harnessLoadError = error instanceof Error ? error.stack ?? error.message : String(error);
                }
            }
            return {
                title: document.title,
                vaultName: application.vault.getName(),
                vaultConfigDir: application.vault.configDir,
                activeViewMode: application.workspace.activeLeaf?.view?.getMode?.() ?? null,
                activeViewClasses: application.workspace.activeLeaf?.view?.containerEl?.className ?? null,
                pluginLoaded: !!plugin,
                pluginVersion: plugin?.manifest?.version ?? null,
                loadedByHarness,
                harnessLoadError,
                managerInitiallyEnabled,
                managerEnabledByHarness,
                manifestDiscovered: application.plugins.manifests[${JSON.stringify(pluginId)}] ?? null,
                enabledPluginIds: [...application.plugins.enabledPlugins].sort(),
                pluginManagerState: {
                    managerEnabled: application.plugins.isEnabled()
                },
                pluginLoadError: application.plugins.loadErrors?.get?.(${JSON.stringify(pluginId)})
                    ?? application.plugins.loadErrors?.[${JSON.stringify(pluginId)}]
                    ?? null,
                commandIds: Object.keys(application.commands.commands)
                    .filter(id => id.startsWith(${JSON.stringify(`${pluginId}:`)}))
                    .sort(),
                stylePresent: !!document.querySelector('link[href*="obsidian-image-assistant/styles.css"]')
                    || document.body.classList.contains('image-captions-enabled'),
                captionStylesPresent: !!document.getElementById('image-caption-styles'),
                settings: plugin ? {
                    batchConcurrency: plugin.settings?.global?.batchConcurrency,
                    captionEnabled: plugin.settings?.captions?.enabled,
                    pasteMode: plugin.settings?.pasteHandling?.mode
                } : null
            };
        })()`);

        const requiredCommands = DEFAULT_COMMAND_IDS.map(id => `${pluginId}:${id}`);
        const missingCommands = requiredCommands.filter(id => !startup.commandIds.includes(id));
        const failures = [];
        if (!startup.pluginLoaded) failures.push('plugin did not load');
        if (expectedVersion && startup.pluginVersion !== expectedVersion) {
            failures.push(`plugin version is ${startup.pluginVersion}, expected ${expectedVersion}`);
        }
        if (missingCommands.length) failures.push(`missing commands: ${missingCommands.join(', ')}`);
        if (!startup.stylePresent) failures.push('plugin styles/body state are missing');
        if (!startup.captionStylesPresent) failures.push('caption runtime styles are missing');
        if (startup.settings?.batchConcurrency !== 3) failures.push('default batch concurrency is not 3');
        if (startup.settings?.captionEnabled !== true) failures.push('captions are not enabled by default');

        progress('checking settings command');
        const settings = await client.evaluate(`(async () => {
            const commandId = ${JSON.stringify(`${pluginId}:open-image-converter-settings`)};
            const executed = globalThis.app.commands.executeCommandById(commandId);
            await new Promise(resolve => setTimeout(resolve, 500));
            const setting = globalThis.app.setting;
            const activeTabId = setting?.activeTab?.id ?? setting?.activeTab?.plugin?.manifest?.id ?? null;
            const open = !!document.querySelector('.modal.mod-settings, .settings-modal');
            setting?.close?.();
            return { executed, open, activeTabId };
        })()`);
        if (!settings.executed || !settings.open || settings.activeTabId !== pluginId) {
            failures.push(`settings command failed: ${JSON.stringify(settings)}`);
        }

        progress('checking reading-mode captions');
        const captions = await client.evaluate(`(async () => {
            const application = globalThis.app;
            const file = application.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
            if (!file) throw new Error('Acceptance note was not found');
            const leaf = application.workspace.getLeaf(false);
            await leaf.setViewState({
                type: 'markdown',
                state: { file: file.path, mode: 'preview' },
                active: true
            });
            await new Promise(resolve => setTimeout(resolve, 1500));
            const view = leaf.view;
            const container = view.containerEl;
            const images = [...container.querySelectorAll('img')];
            const captionNodes = [...container.querySelectorAll('[data-image-assistant-caption-node]')];
            return {
                imageCount: images.length,
                captions: captionNodes.map(node => node.textContent?.trim()),
                altValues: images.map(image => image.getAttribute('alt')),
                ownedHosts: container.querySelectorAll('[data-image-assistant-caption-owner]').length,
                captionNodeCount: captionNodes.length
            };
        })()`);
        if (expectCaptions) {
            for (const expectedCaption of ['Local caption', 'Network caption']) {
                if (!captions.captions.includes(expectedCaption)) {
                    failures.push(`caption did not render: ${expectedCaption}`);
                }
            }
            if (captions.altValues.length < 2 || !captions.altValues.includes('Network caption')) {
                failures.push('native image alt text was not preserved');
            }
        }

        progress('checking Live Preview and Source Mode captions');
        const editorModes = await client.evaluate(`(async () => {
            const application = globalThis.app;
            const file = application.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
            const leaf = application.workspace.activeLeaf;
            if (!file || !leaf) throw new Error('Acceptance editor leaf was not found');

            await leaf.setViewState({
                type: 'markdown',
                state: { file: file.path, mode: 'source', source: false },
                active: true
            });
            await new Promise(resolve => setTimeout(resolve, 700));
            const livePreviewContainer = leaf.view.containerEl;
            const livePreviewCaptions = [...livePreviewContainer
                .querySelectorAll('.image-assistant-live-preview-caption')]
                .map(node => node.textContent?.trim());
            const livePreviewClass = livePreviewContainer
                .querySelector('.markdown-source-view')?.className ?? null;

            await leaf.setViewState({
                type: 'markdown',
                state: { file: file.path, mode: 'source', source: true },
                active: true
            });
            await new Promise(resolve => setTimeout(resolve, 300));
            const sourceWidgets = [...leaf.view.containerEl
                .querySelectorAll('.image-assistant-live-preview-caption')];
            const visibleSourceWidgets = sourceWidgets.filter(node =>
                getComputedStyle(node).display !== 'none'
            ).length;

            await leaf.setViewState({
                type: 'markdown',
                state: { file: file.path, mode: 'preview' },
                active: true
            });
            await new Promise(resolve => setTimeout(resolve, 500));
            return {
                livePreviewCaptions,
                livePreviewClass,
                sourceWidgetCount: sourceWidgets.length,
                visibleSourceWidgets
            };
        })()`);
        if (expectCaptions) {
            for (const expectedCaption of ['Local caption', 'Network caption']) {
                if (!editorModes.livePreviewCaptions.includes(expectedCaption)) {
                    failures.push(`Live Preview caption did not render: ${expectedCaption}`);
                }
            }
            if (editorModes.visibleSourceWidgets !== 0) {
                failures.push('caption widgets remain visible in Source Mode');
            }
        }

        let pasteDispatch = { skipped: true };
        let batchCommands = { skipped: true };
        let annotation = { skipped: true };
        let captionLayout = { skipped: true };
        let livePreviewAlignment = { skipped: true };
        if (extended) {
            progress('checking multi-pane, popout, and caption layout bounds');
            captionLayout = await client.evaluate(`(async () => {
                const application = globalThis.app;
                const plugin = application.plugins.plugins[${JSON.stringify(pluginId)}];
                const file = application.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
                if (!plugin || !file) throw new Error('Caption layout smoke prerequisites are missing');

                const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                const original = {
                    inlinePolicy: plugin.settings.captions.inlinePolicy,
                    widthMode: plugin.settings.captions.widthMode,
                    maxLines: plugin.settings.captions.maxLines,
                    showInReadingMode: plugin.settings.captions.showInReadingMode
                };
                Object.assign(plugin.settings.captions, {
                    inlinePolicy: 'all',
                    widthMode: 'container',
                    maxLines: 2,
                    showInReadingMode: true
                });

                const primaryLeaf = application.workspace.activeLeaf;
                await primaryLeaf.setViewState({
                    type: 'markdown',
                    state: { file: file.path, mode: 'preview' },
                    active: true
                });
                const splitLeaf = application.workspace.getLeaf('split');
                await splitLeaf.setViewState({
                    type: 'markdown',
                    state: { file: file.path, mode: 'preview' },
                    active: false
                });

                let popoutLeaf = null;
                let popoutError = null;
                try {
                    popoutLeaf = application.workspace.getLeaf('window');
                    await popoutLeaf.setViewState({
                        type: 'markdown',
                        state: { file: file.path, mode: 'preview' },
                        active: false
                    });
                } catch (error) {
                    popoutError = error instanceof Error ? error.message : String(error);
                }

                plugin.imageCaption.refresh();
                await sleep(1200);

                const inspectRenderedLeaf = leaf => {
                    const container = leaf?.view?.containerEl;
                    const ownerDocument = container?.ownerDocument;
                    if (!container || !ownerDocument) return null;
                    const captions = [...container.querySelectorAll(
                        '.image-assistant-caption[data-image-assistant-caption-renderer="dom"]'
                    )];
                    return {
                        ownerIsMainDocument: ownerDocument === document,
                        stylePresent: !!ownerDocument.getElementById('image-caption-styles'),
                        bodyEnabled: ownerDocument.body.classList.contains('image-captions-enabled'),
                        captionCount: captions.length,
                        allOwnedByDom: captions.every(node =>
                            node.getAttribute('data-image-assistant-caption-renderer') === 'dom'
                        )
                    };
                };

                const inspectFixture = ownerDocument => {
                    if (!ownerDocument?.body) return null;
                    const root = ownerDocument.createElement('div');
                    root.style.width = '280px';
                    root.style.maxWidth = '280px';
                    root.style.position = 'fixed';
                    root.style.left = '20px';
                    root.style.top = '20px';
                    root.style.zIndex = '-1';
                    root.className = 'markdown-reading-view';

                    const standalone = ownerDocument.createElement('p');
                    const longImage = ownerDocument.createElement('img');
                    longImage.src = 'https://example.com/caption-smoke.png';
                    longImage.alt = 'Native long alt';
                    longImage.title = 'Native long title';
                    longImage.style.width = '180px';
                    longImage.style.height = '80px';
                    standalone.appendChild(longImage);
                    root.appendChild(standalone);

                    const inline = ownerDocument.createElement('p');
                    inline.append('before ');
                    const first = ownerDocument.createElement('img');
                    first.src = 'https://example.com/inline-one.png';
                    first.style.width = '48px';
                    first.style.height = '32px';
                    inline.append(first, ' between ');
                    const second = ownerDocument.createElement('img');
                    second.src = 'https://example.com/inline-two.png';
                    second.style.width = '48px';
                    second.style.height = '32px';
                    inline.append(second, ' after');
                    root.appendChild(inline);
                    ownerDocument.body.appendChild(root);

                    const longText = 'A deliberately long caption used to verify line clamping, narrow panes, and complete hover text without changing the native image metadata.';
                    plugin.imageCaption.renderImage(longImage, { captionText: longText, document: ownerDocument });
                    plugin.imageCaption.renderImage(first, { captionText: 'First inline caption', document: ownerDocument });
                    plugin.imageCaption.renderImage(second, { captionText: 'Second inline caption', document: ownerDocument });

                    const captions = [...root.querySelectorAll(
                        '.image-assistant-caption[data-image-assistant-caption-renderer="dom"]'
                    )];
                    const rootRect = root.getBoundingClientRect();
                    const bounds = captions.map(caption => {
                        const rect = caption.getBoundingClientRect();
                        return {
                            finite: [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height]
                                .every(Number.isFinite),
                            contained: rect.left >= rootRect.left - 2 && rect.right <= rootRect.right + 2,
                            positiveWidth: rect.width > 0
                        };
                    });
                    const longCaption = captions.find(node => node.textContent === longText);
                    const result = {
                        captionCount: captions.length,
                        allBoundsFinite: bounds.every(bound => bound.finite),
                        allContained: bounds.every(bound => bound.contained),
                        allPositiveWidth: bounds.every(bound => bound.positiveWidth),
                        longCaptionClamped: longCaption?.getAttribute(
                            'data-image-assistant-caption-clamped'
                        ) === 'true',
                        longCaptionTitle: longCaption?.getAttribute('title') === longText,
                        nativeAltPreserved: longImage.alt === 'Native long alt',
                        nativeTitlePreserved: longImage.title === 'Native long title',
                        inlineParentsPreserved: first.parentElement === inline && second.parentElement === inline,
                        rendererIsolation: captions.every(node =>
                            node.getAttribute('data-image-assistant-caption-renderer') === 'dom'
                        )
                    };
                    plugin.imageCaption.cleanup(root);
                    root.remove();
                    return result;
                };

                const markdownLeaves = application.workspace.getLeavesOfType('markdown');
                const paneResults = markdownLeaves
                    .filter(leaf => leaf === primaryLeaf || leaf === splitLeaf)
                    .map(inspectRenderedLeaf);
                const popoutResult = popoutLeaf ? inspectRenderedLeaf(popoutLeaf) : null;
                const mainFixture = inspectFixture(document);
                const popoutDocument = popoutLeaf?.view?.containerEl?.ownerDocument ?? null;
                const popoutFixture = popoutDocument && popoutDocument !== document
                    ? inspectFixture(popoutDocument)
                    : null;

                Object.assign(plugin.settings.captions, original);
                plugin.imageCaption.refresh();
                popoutLeaf?.detach?.();
                splitLeaf?.detach?.();
                await sleep(300);

                return {
                    paneCount: paneResults.length,
                    paneResults,
                    popoutError,
                    popoutResult,
                    popoutHasIndependentDocument: !!popoutDocument && popoutDocument !== document,
                    mainFixture,
                    popoutFixture
                };
            })()`);
            const fixtureIsValid = fixture => fixture
                && fixture.captionCount === 3
                && fixture.allBoundsFinite
                && fixture.allContained
                && fixture.allPositiveWidth
                && fixture.longCaptionClamped
                && fixture.longCaptionTitle
                && fixture.nativeAltPreserved
                && fixture.nativeTitlePreserved
                && fixture.inlineParentsPreserved
                && fixture.rendererIsolation;
            if (captionLayout.paneCount < 2
                || captionLayout.paneResults.some(result => !result?.stylePresent
                    || !result.bodyEnabled
                    || !result.allOwnedByDom)
                || captionLayout.popoutError
                || !captionLayout.popoutHasIndependentDocument
                || !captionLayout.popoutResult?.stylePresent
                || !captionLayout.popoutResult?.bodyEnabled
                || !fixtureIsValid(captionLayout.mainFixture)
                || !fixtureIsValid(captionLayout.popoutFixture)) {
                failures.push(`Caption multi-view/layout smoke failed: ${JSON.stringify(captionLayout)}`);
            }

            progress('checking repeated network-image alignment in Live Preview');
            livePreviewAlignment = await client.evaluate(`(async () => {
                const application = globalThis.app;
                const plugin = application.plugins.plugins[${JSON.stringify(pluginId)}];
                if (!plugin) throw new Error('Image alignment smoke plugin is unavailable');
                const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                const tempPath = 'Image Assistant Alignment Smoke ' + Date.now() + '.md';
                const repeatedUrl = 'https://example.com/image-assistant-align-smoke?id=1';
                const source = [
                    '![Left network caption|left|180](' + repeatedUrl + ')',
                    '',
                    '![Right network caption|right|220](' + repeatedUrl + ')',
                    '',
                    '![Centered network caption|center|800](' + repeatedUrl + ')'
                ].join('\\n');
                let leaf = null;
                let file = null;
                try {
                    file = await application.vault.create(tempPath, source);
                    leaf = application.workspace.getLeaf('tab');
                    await leaf.setViewState({
                        type: 'markdown',
                        state: { file: file.path, mode: 'source', source: false },
                        active: true
                    });
                    await sleep(1200);
                    plugin.imageStateManager?.refreshAllImages();
                    plugin.imageCaption?.refreshAllViews();
                    await sleep(700);

                    const container = leaf.view.containerEl;
                    const images = [...container.querySelectorAll('img')]
                        .filter(image => image.src.includes('image-assistant-align-smoke'));
                    const captions = [...container.querySelectorAll(
                        '.image-assistant-live-preview-caption[data-image-assistant-source-key]'
                    )].filter(caption => /network caption/.test(caption.textContent ?? ''));
                    const contentRect = container.querySelector('.cm-content')?.getBoundingClientRect()
                        ?? container.getBoundingClientRect();
                    const rendered = images.map(image => {
                        const owner = image.closest('[data-image-assistant-layout-owner="true"]');
                        const key = image.getAttribute('data-image-assistant-source-key');
                        const caption = captions.find(node =>
                            node.getAttribute('data-image-assistant-source-key') === key
                        );
                        const rect = owner?.getBoundingClientRect();
                        const imageRect = image.getBoundingClientRect();
                        const captionRect = caption?.getBoundingClientRect();
                        const alignment = owner?.getAttribute('data-image-assistant-align') ?? null;
                        return {
                            key,
                            alignment,
                            ownerCount: [image, ...getAncestors(image)]
                                .filter(node => node.hasAttribute?.('data-image-assistant-layout-owner')).length,
                            captionAlignment: caption?.getAttribute('data-image-assistant-caption-align') ?? null,
                            horizontalBound: rect ? alignment === 'left'
                                ? Math.abs(rect.left - contentRect.left) <= 8
                                : alignment === 'right'
                                    ? Math.abs(rect.right - contentRect.right) <= 8
                                    : alignment === 'center'
                                        ? Math.abs((rect.left + rect.right) / 2
                                            - (contentRect.left + contentRect.right) / 2) <= 8
                                        : false : false,
                            captionGeometry: captionRect
                                ? caption?.getAttribute('data-image-assistant-caption-positioned') === 'true'
                                    && Math.abs(captionRect.left - imageRect.left) <= 2
                                    && Math.abs(captionRect.width - imageRect.width) <= 2
                                : false,
                            finiteBounds: rect
                                ? [rect.left, rect.right, rect.width].every(Number.isFinite) && rect.width > 0
                                : false
                        };
                    });

                    await leaf.setViewState({
                        type: 'markdown',
                        state: { file: file.path, mode: 'source', source: true },
                        active: true
                    });
                    await sleep(400);
                    const sourceVisualNodes = leaf.view.containerEl.querySelectorAll(
                        '[data-image-assistant-layout-owner], .image-assistant-live-preview-caption'
                    ).length;
                    return {
                        imageCount: images.length,
                        captionCount: captions.length,
                        rendered,
                        sourceVisualNodes
                    };
                } finally {
                    leaf?.detach?.();
                    if (file) await application.vault.delete(file, true);
                }

                function getAncestors(node) {
                    const ancestors = [];
                    let parent = node.parentElement;
                    while (parent) {
                        ancestors.push(parent);
                        parent = parent.parentElement;
                    }
                    return ancestors;
                }
            })()`);
            const alignments = livePreviewAlignment.rendered?.map(item => item.alignment) ?? [];
            if (livePreviewAlignment.imageCount !== 3
                || livePreviewAlignment.captionCount !== 3
                || alignments.join(',') !== 'left,right,center'
                || livePreviewAlignment.rendered.some(item => item.ownerCount !== 1
                    || item.captionAlignment !== item.alignment
                    || !item.horizontalBound
                    || !item.captionGeometry
                    || !item.finiteBounds)
                || livePreviewAlignment.sourceVisualNodes !== 0) {
                failures.push(`Live Preview alignment smoke failed: ${JSON.stringify(livePreviewAlignment)}`);
            }

            progress('checking disabled/local paste and local drop dispatch');
            pasteDispatch = await client.evaluate(`(async () => {
                const application = globalThis.app;
                const plugin = application.plugins.plugins[${JSON.stringify(pluginId)}];
                await plugin.componentsReady;
                const file = application.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
                const leaf = application.workspace.activeLeaf;
                if (!file || !leaf) throw new Error('Acceptance editor leaf was not found');
                await leaf.setViewState({
                    type: 'markdown',
                    state: { file: file.path, mode: 'source', source: false },
                    active: true
                });
                await new Promise(resolve => setTimeout(resolve, 500));
                const editor = leaf.view.editor;
                const originalMode = plugin.settings.pasteHandling.mode;
                const originalPatterns = plugin.settings.localProcessing.conversion.skipConversionPatterns;
                const initialPaths = new Set(application.vault.getFiles().map(item => item.path));
                const originalText = editor.getValue();

                const makeImageFile = name => {
                    const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8AARAwMDAxQAAAjAQHn6w0EAAAAAElFTkSuQmCC');
                    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
                    return new File([bytes], name, { type: 'image/png' });
                };
                const makeClipboardEvent = name => {
                    const transfer = new DataTransfer();
                    transfer.items.add(makeImageFile(name));
                    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
                    Object.defineProperty(event, 'clipboardData', { value: transfer });
                    return event;
                };
                const waitForNewFiles = async expected => {
                    const deadline = Date.now() + 15000;
                    while (Date.now() < deadline) {
                        const created = application.vault.getFiles()
                            .filter(item => !initialPaths.has(item.path));
                        if (created.length >= expected) return created;
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    return application.vault.getFiles().filter(item => !initialPaths.has(item.path));
                };

                plugin.settings.pasteHandling.mode = 'disabled';
                const disabledEvent = makeClipboardEvent('disabled-paste.png');
                application.workspace.trigger('editor-paste', disabledEvent, editor);
                await new Promise(resolve => setTimeout(resolve, 300));
                const disabled = {
                    defaultPrevented: disabledEvent.defaultPrevented,
                    textChanged: editor.getValue() !== originalText,
                    createdFiles: application.vault.getFiles()
                        .filter(item => !initialPaths.has(item.path)).length
                };

                plugin.settings.pasteHandling.mode = 'local';
                plugin.settings.localProcessing.conversion.skipConversionPatterns = '*.png';
                const lastLine = editor.lineCount() - 1;
                editor.setCursor({ line: lastLine, ch: editor.getLine(lastLine).length });
                const pasteEvent = makeClipboardEvent('runtime-paste.png');
                application.workspace.trigger('editor-paste', pasteEvent, editor);
                const afterPasteFiles = await waitForNewFiles(1);
                const afterPasteText = editor.getValue();

                const transfer = new DataTransfer();
                transfer.items.add(makeImageFile('runtime-drop.png'));
                const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true });
                Object.defineProperty(dropEvent, 'dataTransfer', { value: transfer });
                const originalPosAtMouse = editor.posAtMouse;
                editor.posAtMouse = () => editor.getCursor();
                try {
                    application.workspace.trigger('editor-drop', dropEvent, editor);
                    await waitForNewFiles(2);
                } finally {
                    editor.posAtMouse = originalPosAtMouse;
                    plugin.settings.pasteHandling.mode = originalMode;
                    plugin.settings.localProcessing.conversion.skipConversionPatterns = originalPatterns;
                }

                const created = application.vault.getFiles()
                    .filter(item => !initialPaths.has(item.path));
                return {
                    disabled,
                    paste: {
                        defaultPrevented: pasteEvent.defaultPrevented,
                        createdPaths: afterPasteFiles.map(item => item.path),
                        linkInserted: afterPasteText !== originalText
                    },
                    drop: {
                        defaultPrevented: dropEvent.defaultPrevented,
                        createdPaths: created.map(item => item.path),
                        noteLength: editor.getValue().length
                    }
                };
            })()`);
            if (pasteDispatch.disabled.defaultPrevented
                || pasteDispatch.disabled.textChanged
                || pasteDispatch.disabled.createdFiles !== 0) {
                failures.push(`disabled paste was intercepted: ${JSON.stringify(pasteDispatch.disabled)}`);
            }
            if (!pasteDispatch.paste.defaultPrevented
                || !pasteDispatch.paste.linkInserted
                || pasteDispatch.paste.createdPaths.length < 1) {
                failures.push(`local paste failed: ${JSON.stringify(pasteDispatch.paste)}`);
            }
            if (!pasteDispatch.drop.defaultPrevented
                || pasteDispatch.drop.createdPaths.length < 2) {
                failures.push(`local drop failed: ${JSON.stringify(pasteDispatch.drop)}`);
            }

            progress('checking all nine batch command entries');
            batchCommands = await client.evaluate(`(async () => {
                const application = globalThis.app;
                const pluginPrefix = ${JSON.stringify(`${pluginId}:`)};
                const waitFor = async (predicate, timeout = 5000) => {
                    const deadline = Date.now() + timeout;
                    while (Date.now() < deadline) {
                        const value = predicate();
                        if (value) return value;
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                    return null;
                };
                const closeModal = async modalContent => {
                    const modal = modalContent?.closest('.modal');
                    const closeButton = modal?.querySelector('.modal-close-button');
                    closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    await new Promise(resolve => setTimeout(resolve, 100));
                    return !document.body.contains(modalContent);
                };
                const chooseFolder = async () => {
                    const prompt = await waitFor(() => document.querySelector('.prompt'));
                    if (!prompt) return false;
                    const input = prompt.querySelector('input');
                    if (input) {
                        input.value = 'assets';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        await new Promise(resolve => setTimeout(resolve, 150));
                    }
                    const suggestion = [...prompt.querySelectorAll('.suggestion-item')]
                        .find(item => item.textContent?.includes('assets'))
                        ?? prompt.querySelector('.suggestion-item');
                    if (!suggestion) return false;
                    for (const type of ['mousedown', 'mouseup', 'click']) {
                        suggestion.dispatchEvent(new MouseEvent(type, { bubbles: true }));
                    }
                    return true;
                };
                const cases = [
                    ['process-all-images-current-note', 'note', 0, false],
                    ['process-folder-images', 'folder', 0, true],
                    ['process-all-vault-images', 'vault', 0, false],
                    ['upload-all-images-current-note', 'note', 1, false],
                    ['upload-folder-images', 'folder', 1, true],
                    ['upload-all-vault-images', 'vault', 1, false],
                    ['download-network-images-current-note', 'note', 2, false],
                    ['download-network-images-folder', 'folder', 2, true],
                    ['download-network-images-vault', 'vault', 2, false]
                ];
                const results = [];
                for (const [command, scope, expectedModeIndex, needsFolder] of cases) {
                    const executed = application.commands.executeCommandById(pluginPrefix + command);
                    let folderChosen = true;
                    if (needsFolder) folderChosen = await chooseFolder();
                    const content = await waitFor(() =>
                        document.querySelector('.image-converter-batch-modal')
                    );
                    if (!content) {
                        results.push({ command, scope, executed, folderChosen, opened: false });
                        document.querySelector('.modal-close-button')?.dispatchEvent(
                            new MouseEvent('click', { bubbles: true })
                        );
                        continue;
                    }
                    const buttons = [...content.querySelectorAll('.batch-mode-selector button')];
                    const selectedModeIndex = buttons.findIndex(button =>
                        button.classList.contains('mod-cta')
                    );
                    const scopeText = content.querySelector('.batch-scope-indicator')
                        ?.textContent?.trim() ?? '';
                    const closed = await closeModal(content);
                    results.push({
                        command,
                        scope,
                        executed,
                        folderChosen,
                        opened: true,
                        selectedModeIndex,
                        expectedModeIndex,
                        modeButtonCount: buttons.length,
                        scopeText,
                        closed
                    });
                }
                return {
                    results,
                    remainingModals: document.querySelectorAll('.modal-container').length
                };
            })()`);
            const invalidBatchCommands = batchCommands.results.filter(result =>
                !result.executed
                || !result.folderChosen
                || !result.opened
                || result.selectedModeIndex !== result.expectedModeIndex
                || result.modeButtonCount !== 3
                || !result.scopeText
                || !result.closed
            );
            if (invalidBatchCommands.length) {
                failures.push(`batch command smoke failed: ${JSON.stringify(invalidBatchCommands)}`);
            }

            progress('checking Fabric annotation modal lifecycle');
            annotation = await client.evaluate(`(async () => {
                const application = globalThis.app;
                const plugin = application.plugins.plugins[${JSON.stringify(pluginId)}];
                const leaf = application.workspace.activeLeaf;
                const file = application.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
                if (!leaf || !file) throw new Error('Acceptance editor leaf was not found');
                const annotationPath = 'assets/runtime-annotation.png';
                const sourceCanvas = document.createElement('canvas');
                sourceCanvas.width = 96;
                sourceCanvas.height = 64;
                const sourceContext = sourceCanvas.getContext('2d');
                sourceContext.fillStyle = '#e63946';
                sourceContext.fillRect(0, 0, 96, 64);
                sourceContext.fillStyle = '#1d3557';
                sourceContext.fillRect(16, 16, 64, 32);
                const blob = await new Promise((resolve, reject) => sourceCanvas.toBlob(
                    value => value ? resolve(value) : reject(new Error('PNG fixture encoding failed')),
                    'image/png'
                ));
                const annotationData = await blob.arrayBuffer();
                const existingAnnotation = application.vault.getAbstractFileByPath(annotationPath);
                if (existingAnnotation) {
                    await application.vault.modifyBinary(existingAnnotation, annotationData);
                } else {
                    await application.vault.createBinary(annotationPath, annotationData);
                }
                const annotationLink = '![[assets/runtime-annotation.png|Annotation fixture]]';
                const noteText = await application.vault.read(file);
                if (!noteText.includes(annotationLink)) {
                    await application.vault.modify(file, noteText + '\\n\\n' + annotationLink + '\\n');
                }
                await leaf.setViewState({
                    type: 'markdown',
                    state: { file: file.path, mode: 'preview' },
                    active: true
                });
                await new Promise(resolve => setTimeout(resolve, 700));
                const image = [...leaf.view.containerEl.querySelectorAll('img')]
                    .find(item => item.getAttribute('alt')?.includes('Annotation fixture'));
                if (image && (!image.complete || image.naturalWidth === 0)) {
                    await new Promise(resolve => {
                        const timeout = setTimeout(resolve, 5000);
                        image.addEventListener('load', () => {
                            clearTimeout(timeout);
                            resolve();
                        }, { once: true });
                        image.addEventListener('error', () => {
                            clearTimeout(timeout);
                            resolve();
                        }, { once: true });
                    });
                }
                const handler = plugin.contextMenu?.processingHandler;
                if (!image || !handler) {
                    return { opened: false, reason: 'local image or processing handler unavailable' };
                }
                await handler.annotateImage(image);
                const deadline = Date.now() + 10000;
                let modal = null;
                while (Date.now() < deadline) {
                    modal = document.querySelector('.image-converter-annotation-tool-image-annotation-modal');
                    const canvas = modal?.querySelector('canvas.lower-canvas');
                    if (canvas
                        && canvas.width > 0
                        && canvas.height > 0
                        && modal.querySelector('.canvas-container')) break;
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                if (!modal) return { opened: false, reason: 'annotation modal did not open' };
                const canvases = [...modal.querySelectorAll('canvas')];
                const drawableCanvas = canvases.find(canvas =>
                    canvas.classList.contains('lower-canvas')
                ) ?? canvases[0];
                let nonTransparentPixels = null;
                try {
                    if (drawableCanvas) {
                        const context = drawableCanvas.getContext('2d');
                        const pixels = context?.getImageData(
                            0,
                            0,
                            drawableCanvas.width,
                            drawableCanvas.height
                        ).data;
                        if (pixels) {
                            nonTransparentPixels = 0;
                            for (let index = 3; index < pixels.length; index += 4) {
                                if (pixels[index] !== 0) nonTransparentPixels++;
                            }
                        }
                    }
                } catch {
                    nonTransparentPixels = null;
                }
                const result = {
                    opened: true,
                    canvasCount: canvases.length,
                    canvasWidth: drawableCanvas?.width ?? 0,
                    canvasHeight: drawableCanvas?.height ?? 0,
                    nonTransparentPixels,
                    toolbarCount: modal.querySelectorAll(
                        '.image-converter-annotation-tool-annotation-toolbar button'
                    ).length,
                    fabricContainers: modal.querySelectorAll('.canvas-container').length,
                    sourceNaturalWidth: image.naturalWidth,
                    sourceNaturalHeight: image.naturalHeight
                };
                const rootModal = modal.closest('.modal');
                rootModal?.querySelector('.modal-close-button')?.dispatchEvent(
                    new MouseEvent('click', { bubbles: true })
                );
                await new Promise(resolve => setTimeout(resolve, 300));
                result.closed = !document.body.contains(modal);
                result.remainingAnnotationModals = document.querySelectorAll(
                    '.image-converter-annotation-tool-image-annotation-modal'
                ).length;
                return result;
            })()`);
            if (!annotation.opened
                || annotation.canvasCount < 1
                || annotation.canvasWidth < 1
                || annotation.canvasHeight < 1
                || annotation.toolbarCount < 1
                || annotation.fabricContainers < 1
                || !annotation.closed
                || annotation.remainingAnnotationModals !== 0) {
                failures.push(`Fabric annotation smoke failed: ${JSON.stringify(annotation)}`);
            }
        }

        progress('checking plugin unload and reload');
        const lifecycle = checkLifecycle ? await client.evaluate(`(async () => {
            const application = globalThis.app;
            await application.plugins.disablePlugin(${JSON.stringify(pluginId)});
            await new Promise(resolve => setTimeout(resolve, 300));
            const result = {
                unloaded: !application.plugins.plugins[${JSON.stringify(pluginId)}],
                captionNodes: document.querySelectorAll('[data-image-assistant-caption-node]').length,
                captionStyles: document.querySelectorAll('#image-caption-styles').length,
                bodyEnabled: [...document.querySelectorAll('body')]
                    .some(body => body.classList.contains('image-captions-enabled'))
            };
            await application.plugins.enablePlugin(${JSON.stringify(pluginId)});
            await new Promise(resolve => setTimeout(resolve, 500));
            result.reloaded = !!application.plugins.plugins[${JSON.stringify(pluginId)}];
            return result;
        })()`) : { skipped: true };
        if (checkLifecycle) {
            if (!lifecycle.unloaded || lifecycle.captionNodes || lifecycle.captionStyles || lifecycle.bodyEnabled) {
                failures.push(`plugin unload left runtime state: ${JSON.stringify(lifecycle)}`);
            }
            if (!lifecycle.reloaded) failures.push('plugin did not reload after lifecycle smoke');
        }

        const runtimeErrors = client.events
            .filter(event => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
            .map(event => event.params?.exceptionDetails?.exception?.description
                ?? event.params?.entry?.text)
            .filter(Boolean);
        if (runtimeErrors.length) failures.push(`runtime errors: ${runtimeErrors.join(' | ')}`);

        const report = {
            startup,
            settings,
            captions,
            editorModes,
            captionLayout,
            livePreviewAlignment,
            pasteDispatch,
            batchCommands,
            annotation,
            lifecycle,
            runtimeErrors,
            failures
        };
        progress('smoke checks completed');
        console.log(JSON.stringify(report, null, 2));
        if (failures.length) process.exitCode = 1;
    } finally {
        client.close();
    }
}

main().catch(error => {
    console.error(`[obsidian-smoke] ${error.stack ?? error.message}`);
    process.exitCode = 1;
});
