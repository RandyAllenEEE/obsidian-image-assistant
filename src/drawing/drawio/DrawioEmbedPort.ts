import {
    areDrawioModelsEquivalent,
    assertValidSvg,
    decodeDrawioDataUri
} from "./DiagramFile";
import { buildDrawioEmbedUrl, type DrawioEmbedAppearance } from "./DrawioEmbedUrl";
import {
    createDrawioProtocolSender,
    type DrawioProtocolSender
} from "./DrawioProtocolSender";
import type {
    DiagramEditorPort,
    DiagramExportFormat,
    DiagramExportOptions,
    DiagramExportResult,
    DiagramRect,
    DiagramViewMetadata
} from "./DrawioTypes";

const HANDSHAKE_TIMEOUT_MS = 30_000;
const EXPORT_TIMEOUT_MS = 30_000;
const LOAD_PROBE_DELAY_MS = 1_500;
const MAX_MESSAGE_CHARS = 64 * 1024 * 1024;

interface PendingRequest<T> {
    resolve(value: T): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
}

interface PendingExportRequest extends PendingRequest<DiagramExportResult> {
    readonly format: DiagramExportFormat;
}

interface PendingLoadRequest extends PendingRequest<DiagramViewMetadata> {
    readonly source: string;
    readonly epoch: number;
    probeTimer: ReturnType<typeof setTimeout> | null;
    probeRequestId: string | null;
    probeState: "waiting" | "sent" | "matched" | "mismatch";
    acknowledgementSeen: boolean;
}

interface DrawioMessage {
    event?: string;
    format?: string | null;
    message?: string | DrawioRequestEcho | null;
    xml?: string | null;
    data?: string | null;
    href?: string | null;
    // Draw.io metadata has varied across official, cached and self-hosted builds.
    // Keep it untrusted here and validate each field only when consuming it.
    currentPage?: unknown;
    bounds?: unknown;
    scale?: unknown;
}

interface DrawioRequestEcho {
    readonly action: "export";
    readonly format?: string;
    readonly message?: string;
}

interface DrawioProtocolPeer {
    readonly target: Window;
    readonly origin: string;
    readonly epoch: number;
}

export class DrawioEmbedPort implements DiagramEditorPort {
    private iframe: HTMLIFrameElement | null = null;
    private ownerWindow: Window | null = null;
    private protocolSender: DrawioProtocolSender | null = null;
    private protocolPeer: DrawioProtocolPeer | null = null;
    private origin = "";
    private initRequest: PendingRequest<void> | null = null;
    private loadRequest: PendingLoadRequest | null = null;
    private readonly exportRequests = new Map<string, PendingExportRequest>();
    private readonly dirtyListeners = new Set<(xml: string, metadata: DiagramViewMetadata) => void>();
    private exportQueue: Promise<unknown> = Promise.resolve();
    private disposed = false;
    private initialized = false;
    private iframeLoaded = false;
    private iframeLoadCount = 0;
    private lastProtocolEvent: string | null = null;
    private rejectedOrigin: string | null = null;
    private lastRejectedMessageReason: string | null = null;
    private lastConfirmedSource = "";
    private protocolEpoch = 0;
    private fatalOperationError: Error | null = null;
    private lastOutboundAction: string | null = null;
    private lastOutboundError: string | null = null;
    private viewMetadata: DiagramViewMetadata = emptyViewMetadata();

    constructor(
        private readonly configuredUrl: string,
        private readonly appearance: DrawioEmbedAppearance = {}
    ) { }

    mount(container: HTMLElement): Promise<void> {
        if (this.iframe) throw new Error("Draw.io editor is already mounted.");
        this.disposed = false;
        this.initialized = false;
        this.iframeLoaded = false;
        this.iframeLoadCount = 0;
        this.lastProtocolEvent = null;
        this.rejectedOrigin = null;
        this.lastRejectedMessageReason = null;
        this.lastConfirmedSource = "";
        this.fatalOperationError = null;
        this.lastOutboundAction = null;
        this.lastOutboundError = null;
        this.protocolPeer = null;
        this.protocolEpoch++;
        const { url } = buildDrawioEmbedUrl(this.configuredUrl, this.appearance);
        this.origin = url.origin;
        this.ownerWindow = container.ownerDocument.defaultView;
        if (!this.ownerWindow) throw new Error("The Draw.io host window is unavailable.");
        this.protocolSender = createDrawioProtocolSender(this.ownerWindow);

        const iframe = container.ownerDocument.createElement("iframe");
        iframe.className = "image-assistant-drawing-iframe";
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.border = "0";
        iframe.src = url.toString();
        iframe.setAttribute(
            "sandbox",
            "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"
        );
        iframe.setAttribute("allow", "clipboard-read; clipboard-write");
        iframe.referrerPolicy = "no-referrer";
        iframe.addEventListener("load", () => {
            if (this.iframe === iframe) {
                this.iframeLoaded = true;
                this.iframeLoadCount++;
            }
        });
        iframe.addEventListener("error", () => {
            const pending = this.initRequest;
            this.initRequest = null;
            this.rejectPending(pending, new Error("Draw.io iframe failed to load."));
        });
        this.iframe = iframe;
        this.ownerWindow.addEventListener("message", this.handleMessage);

        const ready = new Promise<void>((resolve, reject) => {
            this.initRequest = this.createPending(
                resolve,
                reject,
                HANDSHAKE_TIMEOUT_MS,
                () => this.getInitTimeoutMessage(),
                () => { this.initRequest = null; }
            );
        });
        container.appendChild(iframe);
        return ready;
    }

    async load(source: string): Promise<DiagramViewMetadata> {
        this.assertOperational();
        if (!this.iframe?.contentWindow || this.disposed) {
            throw new Error("Draw.io editor is not available.");
        }
        if (this.loadRequest) throw new Error("A Draw.io load is already pending.");
        const requestEpoch = this.protocolEpoch;
        const activePageBeforeLoad = this.viewMetadata.currentPage;
        const loaded = new Promise<DiagramViewMetadata>((resolve, reject) => {
            const pending = this.createPending(
                resolve,
                reject,
                HANDSHAKE_TIMEOUT_MS,
                () => this.getLoadTimeoutMessage(),
                error => {
                    this.clearLoadProbe(this.loadRequest);
                    this.loadRequest = null;
                    this.fatalOperationError = new Error(
                        `${error.message} Reopen the Draw.io editor before retrying.`
                    );
                }
            );
            this.loadRequest = {
                ...pending,
                source,
                epoch: requestEpoch,
                probeTimer: setTimeout(() => {
                    if (this.loadRequest) this.startLoadProbe(this.loadRequest);
                }, LOAD_PROBE_DELAY_MS),
                probeRequestId: null,
                probeState: "waiting",
                acknowledgementSeen: false
            };
        });
        try {
            this.post({
                action: "load",
                xml: source,
                autosave: 1,
                saveAndExit: 0,
                noSaveBtn: 1,
                noExitBtn: 1
            });
        } catch (error) {
            this.failLoadRequest(this.loadRequest, toError(error));
        }
        const metadata = await loaded;
        if (requestEpoch !== this.protocolEpoch) {
            throw new Error("Draw.io iframe reloaded during the load operation.");
        }
        this.lastConfirmedSource = source;
        if (activePageBeforeLoad === null || metadata.currentPage === activePageBeforeLoad) {
            return metadata;
        }

        const currentPage = metadata.currentPage ?? 0;
        const actionName = activePageBeforeLoad > currentPage ? "nextPage" : "previousPage";
        const steps = Math.abs(activePageBeforeLoad - currentPage);
        for (let index = 0; index < steps; index++) {
            this.post({ action: "invokeAction", actionName });
        }
        // postMessage preserves ordering for one source/target pair. The export is both an
        // acknowledgement and a metadata refresh after the page-selection actions.
        return (await this.export("xml")).metadata;
    }

    export(format: DiagramExportFormat, options: DiagramExportOptions = {}): Promise<DiagramExportResult> {
        try {
            this.assertOperational();
        } catch (error) {
            return Promise.reject(error);
        }
        const requestEpoch = this.protocolEpoch;
        const operation = this.exportQueue.then(() => {
            this.assertOperational();
            if (requestEpoch !== this.protocolEpoch) {
                throw new Error("Draw.io iframe reloaded before the export started.");
            }
            return this.exportNow(format, options);
        });
        this.exportQueue = operation.catch(() => undefined);
        return operation;
    }

    getViewMetadata(): DiagramViewMetadata {
        return cloneViewMetadata(this.viewMetadata);
    }

    onDirty(listener: (xml: string, metadata: DiagramViewMetadata) => void): () => void {
        this.dirtyListeners.add(listener);
        return () => this.dirtyListeners.delete(listener);
    }

    destroy(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.ownerWindow?.removeEventListener("message", this.handleMessage);
        const error = new Error("Draw.io editor was closed.");
        this.rejectPending(this.initRequest, error);
        this.rejectPending(this.loadRequest, error);
        this.clearLoadProbe(this.loadRequest);
        this.initRequest = null;
        this.loadRequest = null;
        for (const pending of this.exportRequests.values()) this.rejectPending(pending, error);
        this.exportRequests.clear();
        this.dirtyListeners.clear();
        this.iframe?.remove();
        this.iframe = null;
        this.ownerWindow = null;
        this.protocolPeer = null;
        this.protocolSender = null;
    }

    private exportNow(
        format: DiagramExportFormat,
        options: DiagramExportOptions
    ): Promise<DiagramExportResult> {
        if (!this.iframe?.contentWindow || this.disposed) {
            return Promise.reject(new Error("Draw.io editor is not available."));
        }
        if (this.loadRequest) {
            return Promise.reject(new Error("Draw.io is still loading the diagram."));
        }
        const requestId = `image-assistant-${globalThis.crypto?.randomUUID?.()
            ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
        const response = new Promise<DiagramExportResult>((resolve, reject) => {
            this.exportRequests.set(requestId, {
                ...this.createPending(
                    resolve,
                    reject,
                    EXPORT_TIMEOUT_MS,
                    `Draw.io ${format} export timed out.`,
                    () => { this.exportRequests.delete(requestId); }
                ),
                format
            });
        });
        try {
            this.post({
                action: "export",
                format,
                message: requestId,
                ...(options.currentPage ? { currentPage: true } : {})
            });
        } catch (error) {
            const pending = this.exportRequests.get(requestId) ?? null;
            this.exportRequests.delete(requestId);
            this.rejectPending(pending, toError(error));
        }
        return response;
    }

    private readonly handleMessage = (event: MessageEvent): void => {
        if (this.disposed || !this.iframe?.contentWindow) return;
        const isCurrentFrame = event.source === this.iframe.contentWindow;
        const isCurrentPeer = event.source === this.protocolPeer?.target;
        if (!isCurrentFrame && !isCurrentPeer) {
            this.lastRejectedMessageReason = "unexpected message source";
            return;
        }
        if (event.origin !== this.origin) {
            this.rejectedOrigin = event.origin || "null";
            this.lastRejectedMessageReason = `unexpected origin ${this.rejectedOrigin}`;
            return;
        }
        if (typeof event.data === "string" && event.data.length > MAX_MESSAGE_CHARS) {
            this.lastRejectedMessageReason = "message exceeded the size limit";
            return;
        }
        if (typeof event.data !== "string" && serializedLength(event.data) > MAX_MESSAGE_CHARS) {
            this.lastRejectedMessageReason = "message exceeded the size limit";
            return;
        }
        const message = parseMessage(event.data);
        if (!message?.event) {
            this.lastRejectedMessageReason = "invalid message schema";
            return;
        }
        this.lastProtocolEvent = message.event;
        if (message.event !== "load") this.updateViewMetadata(message);
        const requestEcho = getRequestEcho(message.message);
        if ([message.xml, message.data, message.href,
            typeof message.message === "string" ? message.message : undefined,
            requestEcho?.format, requestEcho?.message]
            .some(value => typeof value === "string" && value.length > MAX_MESSAGE_CHARS)) return;

        if (message.event === "init") {
            if (!isCurrentFrame || event.source === null) {
                this.lastRejectedMessageReason = "init came from an inactive iframe";
                return;
            }
            // Equality with iframe.contentWindow above is the cross-realm-safe
            // proof that this MessageEventSource is the expected WindowProxy.
            const source = event.source as Window;
            if (!this.initialized) {
                this.bindProtocolPeer(source, event.origin);
                this.initialized = true;
                this.resolvePending(this.initRequest, undefined);
                this.initRequest = null;
            } else {
                this.handleIframeReload(source, event.origin);
            }
            return;
        }
        if (!isCurrentPeer || this.protocolPeer?.epoch !== this.protocolEpoch) {
            this.lastRejectedMessageReason = "message came from an inactive protocol session";
            return;
        }
        // This plugin does not request the optional configuration handshake.
        // Ignore an unsolicited event instead of entering an upstream startup
        // path whose completion cannot be acknowledged safely.
        if (message.event === "configure") return;
        if (message.event === "load") {
            const pending = this.loadRequest;
            if (!pending) return;
            if (typeof message.xml === "string") {
                const equivalent = areDrawioModelsEquivalent(pending.source, message.xml);
                if (equivalent === false) {
                    this.startLoadProbe(pending);
                    return;
                }
            }
            this.updateViewMetadata(message, true);
            pending.acknowledgementSeen = true;
            // Once an ordered export probe has been sent, drain and verify its
            // response before allowing later public exports into the same epoch.
            if (pending.probeState !== "sent") this.finishLoad(pending);
            return;
        }
        if ((message.event === "autosave" || message.event === "save") && typeof message.xml === "string") {
            // Ignore startup noise until the load has been independently
            // acknowledged or verified by an ordered XML export.
            if (this.loadRequest) return;
            this.lastConfirmedSource = message.xml;
            const metadata = this.getViewMetadata();
            for (const listener of this.dirtyListeners) listener(message.xml, metadata);
            return;
        }
        if (message.event === "export") {
            if (this.handleLoadProbeResponse(message)) return;
            const resolved = this.resolveExportRequest(message);
            if (!resolved) return;
            const [requestId, pending] = resolved;
            this.exportRequests.delete(requestId);
            try {
                const value = readExportValue(pending.format, message);
                if (value === null) throw new Error("Draw.io export response was incomplete.");
                this.resolvePending(pending, {
                    data: value,
                    metadata: this.getViewMetadata()
                });
            } catch (error) {
                this.rejectPending(pending, toError(error));
            }
            return;
        }
        if (message.event === "openLink" && typeof message.href === "string") {
            this.openExternalLink(message.href);
        }
    };

    private resolveExportRequest(message: DrawioMessage): [string, PendingExportRequest] | null {
        const requestEcho = getRequestEcho(message.message);
        const correlationId = typeof message.message === "string"
            ? message.message
            : requestEcho?.message;
        if (correlationId) {
            const correlated = this.exportRequests.get(correlationId);
            if (correlated) return [correlationId, correlated];

            // A late response carrying one of our request IDs must never satisfy a newer export.
            if (correlationId.startsWith("image-assistant-")) return null;
        }

        // Some official and self-hosted builds omit the optional echoed `message` field.
        // Exports are serialized, so a single format-compatible request is unambiguous.
        if (this.exportRequests.size !== 1) return null;
        const entry = this.exportRequests.entries().next().value as
            | [string, PendingExportRequest]
            | undefined;
        if (!entry) return null;
        const [, pending] = entry;
        if (!isCompatibleExportFormat(message.format, requestEcho?.format, pending.format)) return null;
        return entry;
    }

    private post(message: Record<string, unknown>): void {
        const peer = this.protocolPeer;
        const sender = this.protocolSender;
        const action = typeof message.action === "string" ? message.action : "unknown";
        this.lastOutboundAction = action;
        this.lastOutboundError = null;
        if (!peer || peer.epoch !== this.protocolEpoch || !sender) {
            const error = new Error("Draw.io has no active authenticated protocol session.");
            this.lastOutboundError = error.message;
            throw error;
        }
        try {
            sender(peer.target, JSON.stringify(message), peer.origin);
        } catch (error) {
            const failure = toError(error);
            this.lastOutboundError = failure.message;
            throw new Error(`Draw.io ${action} message could not be sent: ${failure.message}`);
        }
    }

    private startLoadProbe(pending: PendingLoadRequest): void {
        if (this.loadRequest !== pending
            || pending.epoch !== this.protocolEpoch
            || pending.probeState !== "waiting") return;
        if (pending.probeTimer) clearTimeout(pending.probeTimer);
        pending.probeTimer = null;
        pending.probeRequestId = createRequestId("image-assistant-load-probe");
        try {
            this.post({
                action: "export",
                format: "xml",
                message: pending.probeRequestId
            });
            pending.probeState = "sent";
        } catch (error) {
            this.failLoadRequest(pending, toError(error));
        }
    }

    private handleLoadProbeResponse(message: DrawioMessage): boolean {
        const pending = this.loadRequest;
        if (!pending || pending.probeState !== "sent" || !pending.probeRequestId) return false;
        const requestEcho = getRequestEcho(message.message);
        const correlationId = typeof message.message === "string"
            ? message.message
            : requestEcho?.message;
        if (correlationId && correlationId !== pending.probeRequestId) return false;
        if (!correlationId && this.exportRequests.size > 0) return false;
        if (!isCompatibleExportFormat(message.format, requestEcho?.format, "xml")) return false;

        const exported = readExportValue("xml", message);
        const equivalent = exported === null
            ? false
            : areDrawioModelsEquivalent(pending.source, exported);
        if (equivalent === true) {
            pending.probeState = "matched";
            this.finishLoad(pending);
            return true;
        }
        if (equivalent === null && pending.acknowledgementSeen) {
            // A standard load event remains authoritative for a compressed or
            // oversized model that cannot be compared locally.
            this.finishLoad(pending);
            return true;
        }

        pending.probeState = "mismatch";
        const error = new Error(
            "Draw.io answered the load probe, but the active diagram did not match the requested model."
        );
        this.fatalOperationError = error;
        this.clearLoadProbe(pending);
        this.loadRequest = null;
        this.rejectPending(pending, error);
        return true;
    }

    private finishLoad(pending: PendingLoadRequest): void {
        if (this.loadRequest !== pending || pending.epoch !== this.protocolEpoch) return;
        this.clearLoadProbe(pending);
        this.loadRequest = null;
        this.resolvePending(pending, this.getViewMetadata());
    }

    private clearLoadProbe(pending: PendingLoadRequest | null): void {
        if (pending?.probeTimer) clearTimeout(pending.probeTimer);
        if (pending) pending.probeTimer = null;
    }

    private openExternalLink(value: string): void {
        try {
            const url = new URL(value);
            if (url.protocol !== "http:" && url.protocol !== "https:") return;
            this.ownerWindow?.open(url.toString(), "_blank", "noopener,noreferrer");
        } catch {
            // Ignore malformed links from the embedded editor.
        }
    }

    private updateViewMetadata(message: DrawioMessage, replace = false): void {
        const currentPage = isPageIndex(message.currentPage)
            ? message.currentPage
            : replace ? null : this.viewMetadata.currentPage;
        const bounds = readRect(message.bounds) ?? (replace ? null : this.viewMetadata.bounds);
        const scale = isFinitePositiveNumber(message.scale)
            ? message.scale
            : replace ? null : this.viewMetadata.scale;
        this.viewMetadata = { currentPage, bounds, scale };
    }

    private createPending<T>(
        resolve: (value: T) => void,
        reject: (error: Error) => void,
        timeoutMs: number,
        timeoutMessage: string | (() => string),
        onTimeout?: (error: Error) => void
    ): PendingRequest<T> {
        const pending: PendingRequest<T> = {
            resolve,
            reject,
            timer: setTimeout(() => {
                const error = new Error(typeof timeoutMessage === "function"
                    ? timeoutMessage()
                    : timeoutMessage);
                onTimeout?.(error);
                reject(error);
            }, timeoutMs)
        };
        return pending;
    }

    private resolvePending<T>(pending: PendingRequest<T> | null, value: T): void {
        if (!pending) return;
        clearTimeout(pending.timer);
        pending.resolve(value);
    }

    private rejectPending<T>(pending: PendingRequest<T> | null, error: Error): void {
        if (!pending) return;
        clearTimeout(pending.timer);
        pending.reject(error);
    }

    private handleIframeReload(source: Window, origin: string): void {
        const error = new Error("Draw.io iframe reloaded during an operation.");
        this.protocolEpoch++;
        this.rejectPending(this.loadRequest, error);
        this.clearLoadProbe(this.loadRequest);
        this.loadRequest = null;
        for (const pending of this.exportRequests.values()) this.rejectPending(pending, error);
        this.exportRequests.clear();
        this.bindProtocolPeer(source, origin);
        if (this.lastConfirmedSource) {
            void this.load(this.lastConfirmedSource).catch(reloadError => {
                console.error("[Image Assistant Drawing] Failed to restore reloaded iframe:", reloadError);
            });
        }
    }

    private bindProtocolPeer(target: Window, origin: string): void {
        this.protocolPeer = {
            target,
            origin,
            epoch: this.protocolEpoch
        };
    }

    private failLoadRequest(pending: PendingLoadRequest | null, error: Error): void {
        if (!pending || this.loadRequest !== pending) return;
        this.clearLoadProbe(pending);
        this.loadRequest = null;
        this.fatalOperationError = new Error(
            `${error.message} Reopen the Draw.io editor before retrying.`
        );
        this.rejectPending(pending, error);
    }

    private assertOperational(): void {
        if (this.fatalOperationError) throw this.fatalOperationError;
    }

    private getInitTimeoutMessage(): string {
        if (this.rejectedOrigin) {
            return `Draw.io responded from ${this.rejectedOrigin}, but ${this.origin} was expected.`;
        }
        if (this.iframeLoaded) {
            return "Draw.io loaded in the iframe but did not send an init event. Check proxy, firewall, or content-blocking settings.";
        }
        return "Draw.io did not finish loading before the init handshake timed out.";
    }

    private getLoadTimeoutMessage(): string {
        const diagnostics = [
            `last event: ${this.lastProtocolEvent ?? "none"}`,
            `probe: ${this.loadRequest?.probeState ?? "none"}`,
            `iframe loads: ${this.iframeLoadCount}`
        ];
        if (this.lastRejectedMessageReason) diagnostics.push(`rejected: ${this.lastRejectedMessageReason}`);
        if (this.lastOutboundAction) diagnostics.push(`last outbound: ${this.lastOutboundAction}`);
        if (this.lastOutboundError) diagnostics.push(`outbound error: ${this.lastOutboundError}`);
        return `Draw.io did not finish loading the diagram (${diagnostics.join("; ")}).`;
    }
}

function parseMessage(value: unknown): DrawioMessage | null {
    if (typeof value === "string") {
        try {
            value = JSON.parse(value) as unknown;
        } catch {
            return null;
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.event !== "string") return null;
    for (const field of ["format", "xml", "data", "href"] as const) {
        if (candidate[field] != null && typeof candidate[field] !== "string") return null;
    }
    // Optional view metadata must not invalidate an otherwise valid protocol
    // event. Some Draw.io builds report null currentPage/bounds or scale 0 while
    // loading. updateViewMetadata() accepts only valid values and ignores the
    // individual malformed fields.
    if (candidate.message != null
        && typeof candidate.message !== "string"
        && !isRequestMessage(candidate.message)) return null;
    return candidate as DrawioMessage;
}

function isRequestMessage(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.action !== "string" || candidate.action.length > 100) return false;
    if (candidate.format != null && typeof candidate.format !== "string") return false;
    if (candidate.message != null && typeof candidate.message !== "string") return false;
    return true;
}

function serializedLength(value: unknown): number {
    try {
        return JSON.stringify(value).length;
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

function emptyViewMetadata(): DiagramViewMetadata {
    return { currentPage: null, bounds: null, scale: null };
}

function cloneViewMetadata(value: DiagramViewMetadata): DiagramViewMetadata {
    return {
        currentPage: value.currentPage,
        bounds: value.bounds ? { ...value.bounds } : null,
        scale: value.scale
    };
}

function isPageIndex(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFinitePositiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function readRect(value: unknown): DiagramRect | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    const fields = [candidate.x, candidate.y, candidate.width, candidate.height];
    if (!fields.every(field => typeof field === "number" && Number.isFinite(field))) return null;
    if ((candidate.width as number) < 0 || (candidate.height as number) < 0) return null;
    return {
        x: candidate.x as number,
        y: candidate.y as number,
        width: candidate.width as number,
        height: candidate.height as number
    };
}

function getRequestEcho(value: unknown): DrawioRequestEcho | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (candidate.action !== "export") return null;
    if (candidate.format != null && typeof candidate.format !== "string") return null;
    if (candidate.message != null && typeof candidate.message !== "string") return null;
    return {
        action: "export",
        format: typeof candidate.format === "string" ? candidate.format : undefined,
        message: typeof candidate.message === "string" ? candidate.message : undefined
    } as DrawioRequestEcho;
}

function isCompatibleExportFormat(
    responseFormat: string | null | undefined,
    echoedFormat: string | undefined,
    expectedFormat: DiagramExportFormat
): boolean {
    if (echoedFormat) return echoedFormat === expectedFormat;
    if (!responseFormat || responseFormat === expectedFormat) return true;
    // Current Draw.io builds report xmlsvg exports as top-level `format: "svg"`.
    return expectedFormat === "xmlsvg" && responseFormat === "svg";
}

function readPngDataUri(value: string | null | undefined): string | null {
    if (typeof value !== "string") return null;
    return /^data:image\/png(?:;[^,]*)?,/i.test(value) ? value : null;
}

function readExportValue(format: DiagramExportFormat, message: DrawioMessage): string | null {
    if (format === "png") return readPngDataUri(message.data);
    const value = typeof message.data === "string"
        ? format === "xmlsvg"
            ? decodeDrawioDataUri(message.data)
            : decodeTextDataUri(message.data)
        : typeof message.xml === "string"
            ? message.xml
            : null;
    if (value === null) return null;
    if (format === "svg") assertValidSvg(value);
    return value;
}

function decodeTextDataUri(value: string): string {
    const comma = value.indexOf(",");
    if (!value.startsWith("data:") || comma < 0) return value;
    const header = value.slice(0, comma).toLowerCase();
    const payload = value.slice(comma + 1);
    if (!header.includes(";base64")) return decodeURIComponent(payload);
    const binary = atob(payload);
    return new TextDecoder().decode(Uint8Array.from(
        binary,
        character => character.charCodeAt(0)
    ));
}

function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}

function createRequestId(prefix: string): string {
    return `${prefix}-${globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
