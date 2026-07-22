import type {
    ReferenceIndexDocumentHeader,
    ReferenceIndexCandidateQueryResult
} from "./ReferenceIndexWorkerCore";
import type { ReferenceIndexDocumentMetadata } from "./ReferenceIndexDocument";

export type ReferenceIndexWorkerRequest =
    | { readonly id: number; readonly type: "hydrate"; readonly buffer: ArrayBuffer }
    | {
        readonly id: number;
        readonly type: "upsert-document";
        readonly metadata: ReferenceIndexDocumentMetadata;
        readonly content: string;
    }
    | { readonly id: number; readonly type: "delete-document"; readonly path: string }
    | {
        readonly id: number;
        readonly type: "upsert-overlay";
        readonly metadata: ReferenceIndexDocumentMetadata;
        readonly content: string;
    }
    | { readonly id: number; readonly type: "delete-overlay"; readonly path: string }
    | { readonly id: number; readonly type: "get-headers" }
    | { readonly id: number; readonly type: "get-generation" }
    | {
        readonly id: number;
        readonly type: "query-local";
        readonly basenames: readonly string[];
        readonly includeFencedCode: boolean;
        readonly overlayPaths: readonly string[];
    }
    | {
        readonly id: number;
        readonly type: "query-url";
        readonly url: string;
        readonly includeFencedCode: boolean;
        readonly overlayPaths: readonly string[];
    }
    | { readonly id: number; readonly type: "serialize" }
    | { readonly id: number; readonly type: "pause" }
    | { readonly id: number; readonly type: "resume" };

export type ReferenceIndexWorkerResult =
    | {
        readonly accepted: boolean;
        readonly generation: number;
        readonly headers: readonly ReferenceIndexDocumentHeader[];
    }
    | ReferenceIndexDocumentHeader
    | readonly ReferenceIndexDocumentHeader[]
    | Record<string, ReferenceIndexCandidateQueryResult>
    | ReferenceIndexCandidateQueryResult
    | ArrayBuffer
    | number
    | boolean
    | null;

export type ReferenceIndexWorkerResponse =
    | {
        readonly id: number;
        readonly ok: true;
        readonly result: ReferenceIndexWorkerResult;
    }
    | {
        readonly id: number;
        readonly ok: false;
        readonly error: string;
    };
