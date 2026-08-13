export type DrawioProtocolSender = (
    target: Window,
    payload: string,
    targetOrigin: string
) => void;

/**
 * Creates a postMessage caller in the iframe owner's JavaScript realm.
 *
 * Draw.io deliberately accepts commands only when MessageEvent.source is its
 * direct parent. In an Obsidian popout, calling postMessage from the main
 * plugin realm makes Chromium identify the main window as the source even
 * though the target iframe belongs to the popout. Creating the tiny caller in
 * ownerWindow preserves the correct parent identity. The payload is always an
 * argument and is never interpolated into executable source.
 */
export function createDrawioProtocolSender(ownerWindow: Window): DrawioProtocolSender {
    if (typeof window !== "undefined" && ownerWindow === window) {
        return (target, payload, targetOrigin) => {
            target.postMessage(payload, targetOrigin);
        };
    }

    let candidate: unknown;
    try {
        const ownerRealmFunction = (ownerWindow as unknown as {
            readonly Function: FunctionConstructor;
        }).Function;
        if (typeof ownerRealmFunction !== "function") {
            throw new Error("the owner window does not expose Function");
        }
        // This constant function body is the narrow realm bridge required for
        // Chromium's MessageEvent.source semantics in Obsidian popout windows.
        candidate = ownerRealmFunction(
            "target",
            "payload",
            "targetOrigin",
            '"use strict"; target.postMessage(payload, targetOrigin);'
        );
    } catch (error) {
        throw new Error(
            `Cannot create the Draw.io sender in the iframe owner window: ${formatError(error)}`
        );
    }

    if (typeof candidate !== "function") {
        throw new Error("Cannot create the Draw.io sender in the iframe owner window.");
    }
    return candidate as DrawioProtocolSender;
}

function formatError(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}
