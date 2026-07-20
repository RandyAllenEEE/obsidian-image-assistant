import {
    Editor,
    EditorPosition,
    type MarkdownView,
    type TFile
} from "obsidian";
import {
    createMappedExistingRangeSession,
    createMappedInsertionSession,
    type TrackedEditorRangeOwner,
    type TrackedEditorRangeSession,
    type TrackedRangeStatus
} from "./TrackedEditorRange";

export interface PlaceholderSession extends TrackedEditorRangeSession {}

interface SessionState {
    start: EditorPosition;
    readonly text: string;
    active: boolean;
    inserted: boolean;
    status: TrackedRangeStatus;
}

const activeSessions = new WeakMap<Editor, Set<SessionState>>();

function clonePosition(position: EditorPosition): EditorPosition {
    return { line: position.line, ch: position.ch };
}

function positionsEqual(left: EditorPosition, right: EditorPosition): boolean {
    return left.line === right.line && left.ch === right.ch;
}

function advancePosition(start: EditorPosition, text: string): EditorPosition {
    const lines = text.split("\n");
    if (lines.length === 1) {
        return { line: start.line, ch: start.ch + text.length };
    }

    return {
        line: start.line + lines.length - 1,
        ch: lines[lines.length - 1].length,
    };
}

function positionToOffset(editor: Editor, position: EditorPosition): number {
    if (typeof editor.posToOffset === "function") {
        return editor.posToOffset(position);
    }

    let offset = position.ch;
    for (let line = 0; line < position.line; line++) {
        offset += editor.getLine(line).length + 1;
    }
    return offset;
}

function offsetToPosition(editor: Editor, offset: number): EditorPosition {
    if (typeof editor.offsetToPos === "function") {
        return editor.offsetToPos(offset);
    }

    let remaining = Math.max(0, offset);
    for (let line = 0; line < editor.lineCount(); line++) {
        const lineLength = editor.getLine(line).length;
        if (remaining <= lineLength) return { line, ch: remaining };
        remaining -= lineLength + 1;
    }

    const lastLine = Math.max(0, editor.lineCount() - 1);
    return { line: lastLine, ch: editor.getLine(lastLine).length };
}

function isPositionValid(editor: Editor, position: EditorPosition, label: string): boolean {
    if (position.line < 0 || position.line >= editor.lineCount()) {
        console.warn(`EditorReplacement: ${label} line no longer exists. Aborting replacement.`);
        return false;
    }

    const currentLineLength = editor.getLine(position.line).length;
    if (position.ch < 0 || position.ch > currentLineLength) {
        console.warn(`EditorReplacement: ${label} column out of bounds. Aborting replacement.`);
        return false;
    }

    return true;
}

export function createPlaceholderSession(
    editor: Editor,
    text: string,
    position?: EditorPosition,
    owner: TrackedEditorRangeOwner = {}
): PlaceholderSession {
    const start = clonePosition(position ?? editor.getCursor());
    const mapped = createMappedInsertionSession(editor, text, start, owner);
    if (mapped) return mapped;
    return createFallbackSession(editor, text, start, true);
}

export function createTrackedRangeSession(
    editor: Editor,
    text: string,
    position: EditorPosition,
    owner: {
        readonly view?: MarkdownView | null;
        readonly file?: TFile | null;
    } = {}
): TrackedEditorRangeSession {
    return createMappedExistingRangeSession(editor, text, position, owner)
        ?? createFallbackSession(editor, text, position, false);
}

function createFallbackSession(
    editor: Editor,
    text: string,
    position: EditorPosition,
    insert: boolean
): PlaceholderSession {
    const state: SessionState = {
        start: clonePosition(position),
        text,
        active: false,
        inserted: false,
        status: "active",
    };

    const invalidate = (status: TrackedRangeStatus = "stale"): false => {
        state.active = false;
        state.status = status;
        activeSessions.get(editor)?.delete(state);
        return false;
    };

    const getEnd = (): EditorPosition => advancePosition(state.start, state.text);

    const apply = (replacement: string): boolean => {
        if (!state.active || !isPositionValid(editor, state.start, "Placeholder start")) return invalidate();

        const end = getEnd();
        if (!isPositionValid(editor, end, "Placeholder end")) return invalidate();
        if (typeof editor.getRange === "function" && editor.getRange(state.start, end) !== state.text) {
            console.warn("EditorReplacement: Placeholder content changed. Aborting replacement.");
            return invalidate("modified");
        }

        const startOffset = positionToOffset(editor, state.start);
        const endOffset = startOffset + state.text.length;
        const shouldFollowReplacement = positionsEqual(editor.getCursor(), end);
        const sessions = activeSessions.get(editor);
        const otherOffsets = new Map<SessionState, number>();
        sessions?.forEach((session) => {
            if (session !== state && session.active) {
                otherOffsets.set(session, positionToOffset(editor, session.start));
            }
        });

        editor.replaceRange(replacement, state.start, end);

        const delta = replacement.length - state.text.length;
        otherOffsets.forEach((offset, session) => {
            if (offset >= endOffset) {
                session.start = clonePosition(offsetToPosition(editor, offset + delta));
            } else if (offset > startOffset) {
                session.active = false;
                sessions?.delete(session);
            }
        });

        state.active = false;
        state.status = "completed";
        sessions?.delete(state);
        if (shouldFollowReplacement) {
            editor.setCursor(advancePosition(state.start, replacement));
        }
        return true;
    };

    if (isPositionValid(editor, state.start, "Cursor")) {
        if (insert) {
            editor.replaceRange(text, state.start);
            state.inserted = true;
        } else {
            const end = getEnd();
            if (!isPositionValid(editor, end, "Tracked range end")
                || (typeof editor.getRange === "function"
                    && editor.getRange(state.start, end) !== text)) {
                state.status = "stale";
                return createInactiveFallbackSession(state);
            }
        }
        state.active = true;
        let sessions = activeSessions.get(editor);
        if (!sessions) {
            sessions = new Set<SessionState>();
            activeSessions.set(editor, sessions);
        }
        sessions.add(state);
        if (insert) editor.setCursor(getEnd());
    }

    return {
        get start(): EditorPosition {
            return clonePosition(state.start);
        },
        length: text.length,
        get active(): boolean {
            return state.active;
        },
        get inserted(): boolean {
            return insert && state.inserted;
        },
        get status(): TrackedRangeStatus {
            return state.status;
        },
        replace(finalText: string): boolean {
            return apply(finalText);
        },
        remove(): boolean {
            return apply("");
        },
        release(): boolean {
            if (!state.active) return false;
            state.active = false;
            state.status = "completed";
            activeSessions.get(editor)?.delete(state);
            return true;
        },
    };
}

function createInactiveFallbackSession(
    state: SessionState
): PlaceholderSession {
    return {
        get start(): EditorPosition {
            return clonePosition(state.start);
        },
        length: state.text.length,
        active: false,
        inserted: false,
        get status(): TrackedRangeStatus {
            return state.status;
        },
        replace: () => false,
        remove: () => false,
        release: () => false
    };
}
