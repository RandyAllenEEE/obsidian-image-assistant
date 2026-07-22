import { ReferenceIndexWorkerCore } from "./ReferenceIndexWorkerCore";
import { handleReferenceIndexWorkerRequest } from "./ReferenceIndexWorkerHandler";
import type {
    ReferenceIndexWorkerRequest,
    ReferenceIndexWorkerResponse
} from "./ReferenceIndexWorkerProtocol";

interface ReferenceIndexWebWorkerScope {
    onmessage: ((event: MessageEvent<ReferenceIndexWorkerRequest>) => void) | null;
    postMessage(message: ReferenceIndexWorkerResponse, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as ReferenceIndexWebWorkerScope;
const core = new ReferenceIndexWorkerCore();
let queue = Promise.resolve();

scope.onmessage = event => {
    const request = event.data;
    queue = queue
        .then(() => handleReferenceIndexWorkerRequest(core, request))
        .then(result => {
            const response: ReferenceIndexWorkerResponse = {
                id: request.id,
                ok: true,
                result
            };
            if (result instanceof ArrayBuffer) {
                scope.postMessage(response, [result]);
            } else {
                scope.postMessage(response);
            }
        })
        .catch(error => {
            scope.postMessage({
                id: request.id,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        });
};
