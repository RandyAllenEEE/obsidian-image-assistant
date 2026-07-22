import { ReferenceIndexWorkerCore } from "./ReferenceIndexWorkerCore";
import type {
    ReferenceIndexWorkerRequest,
    ReferenceIndexWorkerResult
} from "./ReferenceIndexWorkerProtocol";

export function handleReferenceIndexWorkerRequest(
    core: ReferenceIndexWorkerCore,
    request: ReferenceIndexWorkerRequest
): ReferenceIndexWorkerResult {
    switch (request.type) {
        case "hydrate": return core.hydrate(request.buffer);
        case "upsert-document": return core.upsertDocument(request.metadata, request.content);
        case "delete-document": return core.deleteDocument(request.path);
        case "upsert-overlay":
            core.upsertOverlay(request.metadata, request.content);
            return null;
        case "delete-overlay":
            core.deleteOverlay(request.path);
            return null;
        case "get-headers": return core.getHeaders();
        case "get-generation": return core.getGeneration();
        case "query-local":
            return core.queryLocal(
                request.basenames,
                request.includeFencedCode,
                request.overlayPaths
            );
        case "query-url":
            return core.queryUrl(
                request.url,
                request.includeFencedCode,
                request.overlayPaths
            );
        case "serialize": return core.serialize();
        case "pause":
        case "resume": return null;
    }
}
