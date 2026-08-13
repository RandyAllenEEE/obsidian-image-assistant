#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function readArgument(name, fallback) {
    const prefix = `--${name}=`;
    const argument = process.argv.slice(2).find(value => value.startsWith(prefix));
    return argument ? argument.slice(prefix.length) : fallback;
}

function readBooleanArgument(name, fallback) {
    if (process.argv.includes(`--${name}`)) return true;
    if (process.argv.includes(`--no-${name}`)) return false;
    const value = readArgument(name, null);
    if (value === null) return fallback;
    if (/^(?:1|true|yes|on)$/i.test(value)) return true;
    if (/^(?:0|false|no|off)$/i.test(value)) return false;
    throw new Error(`Invalid --${name} value: ${value}`);
}

function readPositiveIntegerArgument(name, fallback, minimum = 1) {
    const value = Number(readArgument(name, String(fallback)));
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`--${name} must be an integer greater than or equal to ${minimum}`);
    }
    return value;
}

async function startLocalMediaFixture() {
    // A tiny PNG keeps the URL fixture independent of public networking while
    // avoiding Vault caption settings that intentionally skip ordinary SVGs.
    const body = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
    );
    const server = http.createServer((request, response) => {
        if (request.url !== '/image-assistant-layout-fixture.png') {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
            'Content-Length': body.length
        });
        response.end(body);
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('Unable to bind the local media fixture');
    }
    return {
        url: `http://127.0.0.1:${address.port}/image-assistant-layout-fixture.png`,
        close: () => new Promise(resolve => server.close(resolve))
    };
}

class CdpClient {
    constructor(url, requestTimeoutMs = 60000) {
        this.url = url;
        this.requestTimeoutMs = requestTimeoutMs;
        this.nextId = 1;
        this.pending = new Map();
    }

    async connect() {
        this.socket = new WebSocket(this.url);
        this.socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (!message.id) return;
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            clearTimeout(pending.timeout);
            if (message.error) pending.reject(new Error(message.error.message));
            else pending.resolve(message.result);
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
            }, this.requestTimeoutMs);
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
        this.socket.close();
    }
}

async function getPageTarget(port, waitMs, titleHint = '') {
    const deadline = Date.now() + waitMs;
    let lastError = null;
    do {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/list`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const targets = await response.json();
            const pages = targets.filter(target => target.type === 'page'
                && target.url.startsWith('app://obsidian.md/'));
            const normalizedHint = titleHint.trim().toLocaleLowerCase();
            const hintedPage = normalizedHint
                ? pages.find(candidate => String(candidate.title ?? '')
                    .toLocaleLowerCase().includes(normalizedHint))
                : undefined;
            const page = hintedPage
                ?? pages.find(candidate => / - vault - obsidian\b/i.test(
                    String(candidate.title ?? '')
                ))
                ?? pages.find(candidate => String(candidate.title ?? '').trim())
                ?? pages[0];
            if (page) return page;
            lastError = new Error('No Obsidian page target is available');
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    throw lastError ?? new Error('Obsidian CDP target lookup timed out');
}

/** Waits for a newly-created fixture to reach MetadataCache before rendering it. */
async function waitForDiagnosticMetadata(client, temporaryPath) {
    return client.evaluate(`(async () => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const application = globalThis.app;
        const file = application.vault.getAbstractFileByPath(
            ${JSON.stringify(temporaryPath)}
        );
        if (!file) return { ready: false, attempts: 0, error: 'Temporary diagnostic note is missing' };
        const source = await application.vault.read(file);
        const expectedLinks = ['Drawing.excalidraw.md', 'image-3.png']
            .filter(link => source.includes('](' + link + ')'));
        const resolveLink = typeof application.metadataCache.getFirstLinkpathDest === 'function'
            ? application.metadataCache.getFirstLinkpathDest.bind(application.metadataCache)
            : null;
        let result = null;
        for (let attempt = 1; attempt <= 100; attempt++) {
            const cache = application.metadataCache.getFileCache?.(file) ?? null;
            const unresolvedLinks = resolveLink
                ? expectedLinks.filter(link => !resolveLink(link, file.path))
                : expectedLinks;
            result = {
                ready: Boolean(cache) && unresolvedLinks.length === 0,
                attempts: attempt,
                cachePresent: Boolean(cache),
                expectedLinks,
                unresolvedLinks,
                cachedEmbedCount: Array.isArray(cache?.embeds) ? cache.embeds.length : 0,
                error: resolveLink ? null : 'MetadataCache.getFirstLinkpathDest is unavailable'
            };
            if (result.ready) return result;
            await sleep(100);
        }
        return result;
    })()`);
}

async function main() {
    const port = Number(readArgument('port', '9229'));
    const notePath = readArgument('note', '未命名.md');
    const targetTitle = readArgument('target-title', '');
    const outputDir = path.resolve(readArgument('output', 'build/layout-diagnostics'));
    const assertEnabled = readBooleanArgument('assert', true);
    const interactionRounds = readPositiveIntegerArgument('rounds', 30);
    const target = await getPageTarget(port, 30000, targetTitle);
    const client = new CdpClient(
        target.webSocketDebuggerUrl,
        Math.max(120000, interactionRounds * 5000)
    );
    await client.connect();
    const fixture = await startLocalMediaFixture();
    let diagnosticNotePath = null;
    let sourceNoteSnapshot = null;
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        await client.send('Page.enable');
        await client.send('Page.bringToFront');
        await client.evaluate(`(async () => {
            const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
            const trustButton = [...document.querySelectorAll('button')].find(button =>
                /信任.*启用插件|trust.*enable plugins/i.test(button.textContent ?? '')
            );
            trustButton?.click();
            if (trustButton) await sleep(2500);
        })()`);
        try {
            const { windowId } = await client.send('Browser.getWindowForTarget', {
                targetId: target.id
            });
            await client.send('Browser.setWindowBounds', {
                windowId,
                bounds: { width: 1500, height: 1000, windowState: 'normal' }
            });
        } catch {
            // Window bounds are optional (headless and some Linux WMs reject them).
        }
        const diagnosticNote = await client.evaluate(`(async () => {
            const application = globalThis.app;
            const sourceFile = application.vault.getAbstractFileByPath(
                ${JSON.stringify(notePath)}
            );
            if (!sourceFile) {
                throw new Error('Diagnostic note is missing: ' + ${JSON.stringify(notePath)});
            }
            const original = await application.vault.read(sourceFile);
            const localUrl = ${JSON.stringify(fixture.url)};
            const withoutPublicMedia = original.replace(
                /https?:\\/\\/[^\\s)>]+/g,
                localUrl
            );
            const parentPath = sourceFile.parent?.path === '/' ? '' : sourceFile.parent?.path ?? '';
            const prefix = parentPath ? parentPath + '/' : '';
            let suffix = 0;
            let temporaryPath;
            do {
                temporaryPath = prefix + '_image-assistant-layout-diagnostic-'
                    + Date.now() + (suffix ? '-' + suffix : '') + '.md';
                suffix++;
            } while (application.vault.getAbstractFileByPath(temporaryPath));
            await application.vault.create(
                temporaryPath,
                withoutPublicMedia
            );
            return { temporaryPath, sourceSnapshot: original };
        })()`);
        diagnosticNotePath = diagnosticNote.temporaryPath;
        sourceNoteSnapshot = diagnosticNote.sourceSnapshot;
        const results = {};
        for (const mode of ['preview', 'source']) {
            // The first pass usually waits; repeating before source mode also
            // handles a cache rebuild caused by the preview renderer.
            const metadataReadiness = await waitForDiagnosticMetadata(
                client,
                diagnosticNotePath
            );
            results[mode] = await client.evaluate(`(async () => {
                const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                const yieldTask = () => new Promise(resolve => {
                    const channel = new MessageChannel();
                    channel.port1.onmessage = () => {
                        channel.port1.close();
                        channel.port2.close();
                        resolve();
                    };
                    channel.port2.postMessage(null);
                });
                const application = globalThis.app;
                const file = application.vault.getAbstractFileByPath(
                    ${JSON.stringify(diagnosticNotePath)}
                );
                if (!file) throw new Error('Temporary diagnostic note is missing');
                const leaf = application.workspace.getLeaf('tab');
                await leaf.setViewState({
                    type: 'markdown',
                    state: { file: file.path, mode: ${JSON.stringify(mode)}, source: false },
                    active: true
                });
                application.workspace.setActiveLeaf?.(leaf, { focus: true });
                application.workspace.revealLeaf?.(leaf);
                globalThis.__imageAssistantDiagnosticLeaf?.detach?.();
                globalThis.__imageAssistantDiagnosticLeaf = leaf;
                await sleep(2200);
                const readiness = {
                    ready: false,
                    attempts: 0,
                    missing: [],
                    stableFrames: 0,
                    renderFrameTimeouts: 0,
                    signature: null
                };
                const ownerWindow = leaf.view.containerEl.ownerDocument.defaultView ?? window;
                const nodeIds = new WeakMap();
                let nextNodeId = 1;
                const nodeId = element => {
                    if (!element) return 'missing';
                    let value = nodeIds.get(element);
                    if (!value) {
                        value = String(nextNodeId++);
                        nodeIds.set(element, value);
                    }
                    return value;
                };
                const compactRect = element => {
                    if (!element) return 'missing';
                    const value = element.getBoundingClientRect();
                    return [value.left, value.right, value.top, value.bottom, value.width,
                        value.height].map(coordinate => Math.round(coordinate * 2) / 2)
                        .join(',');
                };
                const nextRenderFrame = () => new Promise(resolve => {
                    let settled = false;
                    const finish = rendered => {
                        if (settled) return;
                        settled = true;
                        ownerWindow.clearTimeout(timeout);
                        resolve(rendered);
                    };
                    const timeout = ownerWindow.setTimeout(() => finish(false), 1000);
                    if (typeof ownerWindow.requestAnimationFrame === 'function') {
                        ownerWindow.requestAnimationFrame(() => finish(true));
                    } else {
                        ownerWindow.setTimeout(() => finish(true), 16);
                    }
                });
                const captureReadiness = () => {
                    const mediaRoot = leaf.view.containerEl;
                    const excalidraw = mediaRoot.querySelector(
                        '[filesource].excalidraw-embedded-img'
                    );
                    const images = [...mediaRoot.querySelectorAll('img')];
                    const local = images.find(element =>
                        decodeURIComponent(element.src).includes('image-3.png')
                    );
                    const remote = images.find(element =>
                        element.src.includes('image-assistant-layout-fixture.png')
                        && /(?:^|\\|)right(?:\\||$)/i.test(element.alt ?? '')
                    );
                    const media = [excalidraw, local, remote];
                    const owners = media.map(element => element?.closest(
                        '[data-image-assistant-layout-owner="true"]'
                    ) ?? null);
                    const captions = [...mediaRoot.querySelectorAll(
                        '.image-assistant-caption'
                    )];
                    const geometryNodes = [...media, ...owners, ...captions];
                    const hasPositiveGeometry = geometryNodes.every(element => {
                        if (!element?.isConnected) return false;
                        const value = element.getBoundingClientRect();
                        return Number.isFinite(value.left)
                            && Number.isFinite(value.top)
                            && value.width > 0
                            && value.height >= 0;
                    });
                    const sourcePositioned = ${JSON.stringify(mode)} !== 'source'
                        || (owners.every(owner => owner?.getAttribute(
                            'data-image-assistant-layout-positioned'
                        ) === 'true')
                        && captions.every(caption => caption.getAttribute(
                            'data-image-assistant-caption-positioned'
                        ) === 'true'));
                    const missing = [
                        !excalidraw && 'excalidraw',
                        !local && 'local',
                        !remote && 'remote',
                        owners.some(owner => !owner) && 'layout-owner',
                        captions.length < 3 && 'captions',
                        !hasPositiveGeometry && 'geometry',
                        !sourcePositioned && 'source-position'
                    ].filter(Boolean);
                    return {
                        missing,
                        signature: [
                            ...media.map(element => nodeId(element) + ':' + compactRect(element)),
                            ...owners.map(element => nodeId(element) + ':' + compactRect(element)),
                            ...captions.map(element => nodeId(element) + ':' + compactRect(element))
                        ].join('|')
                    };
                };
                let previousReadinessSignature = '';
                for (let attempt = 0; attempt < 15; attempt++) {
                    readiness.attempts = attempt + 1;
                    const beforeFrame = captureReadiness();
                    readiness.missing = beforeFrame.missing;
                    if (beforeFrame.missing.length > 0) {
                        readiness.stableFrames = 0;
                        previousReadinessSignature = '';
                        await sleep(1000);
                        continue;
                    }
                    if (!await nextRenderFrame()) {
                        readiness.renderFrameTimeouts++;
                        readiness.missing = ['render-frame'];
                        readiness.stableFrames = 0;
                        previousReadinessSignature = '';
                        continue;
                    }
                    const afterFrame = captureReadiness();
                    readiness.missing = afterFrame.missing;
                    readiness.signature = afterFrame.signature;
                    if (afterFrame.missing.length > 0) {
                        readiness.stableFrames = 0;
                        previousReadinessSignature = '';
                        continue;
                    }
                    readiness.stableFrames = afterFrame.signature === previousReadinessSignature
                        ? readiness.stableFrames + 1
                        : 1;
                    previousReadinessSignature = afterFrame.signature;
                    if (readiness.stableFrames >= 3) {
                        readiness.ready = true;
                        break;
                    }
                }

                const root = leaf.view.containerEl;
                const viewSelector = ${JSON.stringify(
                    mode === 'preview'
                        ? '.markdown-reading-view, .markdown-preview-view'
                        : '.markdown-source-view'
                )};
                const viewCandidates = [...root.querySelectorAll(viewSelector)];
                const view = viewCandidates.find(element =>
                    element.getBoundingClientRect().width > 0
                ) ?? viewCandidates.at(-1) ?? null;
                const scopeSelectors = ${JSON.stringify(
                    mode === 'preview'
                        ? ['.markdown-preview-sizer']
                        : ['.cm-contentContainer', '.cm-content']
                )};
                const scope = scopeSelectors
                    .flatMap(selector => [...(view?.querySelectorAll(selector) ?? [])])
                    .find(element => element.getBoundingClientRect().width > 0)
                    ?? view;
                const rect = element => {
                    if (!element) return null;
                    const value = element.getBoundingClientRect();
                    return {
                        left: value.left,
                        right: value.right,
                        top: value.top,
                        bottom: value.bottom,
                        width: value.width,
                        height: value.height,
                        center: value.left + value.width / 2
                    };
                };
                const style = element => {
                    if (!element) return null;
                    const value = getComputedStyle(element);
                    return Object.fromEntries([
                        'display', 'position', 'left', 'width', 'minWidth', 'maxWidth',
                        'height', 'marginLeft', 'marginRight', 'marginInlineStart',
                        'marginInlineEnd', 'float', 'clear', 'overflow', 'overflowX',
                        'transform', 'textAlign', 'justifyContent', 'alignItems'
                    ].map(key => [key, value[key]]));
                };
                const describe = element => {
                    if (!element) return null;
                    return {
                        tag: element.tagName.toLowerCase(),
                        id: element.id || null,
                        classes: [...element.classList],
                        attributes: Object.fromEntries([...element.attributes]
                            .filter(attribute => attribute.name.startsWith('data-image-assistant')
                                || ['src', 'alt', 'filesource', 'style'].includes(
                                    attribute.name.toLowerCase()
                                ))
                            .map(attribute => [attribute.name, attribute.value])),
                        rect: rect(element),
                        style: style(element)
                    };
                };
                const ancestors = element => {
                    const values = [];
                    let current = element;
                    for (let index = 0; current && index < 9; index++, current = current.parentElement) {
                        values.push(describe(current));
                    }
                    return values;
                };
                const findCandidates = () => [
                    {
                        kind: 'excalidraw',
                        element: root.querySelector('[filesource].excalidraw-embedded-img')
                    },
                    {
                        kind: 'local',
                        element: [...(view?.querySelectorAll('img') ?? [])]
                            .find(element => decodeURIComponent(element.src).includes('image-3.png')) ?? null
                    },
                    {
                        kind: 'remote',
                        element: [...(view?.querySelectorAll('img') ?? [])]
                            .find(element => element.src.includes(
                                'image-assistant-layout-fixture.png'
                            ) && /(?:^|\|)right(?:\||$)/i.test(element.alt ?? ''))
                            ?? null
                    }
                ];
                const candidates = findCandidates();
                const scopeRect = rect(scope);
                const getCandidateParts = candidate => {
                    const media = candidate.kind === 'excalidraw'
                        ? candidate.element?.querySelector('svg.excalidraw-svg, svg')
                            ?? candidate.element
                        : candidate.element;
                    const owner = media?.closest('[data-image-assistant-layout-owner="true"]')
                        ?? candidate.element?.closest('[data-image-assistant-layout-owner="true"]')
                        ?? candidate.element?.closest('.image-embed')
                        ?? null;
                    const layoutKeyNode = [owner, candidate.element, media]
                        .find(element => element?.hasAttribute(
                            'data-image-assistant-layout-key'
                        ));
                    const layoutKey = layoutKeyNode?.getAttribute(
                        'data-image-assistant-layout-key'
                    ) ?? null;
                    const caption = layoutKey
                        ? [...root.querySelectorAll('.image-assistant-caption')]
                            .find(element => element.getAttribute(
                                'data-image-assistant-layout-key'
                            ) === layoutKey) ?? null
                        : null;
                    return { media, owner, caption, layoutKey };
                };
                const geometrySnapshot = () => Object.fromEntries(
                    findCandidates().map(candidate => {
                        const parts = getCandidateParts(candidate);
                        return [candidate.kind, {
                            media: rect(parts.media),
                            caption: rect(parts.caption),
                            layoutKey: parts.layoutKey
                        }];
                    })
                );
                const geometrySignature = snapshot => JSON.stringify(
                    Object.fromEntries(Object.entries(snapshot).map(([kind, value]) => [
                        kind,
                        [value.media, value.caption].map(valueRect => valueRect
                            ? ['left', 'right', 'width', 'center'].map(key =>
                                Math.round(valueRect[key] * 10) / 10
                            )
                            : null)
                    ]))
                );
                const settleGeometry = async (maximumFrames = 12) => {
                    let previous = '';
                    let stableFrames = 0;
                    let snapshot = geometrySnapshot();
                    for (let frame = 1; frame <= maximumFrames; frame++) {
                        await yieldTask();
                        root.getBoundingClientRect();
                        snapshot = geometrySnapshot();
                        const signature = geometrySignature(snapshot);
                        stableFrames = signature === previous ? stableFrames + 1 : 0;
                        previous = signature;
                        if (stableFrames >= 3) {
                            return { snapshot, stable: true, frames: frame };
                        }
                    }
                    return { snapshot, stable: false, frames: maximumFrames };
                };
                const initialSettled = await settleGeometry();
                const initialParts = Object.fromEntries(candidates.map(candidate => [
                    candidate.kind,
                    getCandidateParts(candidate)
                ]));
                const excalidrawSvg = initialParts.excalidraw?.media ?? null;
                const excalidrawRect = rect(excalidrawSvg);
                const excalidrawCenterPoint = excalidrawRect
                    ? {
                        x: excalidrawRect.left + excalidrawRect.width / 2,
                        y: excalidrawRect.top + excalidrawRect.height / 2
                    }
                    : null;
                const excalidrawHit = excalidrawCenterPoint
                    && excalidrawCenterPoint.x >= 0
                    && excalidrawCenterPoint.x <= innerWidth
                    && excalidrawCenterPoint.y >= 0
                    && excalidrawCenterPoint.y <= innerHeight
                    ? document.elementFromPoint(
                        excalidrawCenterPoint.x,
                        excalidrawCenterPoint.y
                    )
                    : null;
                const excalidrawStyle = excalidrawSvg
                    ? getComputedStyle(excalidrawSvg)
                    : null;
                const excalidrawVisibility = {
                    rect: excalidrawRect,
                    centerPoint: excalidrawCenterPoint,
                    intersectsViewport: Boolean(excalidrawRect
                        && excalidrawRect.right > 0
                        && excalidrawRect.left < innerWidth
                        && excalidrawRect.bottom > 0
                        && excalidrawRect.top < innerHeight),
                    cssVisible: Boolean(excalidrawStyle
                        && excalidrawStyle.display !== 'none'
                        && excalidrawStyle.visibility !== 'hidden'
                        && Number(excalidrawStyle.opacity || '1') > 0
                        && excalidrawRect?.width > 0
                        && excalidrawRect?.height > 0),
                    hit: describe(excalidrawHit),
                    hitSelfOrDescendant: Boolean(excalidrawSvg && excalidrawHit
                        && (excalidrawSvg === excalidrawHit
                            || excalidrawSvg.contains(excalidrawHit)))
                };
                const captionGeometry = Object.fromEntries(candidates.map(candidate => {
                    const parts = initialParts[candidate.kind];
                    const mediaRect = rect(parts?.media);
                    const captionRect = rect(parts?.caption);
                    return [candidate.kind, {
                        media: mediaRect,
                        caption: captionRect,
                        centerError: mediaRect && captionRect
                            ? Math.abs(captionRect.center - mediaRect.center)
                            : null,
                        widthError: mediaRect && captionRect
                            ? Math.abs(captionRect.width - mediaRect.width)
                            : null
                    }];
                }));
                const remoteRect = captionGeometry.remote?.media ?? null;
                const interaction = {
                    rounds: 0,
                    linksPerRound: 0,
                    transitions: 0,
                    samples: 0,
                    stableTimeouts: 0,
                    maxHorizontalDrift: 0,
                    maxDriftByKind: {},
                    error: null
                };
                if (${JSON.stringify(mode)} === 'source') {
                    try {
                        const editor = leaf.view.editor;
                        const lines = editor.getValue().split('\\n');
                        const imageLines = lines.map((text, line) => ({
                            line,
                            start: text.indexOf('!['),
                            text
                        })).filter(entry => entry.start >= 0).slice(0, 3);
                        if (imageLines.length !== 3) {
                            throw new Error('Expected three image links, found '
                                + imageLines.length);
                        }
                        interaction.rounds = ${JSON.stringify(interactionRounds)};
                        interaction.linksPerRound = imageLines.length;
                        editor.focus?.();
                        const baseline = initialSettled.snapshot;
                        const updateDrift = (snapshot, round, linkIndex) => {
                            for (const kind of ['excalidraw', 'local', 'remote']) {
                                const expected = baseline[kind];
                                const actual = snapshot[kind];
                                let kindMaximum = interaction.maxDriftByKind[kind] ?? 0;
                                for (const part of ['media', 'caption']) {
                                    for (const key of ['left', 'right', 'width', 'center']) {
                                        const expectedValue = expected?.[part]?.[key];
                                        const actualValue = actual?.[part]?.[key];
                                        if (!Number.isFinite(expectedValue)
                                            || !Number.isFinite(actualValue)) continue;
                                        const drift = Math.abs(actualValue - expectedValue);
                                        kindMaximum = Math.max(kindMaximum, drift);
                                        interaction.maxHorizontalDrift = Math.max(
                                            interaction.maxHorizontalDrift,
                                            drift
                                        );
                                        if (drift > 1 && !interaction.firstExcessiveDrift) {
                                            interaction.firstExcessiveDrift = {
                                                round,
                                                linkIndex,
                                                kind,
                                                part,
                                                key,
                                                expected: expectedValue,
                                                actual: actualValue,
                                                drift
                                            };
                                        }
                                    }
                                }
                                interaction.maxDriftByKind[kind] = kindMaximum;
                            }
                        };
                        for (let round = 0; round < interaction.rounds; round++) {
                            for (let linkIndex = 0; linkIndex < imageLines.length; linkIndex++) {
                                const entry = imageLines[linkIndex];
                                editor.setCursor({
                                    line: entry.line,
                                    ch: Math.min(entry.text.length, entry.start + 2)
                                });
                                await yieldTask();
                                const leaveLine = lines[entry.line + 1]?.trim() === ''
                                    ? entry.line + 1
                                    : Math.max(0, entry.line - 1);
                                editor.setCursor({ line: leaveLine, ch: 0 });
                                await yieldTask();
                                interaction.transitions += 2;
                            }
                            // Measure once per complete round. getBoundingClientRect forces
                            // the current geometry without depending on rAF, which Electron
                            // heavily throttles when this isolated acceptance window is not
                            // foregrounded.
                            await sleep(20);
                            root.getBoundingClientRect();
                            interaction.samples++;
                            updateDrift(
                                geometrySnapshot(),
                                round,
                                imageLines.length - 1
                            );
                        }
                        const finalSettled = await settleGeometry(12);
                        interaction.finalGeometryStable = finalSettled.stable;
                        interaction.finalSettleFrames = finalSettled.frames;
                        if (!finalSettled.stable) interaction.stableTimeouts++;
                        updateDrift(
                            finalSettled.snapshot,
                            interaction.rounds - 1,
                            imageLines.length - 1
                        );
                    } catch (error) {
                        interaction.error = error?.stack ?? String(error);
                    }
                }
                return {
                    mode: ${JSON.stringify(mode)},
                    metadataReadiness: ${JSON.stringify(metadataReadiness)},
                    activeLeaf: application.workspace.getLeaf(false) === leaf,
                    leafConnected: leaf.view.containerEl.isConnected,
                    readiness,
                    view: describe(view),
                    scope: describe(scope),
                    layoutOwnerCount: root.querySelectorAll(
                        '[data-image-assistant-layout-owner="true"]'
                    ).length,
                    stableExcalidrawMarkerCount: root.querySelectorAll(
                        '[filesource].excalidraw-embedded-img'
                    ).length,
                    allImages: [...(view?.querySelectorAll('img') ?? [])].map(describe),
                    excalidrawCandidates: [...root.querySelectorAll(
                        '[filesource], [class*="excalidraw"], svg'
                    )].filter(element => element.getBoundingClientRect().width > 0)
                        .slice(0, 100).map(describe),
                    geometryCandidates: [...root.querySelectorAll('*')]
                        .filter(element => {
                            const value = element.getBoundingClientRect();
                            return value.width >= 100 && value.width <= 500
                                && value.height >= 80 && value.height <= 600;
                        })
                        .slice(0, 100)
                        .map(describe),
                    viewport: {
                        width: innerWidth,
                        height: innerHeight,
                        devicePixelRatio
                    },
                    acceptance: {
                        scopePositiveWidth: Boolean(scopeRect?.width > 0),
                        sourceScopeIsContentContainer: ${JSON.stringify(mode)} !== 'source'
                            || scope?.classList.contains('cm-contentContainer') === true,
                        remoteRightEdgeError: remoteRect && scopeRect
                            ? Math.abs(remoteRect.right - scopeRect.right)
                            : null,
                        excalidrawVisibility,
                        captionGeometry,
                        initialGeometryStable: initialSettled.stable,
                        interaction
                    },
                    pointProbes: [
                        [280, 300],
                        [410, 650],
                        [500, 740]
                    ].map(([x, y]) => ({
                        x,
                        y,
                        element: describe(document.elementFromPoint(x, y)),
                        ancestors: ancestors(document.elementFromPoint(x, y))
                    })),
                    items: candidates.map(candidate => {
                        const parts = getCandidateParts(candidate);
                        const media = parts.media;
                        const mediaRect = rect(media);
                        return {
                            kind: candidate.kind,
                            target: describe(candidate.element),
                            media: describe(media),
                            owner: describe(parts.owner),
                            caption: describe(parts.caption),
                            centerError: mediaRect && scopeRect
                                ? mediaRect.center - scopeRect.center
                                : null,
                            contained: mediaRect && scopeRect
                                ? mediaRect.left >= scopeRect.left - 1
                                    && mediaRect.right <= scopeRect.right + 1
                                : null,
                            ancestors: ancestors(candidate.element)
                        };
                    })
                };
            })()`);
            const screenshot = await client.send('Page.captureScreenshot', {
                format: 'png',
                captureBeyondViewport: false,
                fromSurface: true
            });
            fs.writeFileSync(
                path.join(outputDir, `${mode}.png`),
                Buffer.from(screenshot.data, 'base64')
            );
            await client.evaluate(`(() => {
                globalThis.__imageAssistantDiagnosticLeaf?.detach?.();
                delete globalThis.__imageAssistantDiagnosticLeaf;
            })()`);
        }
        const sourceNoteUnchanged = await client.evaluate(`(async () => {
            const sourceFile = globalThis.app.vault.getAbstractFileByPath(
                ${JSON.stringify(notePath)}
            );
            if (!sourceFile) return false;
            return await globalThis.app.vault.read(sourceFile)
                === ${JSON.stringify(sourceNoteSnapshot)};
        })()`);
        const checks = [];
        const addCheck = (name, pass, details) => checks.push({
            name,
            pass: pass === true,
            details
        });
        const metadataReadiness = Object.fromEntries(
            Object.entries(results).map(([mode, result]) => [
                mode,
                result?.metadataReadiness ?? null
            ])
        );
        addCheck(
            'temporary diagnostic note reaches MetadataCache before each rendered mode',
            Object.values(metadataReadiness).every(result => result?.ready === true),
            metadataReadiness
        );
        const sourceReadiness = results.source?.readiness;
        addCheck(
            'source media, owners, captions, and geometry remain stable for three rendered frames',
            sourceReadiness?.ready === true
                && sourceReadiness.stableFrames >= 3
                && sourceReadiness.renderFrameTimeouts === 0,
            sourceReadiness ?? null
        );
        const acceptance = results.source?.acceptance;
        addCheck(
            'source scope is a positive-width .cm-contentContainer',
            acceptance?.scopePositiveWidth === true
                && acceptance?.sourceScopeIsContentContainer === true,
            results.source?.scope?.rect ?? null
        );
        addCheck(
            'right-aligned URL image reaches the scope right edge within 1.5px',
            Number.isFinite(acceptance?.remoteRightEdgeError)
                && acceptance.remoteRightEdgeError <= 1.5,
            { error: acceptance?.remoteRightEdgeError ?? null }
        );
        const excalidraw = acceptance?.excalidrawVisibility;
        addCheck(
            'Excalidraw SVG is visible and its center hit-tests to itself or a descendant',
            excalidraw?.intersectsViewport === true
                && excalidraw?.cssVisible === true
                && excalidraw?.hitSelfOrDescendant === true,
            excalidraw ?? null
        );
        for (const kind of ['excalidraw', 'local', 'remote']) {
            const caption = acceptance?.captionGeometry?.[kind];
            addCheck(
                `${kind} caption center and width match the media within 1.5px`,
                Number.isFinite(caption?.centerError)
                    && caption.centerError <= 1.5
                    && Number.isFinite(caption?.widthError)
                    && caption.widthError <= 1.5,
                {
                    centerError: caption?.centerError ?? null,
                    widthError: caption?.widthError ?? null
                }
            );
        }
        const interaction = acceptance?.interaction;
        addCheck(
            `cursor entered and left all three links for ${interactionRounds} rounds`,
            interaction?.error === null
                && interaction?.rounds === interactionRounds
                && interaction?.linksPerRound === 3
                && interaction?.samples === interaction.rounds
                && interaction?.transitions === interaction.rounds * 3 * 2,
            interaction ?? null
        );
        addCheck(
            'stable Live Preview horizontal drift stays within 1px',
            interaction?.stableTimeouts === 0
                && Number.isFinite(interaction?.maxHorizontalDrift)
                && interaction.maxHorizontalDrift <= 1,
            {
                stableTimeouts: interaction?.stableTimeouts ?? null,
                maxHorizontalDrift: interaction?.maxHorizontalDrift ?? null,
                maxDriftByKind: interaction?.maxDriftByKind ?? null,
                firstExcessiveDrift: interaction?.firstExcessiveDrift ?? null
            }
        );
        addCheck(
            'the source note was not modified',
            sourceNoteUnchanged,
            { path: notePath }
        );
        results.meta = {
            port,
            notePath,
            temporaryNotePath: diagnosticNotePath,
            interactionRounds,
            assertEnabled,
            outputDir
        };
        results.assertions = {
            enabled: assertEnabled,
            passed: checks.every(check => check.pass),
            checks
        };
        fs.writeFileSync(
            path.join(outputDir, 'layout.json'),
            `${JSON.stringify(results, null, 2)}\n`,
            'utf8'
        );
        process.stdout.write(`${JSON.stringify({
            output: path.join(outputDir, 'layout.json'),
            assertions: results.assertions,
            interaction: results.source?.acceptance?.interaction ?? null
        }, null, 2)}\n`);
        if (assertEnabled && !results.assertions.passed) {
            const failures = checks.filter(check => !check.pass)
                .map(check => check.name)
                .join('; ');
            throw new Error(`Layout diagnostic assertions failed: ${failures}`);
        }
    } finally {
        try {
            await client.evaluate(`(async () => {
                globalThis.__imageAssistantDiagnosticLeaf?.detach?.();
                delete globalThis.__imageAssistantDiagnosticLeaf;
                const temporaryPath = ${JSON.stringify(diagnosticNotePath)};
                if (!temporaryPath) return;
                const temporaryFile = globalThis.app.vault.getAbstractFileByPath(temporaryPath);
                if (temporaryFile) await globalThis.app.vault.delete(temporaryFile, true);
            })()`);
        } catch {
            // The diagnostic target may have closed before cleanup.
        }
        await fixture.close();
        client.close();
    }
}

main().catch(error => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
});
