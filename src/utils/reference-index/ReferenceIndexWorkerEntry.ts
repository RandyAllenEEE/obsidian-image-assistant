import { parentPort } from "worker_threads";
import { ReferenceIndexWorkerCore } from "./ReferenceIndexWorkerCore";
import { handleReferenceIndexWorkerRequest } from "./ReferenceIndexWorkerHandler";
import type {
    ReferenceIndexWorkerRequest,
    ReferenceIndexWorkerResponse
} from "./ReferenceIndexWorkerProtocol";

if (!parentPort) throw new Error("Reference index worker has no parent port");
const port = parentPort;

const core = new ReferenceIndexWorkerCore();
let queue = Promise.resolve();

port.on("message", (request: ReferenceIndexWorkerRequest) => {
    queue = queue
        .then(() => handleReferenceIndexWorkerRequest(core, request))
        .then(result => {
            const response: ReferenceIndexWorkerResponse = {
                id: request.id,
                ok: true,
                result
            };
            if (result instanceof ArrayBuffer) {
                port.postMessage(response, [result]);
            } else {
                port.postMessage(response);
            }
        })
        .catch(error => {
            const response: ReferenceIndexWorkerResponse = {
                id: request.id,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            };
            port.postMessage(response);
        });
});
