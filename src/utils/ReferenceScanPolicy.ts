export interface ReferenceSafetyScanPolicy {
    readonly kind: "safety";
    readonly includeFencedCode: true;
}

export interface ReferenceMutationScanPolicy {
    readonly kind: "mutation";
    readonly includeFencedCode: boolean;
}

export const REFERENCE_SAFETY_SCAN_POLICY: ReferenceSafetyScanPolicy =
    Object.freeze({
        kind: "safety",
        includeFencedCode: true
    });

export function createReferenceMutationScanPolicy(
    includeFencedCode: boolean
): ReferenceMutationScanPolicy {
    return Object.freeze({
        kind: "mutation",
        includeFencedCode
    });
}
