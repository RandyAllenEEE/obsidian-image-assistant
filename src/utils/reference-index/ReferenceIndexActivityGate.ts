import { App, Component } from "obsidian";

const DEFAULT_QUIET_PERIOD_MS = 3_000;

interface IdleWaiter {
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
    readonly detachAbort: () => void;
}

export class ReferenceIndexActivityGate extends Component {
    private readonly documents = new WeakSet<Document>();
    private readonly waiters = new Set<IdleWaiter>();
    private idleTimer: number | null = null;
    private idle = false;
    private destroyed = false;
    private lastActivityAt = 0;

    constructor(
        private readonly app: App,
        private readonly quietPeriodMs = DEFAULT_QUIET_PERIOD_MS
    ) {
        super();
    }

    onload(): void {
        this.attachDocument(document);
        this.app.workspace.iterateAllLeaves?.(leaf => {
            const ownerDocument = leaf.view?.containerEl?.ownerDocument;
            if (ownerDocument) this.attachDocument(ownerDocument);
        });
        this.registerEvent(this.app.workspace.on("window-open" as never, (
            _workspaceWindow: unknown,
            win: Window
        ) => {
            if (win?.document) this.attachDocument(win.document);
        }));
        this.markActivity();
    }

    isIdle(): boolean {
        return this.idle;
    }

    markActivity(): void {
        this.idle = false;
        this.lastActivityAt = Date.now();
        if (this.idleTimer === null) this.scheduleIdleCheck(this.quietPeriodMs);
    }

    async waitForIdle(signal?: AbortSignal): Promise<void> {
        if (this.idle) return;
        if (this.destroyed) throw new DOMException("Activity gate was unloaded.", "AbortError");
        if (signal?.aborted) throw toAbortError(signal);
        await new Promise<void>((resolve, reject) => {
            const abort = (): void => {
                this.waiters.delete(waiter);
                reject(toAbortError(signal));
            };
            const waiter: IdleWaiter = {
                resolve,
                reject,
                detachAbort: () => signal?.removeEventListener("abort", abort)
            };
            this.waiters.add(waiter);
            signal?.addEventListener("abort", abort, { once: true });
        });
    }

    onunload(): void {
        this.destroyed = true;
        if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
        this.idleTimer = null;
        const error = new DOMException("Activity gate was unloaded.", "AbortError");
        this.waiters.forEach(waiter => {
            waiter.detachAbort();
            waiter.reject(error);
        });
        this.waiters.clear();
        super.onunload();
    }

    private attachDocument(ownerDocument: Document): void {
        if (this.documents.has(ownerDocument)) return;
        this.documents.add(ownerDocument);
        const mark = (): void => this.markActivity();
        this.registerDomEvent(ownerDocument, "keydown", mark, { capture: true });
        this.registerDomEvent(ownerDocument, "input", mark, { capture: true });
        this.registerDomEvent(ownerDocument, "pointerdown", mark, { capture: true });
        this.registerDomEvent(ownerDocument, "pointermove", mark, {
            capture: true,
            passive: true
        });
        this.registerDomEvent(ownerDocument, "wheel", mark, {
            capture: true,
            passive: true
        });
        this.registerDomEvent(ownerDocument, "scroll", mark, {
            capture: true,
            passive: true
        });
    }

    private scheduleIdleCheck(delay: number): void {
        this.idleTimer = window.setTimeout(() => {
            const remaining = this.quietPeriodMs - (Date.now() - this.lastActivityAt);
            if (remaining > 0) {
                this.scheduleIdleCheck(remaining);
                return;
            }
            this.idleTimer = null;
            this.idle = true;
            const waiters = [...this.waiters];
            this.waiters.clear();
            waiters.forEach(waiter => {
                waiter.detachAbort();
                waiter.resolve();
            });
        }, Math.max(0, delay));
    }
}

function toAbortError(signal?: AbortSignal): Error {
    return signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
}
