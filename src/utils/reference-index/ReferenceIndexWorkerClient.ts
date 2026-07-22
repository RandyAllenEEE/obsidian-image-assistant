import { Worker as NodeWorker } from "worker_threads";
import workerSources from "virtual:reference-index-worker";
import {
    ReferenceIndexWorkerCore,
    type ReferenceIndexCandidateQueryResult,
    type ReferenceIndexDocumentHeader
} from "./ReferenceIndexWorkerCore";
import type { ReferenceIndexDocumentMetadata } from "./ReferenceIndexDocument";
import type {
    ReferenceIndexWorkerRequest,
    ReferenceIndexWorkerResponse,
    ReferenceIndexWorkerResult
} from "./ReferenceIndexWorkerProtocol";
import { handleReferenceIndexWorkerRequest } from "./ReferenceIndexWorkerHandler";

type WorkerTransportKind = "browser" | "node" | "in-process";

interface WorkerTransport {
    readonly kind: WorkerTransportKind;
    postMessage(message: ReferenceIndexWorkerRequest, transfer?: readonly ArrayBuffer[]): void;
    onMessage(callback: (response: ReferenceIndexWorkerResponse) => void): void;
    onError(callback: (error: Error) => void): void;
    terminate(): Promise<void> | void;
}

interface PendingRequest {
    readonly resolve: (value: ReferenceIndexWorkerResult) => void;
    readonly reject: (error: Error) => void;
    readonly abort?: () => void;
}

type ReferenceIndexWorkerRequestPayload = ReferenceIndexWorkerRequest extends infer Request
    ? Request extends { readonly id: number }
        ? Omit<Request, "id">
        : never
    : never;

export class ReferenceIndexWorkerClient {
    private readonly pending = new Map<number, PendingRequest>();
    private transport: WorkerTransport | null = null;
    private nextId = 1;
    private terminated = false;
    private failure: Error | null = null;
    private readonly failedTransportKinds = new Set<WorkerTransportKind>();

    constructor(
        private readonly allowInProcess = isTestRuntime(),
        private readonly onFailure?: (error: Error) => void
    ) { }

    start(): void {
        if (this.transport) return;
        if (this.terminated) throw new Error("Reference index Worker was terminated");
        if (this.failure) throw this.failure;
        try {
            this.transport = this.createTransport();
            if (!this.transport) {
                throw new ReferenceIndexWorkerUnavailableError();
            }
            this.transport.onMessage(response => this.handleResponse(response));
            this.transport.onError(error => this.fail(error));
        } catch (error) {
            const failure = toError(error);
            this.fail(failure);
            throw failure;
        }
    }

    async hydrate(buffer: ArrayBuffer, signal?: AbortSignal): Promise<{
        accepted: boolean;
        generation: number;
        headers: readonly ReferenceIndexDocumentHeader[];
    }> {
        return this.request({ type: "hydrate", buffer }, signal, [buffer]) as Promise<{
            accepted: boolean;
            generation: number;
            headers: readonly ReferenceIndexDocumentHeader[];
        }>;
    }

    async upsertDocument(
        metadata: ReferenceIndexDocumentMetadata,
        content: string,
        signal?: AbortSignal
    ): Promise<ReferenceIndexDocumentHeader> {
        return this.request({
            type: "upsert-document",
            metadata,
            content
        }, signal) as Promise<ReferenceIndexDocumentHeader>;
    }

    async deleteDocument(path: string, signal?: AbortSignal): Promise<boolean> {
        return this.request({ type: "delete-document", path }, signal) as Promise<boolean>;
    }

    async upsertOverlay(
        metadata: ReferenceIndexDocumentMetadata,
        content: string,
        signal?: AbortSignal
    ): Promise<void> {
        await this.request({ type: "upsert-overlay", metadata, content }, signal);
    }

    async deleteOverlay(path: string, signal?: AbortSignal): Promise<void> {
        await this.request({ type: "delete-overlay", path }, signal);
    }

    async getHeaders(signal?: AbortSignal): Promise<readonly ReferenceIndexDocumentHeader[]> {
        return this.request({ type: "get-headers" }, signal) as Promise<
            readonly ReferenceIndexDocumentHeader[]
        >;
    }

    async getGeneration(signal?: AbortSignal): Promise<number> {
        return this.request({ type: "get-generation" }, signal) as Promise<number>;
    }

    async queryLocal(
        basenames: readonly string[],
        includeFencedCode: boolean,
        overlayPaths: readonly string[],
        signal?: AbortSignal
    ): Promise<Record<string, ReferenceIndexCandidateQueryResult>> {
        return this.request({
            type: "query-local",
            basenames,
            includeFencedCode,
            overlayPaths
        }, signal) as Promise<Record<string, ReferenceIndexCandidateQueryResult>>;
    }

    async queryUrl(
        url: string,
        includeFencedCode: boolean,
        overlayPaths: readonly string[],
        signal?: AbortSignal
    ): Promise<ReferenceIndexCandidateQueryResult> {
        return this.request({
            type: "query-url",
            url,
            includeFencedCode,
            overlayPaths
        }, signal) as Promise<ReferenceIndexCandidateQueryResult>;
    }

    async serialize(signal?: AbortSignal): Promise<ArrayBuffer> {
        return this.request({ type: "serialize" }, signal) as Promise<ArrayBuffer>;
    }

    async setPaused(paused: boolean): Promise<void> {
        await this.request({ type: paused ? "pause" : "resume" });
    }

    async terminate(): Promise<void> {
        if (this.terminated) return;
        this.terminated = true;
        const error = new Error("Reference index Worker was terminated");
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
        await this.transport?.terminate();
        this.transport = null;
    }

    async restart(): Promise<void> {
        if (this.terminated) {
            throw new Error("Reference index Worker was terminated");
        }
        const error = new Error("Reference index Worker is restarting");
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
        const transport = this.transport;
        this.transport = null;
        this.failure = null;
        await transport?.terminate();
        this.start();
    }

    private request(
        payload: ReferenceIndexWorkerRequestPayload,
        signal?: AbortSignal,
        transfer: readonly ArrayBuffer[] = []
    ): Promise<ReferenceIndexWorkerResult> {
        this.start();
        if (!this.transport) return Promise.reject(new Error("Reference index Worker unavailable"));
        if (signal?.aborted) return Promise.reject(toAbortError(signal));
        const id = this.nextId++;
        const request = { id, ...payload } as ReferenceIndexWorkerRequest;
        return new Promise((resolve, reject) => {
            const abort = signal ? (): void => {
                this.pending.delete(id);
                reject(toAbortError(signal));
            } : undefined;
            if (abort) signal?.addEventListener("abort", abort, { once: true });
            this.pending.set(id, {
                resolve: value => {
                    if (abort) signal?.removeEventListener("abort", abort);
                    resolve(value);
                },
                reject: error => {
                    if (abort) signal?.removeEventListener("abort", abort);
                    reject(error);
                },
                abort
            });
            this.transport?.postMessage(request, transfer);
        });
    }

    private handleResponse(response: ReferenceIndexWorkerResponse): void {
        const request = this.pending.get(response.id);
        if (!request) return;
        this.pending.delete(response.id);
        if (response.ok) request.resolve(response.result);
        else request.reject(new Error(response.error));
    }

    private fail(error: Error): void {
        if (this.terminated || this.failure) return;
        if (this.transport) this.failedTransportKinds.add(this.transport.kind);
        this.failure = error;
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
        const transport = this.transport;
        this.transport = null;
        void transport?.terminate();
        this.onFailure?.(error);
    }

    private createTransport(): WorkerTransport | null {
        const failures: Error[] = [];
        if (workerSources.browser
            && typeof globalThis.Worker === "function"
            && !this.failedTransportKinds.has("browser")) {
            try {
                return new BrowserWorkerTransport(workerSources.browser);
            } catch (error) {
                this.failedTransportKinds.add("browser");
                failures.push(toError(error));
            }
        }
        if (workerSources.node && !this.failedTransportKinds.has("node")) {
            try {
                return new NodeWorkerTransport(workerSources.node);
            } catch (error) {
                this.failedTransportKinds.add("node");
                failures.push(toError(error));
            }
        }
        if (this.allowInProcess && !this.failedTransportKinds.has("in-process")) {
            return new InProcessWorkerTransport();
        }
        if (failures.length > 0) {
            throw new ReferenceIndexWorkerUnavailableError(failures);
        }
        return null;
    }
}

export class ReferenceIndexWorkerUnavailableError extends Error {
    readonly retryable = false;

    constructor(readonly causes: readonly Error[] = []) {
        super(causes.length > 0
            ? `Reference index Worker is unavailable: ${causes.map(error => error.message).join("; ")}`
            : "Reference index Worker is unavailable");
        this.name = "ReferenceIndexWorkerUnavailableError";
    }
}

export function isReferenceIndexWorkerUnavailable(
    error: unknown
): error is ReferenceIndexWorkerUnavailableError {
    return error instanceof ReferenceIndexWorkerUnavailableError
        || (error instanceof Error
            && error.name === "ReferenceIndexWorkerUnavailableError");
}

class BrowserWorkerTransport implements WorkerTransport {
    readonly kind = "browser" as const;
    private readonly worker: Worker;
    private readonly objectUrl: string;
    private terminated = false;

    constructor(source: string) {
        this.objectUrl = URL.createObjectURL(new Blob([source], {
            type: "text/javascript"
        }));
        try {
            this.worker = new Worker(this.objectUrl, {
                name: "image-assistant-reference-index"
            });
        } catch (error) {
            URL.revokeObjectURL(this.objectUrl);
            throw error;
        }
    }

    postMessage(
        message: ReferenceIndexWorkerRequest,
        transfer: readonly ArrayBuffer[] = []
    ): void {
        this.worker.postMessage(message, [...transfer]);
    }

    onMessage(callback: (response: ReferenceIndexWorkerResponse) => void): void {
        this.worker.addEventListener("message", event => callback(event.data));
    }

    onError(callback: (error: Error) => void): void {
        this.worker.addEventListener("error", event => {
            event.preventDefault();
            callback(new Error(event.message || "Reference index Web Worker failed"));
        });
        this.worker.addEventListener("messageerror", () => {
            callback(new Error("Reference index Web Worker returned unreadable data"));
        });
    }

    terminate(): void {
        if (this.terminated) return;
        this.terminated = true;
        this.worker.terminate();
        URL.revokeObjectURL(this.objectUrl);
    }
}

class NodeWorkerTransport implements WorkerTransport {
    readonly kind = "node" as const;
    private readonly worker: NodeWorker;
    private terminating = false;

    constructor(source: string) {
        this.worker = new NodeWorker(source, { eval: true });
    }

    postMessage(message: ReferenceIndexWorkerRequest, transfer: readonly ArrayBuffer[] = []): void {
        this.worker.postMessage(message, [...transfer]);
    }

    onMessage(callback: (response: ReferenceIndexWorkerResponse) => void): void {
        this.worker.on("message", callback);
    }

    onError(callback: (error: Error) => void): void {
        this.worker.on("error", callback);
        this.worker.on("exit", code => {
            if (!this.terminating && code !== 0) {
                callback(new Error(`Reference index Worker exited with code ${code}`));
            }
        });
    }

    terminate(): Promise<void> {
        this.terminating = true;
        return this.worker.terminate().then(() => undefined);
    }
}

class InProcessWorkerTransport implements WorkerTransport {
    readonly kind = "in-process" as const;
    private readonly core = new ReferenceIndexWorkerCore();
    private messageCallback: ((response: ReferenceIndexWorkerResponse) => void) | null = null;
    private errorCallback: ((error: Error) => void) | null = null;
    private queue = Promise.resolve();

    postMessage(message: ReferenceIndexWorkerRequest): void {
        this.queue = this.queue.then(() => {
            try {
                this.messageCallback?.({
                    id: message.id,
                    ok: true,
                    result: handleReferenceIndexWorkerRequest(this.core, message)
                });
            } catch (error) {
                this.messageCallback?.({
                    id: message.id,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }).catch(error => this.errorCallback?.(error));
    }

    onMessage(callback: (response: ReferenceIndexWorkerResponse) => void): void {
        this.messageCallback = callback;
    }

    onError(callback: (error: Error) => void): void {
        this.errorCallback = callback;
    }

    terminate(): void {
        this.messageCallback = null;
        this.errorCallback = null;
    }
}

function isTestRuntime(): boolean {
    return typeof __TEST__ !== "undefined" && __TEST__;
}

function toAbortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
