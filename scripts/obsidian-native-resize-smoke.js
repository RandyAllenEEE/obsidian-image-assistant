#!/usr/bin/env node

const http = require('node:http');

const REQUIRED_VAULT_MARKER = 'ia-obsidian-1134-research';
const TEMP_PREFIX = '__image-assistant-native-resize-smoke-';

function argument(name, fallback) {
    const prefix = `--${name}=`;
    const value = process.argv.slice(2).find(candidate => candidate.startsWith(prefix));
    return value ? value.slice(prefix.length) : fallback;
}

class CdpClient {
    constructor(url) {
        this.url = url;
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
            }, 30000);
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
        this.socket?.close();
    }
}

async function findIsolatedTarget(port) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) throw new Error(`CDP target lookup failed: HTTP ${response.status}`);
    const targets = await response.json();
    const pages = targets.filter(target => target.type === 'page'
        && target.url.startsWith('app://obsidian.md/'));
    const target = pages.find(candidate => /Obsidian 1\.13\.4/i.test(candidate.title ?? ''));
    if (!target) {
        throw new Error('No isolated Obsidian 1.13.4 page exists on the requested CDP port');
    }
    return target;
}

async function startFixture() {
    const svg = Buffer.from(svgDocument('#5e81ac', 'URL'), 'utf8');
    const server = http.createServer((request, response) => {
        if (request.url !== '/native-resize.svg') {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Length': svg.length
        });
        response.end(svg);
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server failed');
    return {
        url: `http://127.0.0.1:${address.port}/native-resize.svg`,
        close: () => new Promise(resolve => server.close(resolve))
    };
}

function svgDocument(color, label, extra = '') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450" ${extra}>
<rect width="800" height="450" rx="24" fill="${color}"/>
<circle cx="180" cy="225" r="105" fill="#eceff4"/>
<path d="M360 340 L510 90 L660 340 Z" fill="#a3be8c"/>
<text x="400" y="415" text-anchor="middle" font-size="42" fill="#2e3440">${label}</text>
</svg>`;
}

function bufferLiteral(value) {
    return JSON.stringify(Buffer.from(value, 'utf8').toString('base64'));
}

async function clickImage(client, alt) {
    const point = await client.evaluate(`(async () => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const leaf = globalThis.__iaNativeResizeSmokeLeaf;
        const image = [...leaf.view.containerEl.querySelectorAll('img')].find(candidate =>
            candidate.getAttribute('alt') === ${JSON.stringify(alt)}
        );
        if (!image) throw new Error('Rendered smoke image not found: ' + ${JSON.stringify(alt)});
        image.scrollIntoView({ block: 'center', inline: 'center' });
        await sleep(100);
        const rect = image.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        buttons: 1,
        clickCount: 1,
        x: point.x,
        y: point.y
    });
    await client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        buttons: 0,
        clickCount: 1,
        x: point.x,
        y: point.y
    });
    await new Promise(resolve => setTimeout(resolve, 150));
}

async function main() {
    const port = Number(argument('port', '9444'));
    if (port !== 9444 && argument('allow-nonstandard-port', 'false') !== 'true') {
        throw new Error('Refusing non-standard CDP port without --allow-nonstandard-port=true');
    }
    const target = await findIsolatedTarget(port);
    const fixture = await startFixture();
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    let temporaryPath = null;

    try {
        await client.send('Page.enable');
        await client.send('Page.bringToFront');
        const identity = await client.evaluate(`(() => ({
            title: document.title,
            vaultPath: globalThis.app?.vault?.adapter?.basePath ?? null,
            pluginVersion: globalThis.app?.plugins?.manifests?.['obsidian-image-assistant']?.version ?? null,
            pluginLoaded: !!globalThis.app?.plugins?.plugins?.['obsidian-image-assistant'],
            processArgs: typeof process === 'object' ? process.argv : []
        }))()`);
        const vaultPath = String(identity.vaultPath ?? '').replace(/\\/g, '/').toLowerCase();
        const processArgs = (identity.processArgs ?? []).join(' ').replace(/\\/g, '/').toLowerCase();
        if (!vaultPath.includes(REQUIRED_VAULT_MARKER)
            || !processArgs.includes(REQUIRED_VAULT_MARKER)
            || !/Obsidian 1\.13\.4/i.test(identity.title ?? '')) {
            throw new Error(`Isolation identity check failed: ${JSON.stringify(identity)}`);
        }
        if (!identity.pluginLoaded || identity.pluginVersion !== '6.0.0') {
            throw new Error(`Image Assistant 6.0.0 is not loaded: ${JSON.stringify(identity)}`);
        }

        temporaryPath = `${TEMP_PREFIX}${Date.now()}`;
        const localSvg = svgDocument('#88c0d0', 'SVG');
        const drawioSvg = svgDocument(
            '#d08770',
            'DRAW.IO',
            'content="&lt;mxfile&gt;&lt;diagram&gt;&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;0&quot;/&gt;&lt;mxCell id=&quot;1&quot; parent=&quot;0&quot;/&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;"'
        );
        const excalSvg = svgDocument('#b48ead', 'EXCALIDRAW');
        const note = [
            `![ia-local|320](${temporaryPath}/local.png)`,
            `![ia-url|320](${fixture.url})`,
            `![ia-svg|320](${temporaryPath}/vector.svg)`,
            `![ia-drawio|320](${temporaryPath}/diagram.drawio.svg)`,
            `![ia-excal-preview|320](${temporaryPath}/sketch.excalidraw.svg)`
        ].join('\n\n');
        await client.evaluate(`(async () => {
            const application = globalThis.app;
            const root = ${JSON.stringify(temporaryPath)};
            if (application.vault.getAbstractFileByPath(root)) {
                throw new Error('Smoke path unexpectedly exists: ' + root);
            }
            await application.vault.createFolder(root);
            const sourcePng = application.vault.getAbstractFileByPath('image-3.png');
            if (!sourcePng) throw new Error('Isolated local PNG fixture is missing');
            await application.vault.createBinary(root + '/local.png', await application.vault.readBinary(sourcePng));
            const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
            await application.vault.createBinary(root + '/vector.svg', decode(${bufferLiteral(localSvg)}));
            await application.vault.createBinary(root + '/diagram.drawio.svg', decode(${bufferLiteral(drawioSvg)}));
            await application.vault.createBinary(root + '/sketch.excalidraw.svg', decode(${bufferLiteral(excalSvg)}));
            const noteFile = await application.vault.create(root + '/smoke.md', ${JSON.stringify(note)});
            const leaf = application.workspace.getLeaf('tab');
            await leaf.setViewState({
                type: 'markdown',
                state: { file: noteFile.path, mode: 'source', source: false },
                active: true
            });
            application.workspace.setActiveLeaf?.(leaf, { focus: true });
            application.workspace.revealLeaf?.(leaf);
            globalThis.__iaNativeResizeSmokeLeaf = leaf;
            await new Promise(resolve => setTimeout(resolve, 1800));
        })()`);

        const formats = ['ia-local', 'ia-url', 'ia-svg', 'ia-drawio', 'ia-excal-preview'];
        const snapshots = [];
        for (const alt of formats) {
            await clickImage(client, alt);
            snapshots.push(await client.evaluate(`(() => {
                const leaf = globalThis.__iaNativeResizeSmokeLeaf;
                const image = [...leaf.view.containerEl.querySelectorAll('img')].find(candidate =>
                    candidate.getAttribute('alt') === ${JSON.stringify(alt)}
                );
                const embed = image?.closest('.image-embed') ?? null;
                const wrapper = image?.closest('.image-wrapper') ?? null;
                const candidates = [...(embed?.querySelectorAll('*') ?? [])].filter(element => {
                    const tokens = [
                        element.className,
                        element.getAttribute?.('aria-label'),
                        element.getAttribute?.('title')
                    ].map(value => typeof value === 'string' ? value : '').join(' ');
                    return /resize|resiz|corner/i.test(tokens);
                });
                const describe = element => element ? ({
                    tag: element.tagName.toLowerCase(),
                    classes: [...element.classList],
                    style: element.getAttribute('style'),
                    ariaLabel: element.getAttribute('aria-label'),
                    title: element.getAttribute('title')
                }) : null;
                return {
                    alt: ${JSON.stringify(alt)},
                    image: describe(image),
                    embed: describe(embed),
                    wrapper: describe(wrapper),
                    wrapperCount: embed?.querySelectorAll('.image-wrapper').length ?? 0,
                    controls: candidates.map(describe),
                    nativeCornerCount: embed?.querySelectorAll('.image-resize-corner').length ?? 0,
                    pluginHandleCount: leaf.view.containerEl.querySelectorAll(
                        '.image-resize-container, [data-image-assistant-dimension-owner]'
                    ).length,
                    pluginInlineWidth: !!image?.style.width
                        || !!image?.style.height
                        || !!image?.getAttribute('data-image-assistant-dimension-owner')
                };
            })()`));
        }

        await clickImage(client, 'ia-local');
        const before = await client.evaluate(`globalThis.app.vault.read(
            globalThis.app.vault.getAbstractFileByPath(${JSON.stringify(`${temporaryPath}/smoke.md`)})
        )`);
        const drag = await client.evaluate(`(() => {
            const leaf = globalThis.__iaNativeResizeSmokeLeaf;
            const image = [...leaf.view.containerEl.querySelectorAll('img')].find(candidate =>
                candidate.getAttribute('alt') === 'ia-local'
            );
            const corner = image?.closest('.image-embed')?.querySelector('.image-resize-corner');
            if (!image || !corner) throw new Error('Native resize corner is missing');
            const imageRect = image.getBoundingClientRect();
            const cornerRect = corner.getBoundingClientRect();
            const cornerStyle = getComputedStyle(corner);
            return {
                x: cornerRect.left + cornerRect.width / 2,
                y: cornerRect.top + cornerRect.height / 2,
                width: imageRect.width,
                height: imageRect.height,
                cornerWidth: cornerRect.width,
                cornerHeight: cornerRect.height,
                cornerPointerEvents: cornerStyle.pointerEvents,
                cornerCursor: cornerStyle.cursor
            };
        })()`);
        await client.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', button: 'none', buttons: 0, pointerType: 'mouse',
            x: drag.x, y: drag.y
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        await client.send('Input.dispatchMouseEvent', {
            type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1,
            pointerType: 'mouse', x: drag.x, y: drag.y
        });
        for (let step = 1; step <= 4; step++) {
            await client.send('Input.dispatchMouseEvent', {
                type: 'mouseMoved', button: 'left', buttons: 1,
                pointerType: 'mouse',
                x: drag.x + step * 20,
                y: drag.y + step * 12
            });
            await new Promise(resolve => setTimeout(resolve, 60));
        }
        await client.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1,
            pointerType: 'mouse', x: drag.x + 80, y: drag.y + 48
        });
        await new Promise(resolve => setTimeout(resolve, 1800));
        const editorAfterDrag = await client.evaluate(
            `globalThis.__iaNativeResizeSmokeLeaf.view.editor.getValue()`
        );
        const afterDrag = await client.evaluate(`globalThis.app.vault.read(
            globalThis.app.vault.getAbstractFileByPath(${JSON.stringify(`${temporaryPath}/smoke.md`)})
        )`);

        const failures = [];
        for (const snapshot of snapshots) {
            if (snapshot.wrapperCount !== 1) {
                failures.push(`${snapshot.alt}: expected one Obsidian image-wrapper, got ${snapshot.wrapperCount}`);
            }
            if (snapshot.pluginHandleCount !== 0) {
                failures.push(`${snapshot.alt}: Image Assistant legacy resize controls were found`);
            }
            if (snapshot.pluginInlineWidth) {
                failures.push(`${snapshot.alt}: Image Assistant-owned inline dimensions were found`);
            }
            if (snapshot.nativeCornerCount !== 1) {
                failures.push(`${snapshot.alt}: expected exactly one native resize corner`);
            }
        }
        if (before === editorAfterDrag || !/!\[ia-local\|[1-9]\d*\]/.test(editorAfterDrag)) {
            failures.push('Native corner drag did not update the local image to canonical W syntax');
        }

        const report = {
            identity,
            temporaryPath,
            snapshots,
            nativeDrag: { geometry: drag, before, editorAfter: editorAfterDrag, vaultAfter: afterDrag },
            failures
        };
        console.log(JSON.stringify(report, null, 2));
        if (failures.length) process.exitCode = 1;
    } finally {
        try {
            await client.evaluate(`(async () => {
                globalThis.__iaNativeResizeSmokeLeaf?.detach?.();
                delete globalThis.__iaNativeResizeSmokeLeaf;
                const root = ${JSON.stringify(temporaryPath)};
                if (!root || !root.startsWith(${JSON.stringify(TEMP_PREFIX)})) return;
                const entry = globalThis.app.vault.getAbstractFileByPath(root);
                if (entry) await globalThis.app.vault.delete(entry, true);
            })()`);
        } catch (error) {
            console.error('[native-resize-smoke] Cleanup failed:', error.message);
            process.exitCode = 1;
        }
        await fixture.close();
        client.close();
    }
}

main().catch(error => {
    console.error(`[native-resize-smoke] ${error.stack ?? error.message}`);
    process.exitCode = 1;
});
