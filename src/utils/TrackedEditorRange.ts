import {
    StateEffect,
    StateField,
    type ChangeSet
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type {
    Editor,
    EditorPosition,
    MarkdownView,
    TFile
} from "obsidian";
import { resolveEditorView } from "./EditorViewResolver";

export type TrackedRangeStatus =
    | "active"
    | "completed"
    | "modified"
    | "detached"
    | "stale";

export interface TrackedEditorRangeOwner {
    readonly view?: MarkdownView | null;
    readonly file?: TFile | null;
}

export interface TrackedEditorRangeSession {
    readonly start: EditorPosition;
    readonly length: number;
    readonly active: boolean;
    readonly inserted: boolean;
    readonly status: TrackedRangeStatus;
    replace(finalText: string): boolean;
    remove(): boolean;
    release(): boolean;
}

interface RangeController {
    readonly id: string;
    readonly editor: Editor;
    readonly editorView: EditorView;
    readonly ownerView: MarkdownView | null;
    readonly ownerFilePath: string | null;
    readonly expected: string;
    status: TrackedRangeStatus;
}

interface TrackedRangeRecord {
    readonly from: number;
    readonly to: number;
    readonly controller: RangeController;
}

interface AddRangeEffect {
    readonly record: TrackedRangeRecord;
}

interface RemoveRangeEffect {
    readonly id: string;
}

const addTrackedRangeEffect = StateEffect.define<AddRangeEffect>();
const removeTrackedRangeEffect = StateEffect.define<RemoveRangeEffect>();

export const trackedEditorRangeField = StateField.define<ReadonlyMap<string, TrackedRangeRecord>>({
    create: () => new Map(),
    update(value, transaction) {
        const removedIds = new Set(
            transaction.effects
                .filter(effect => effect.is(removeTrackedRangeEffect))
                .map(effect => effect.value.id)
        );
        const next = new Map<string, TrackedRangeRecord>();

        for (const [id, record] of value) {
            if (removedIds.has(id)) continue;
            if (transaction.docChanged && overlapsTrackedRange(transaction.changes, record)) {
                record.controller.status = "modified";
                continue;
            }

            const from = transaction.docChanged
                ? transaction.changes.mapPos(record.from, 1)
                : record.from;
            const to = transaction.docChanged
                ? transaction.changes.mapPos(record.to, -1)
                : record.to;
            if (from < 0
                || to < from
                || to > transaction.newDoc.length
                || transaction.newDoc.sliceString(from, to) !== record.controller.expected) {
                record.controller.status = "modified";
                continue;
            }
            next.set(id, { from, to, controller: record.controller });
        }

        for (const effect of transaction.effects) {
            if (!effect.is(addTrackedRangeEffect)) continue;
            const { record } = effect.value;
            if (record.from < 0
                || record.to < record.from
                || record.to > transaction.newDoc.length
                || transaction.newDoc.sliceString(record.from, record.to)
                    !== record.controller.expected) {
                record.controller.status = "stale";
                continue;
            }
            next.set(record.controller.id, record);
        }
        return next;
    }
});

let nextRangeId = 0;

export function createMappedInsertionSession(
    editor: Editor,
    text: string,
    position: EditorPosition,
    owner: TrackedEditorRangeOwner = {}
): TrackedEditorRangeSession | null {
    const editorView = getTrackedEditorView(editor, owner.view);
    if (!editorView) return null;

    const from = editor.posToOffset(position);
    if (from < 0 || from > editorView.state.doc.length) return null;
    editorView.dispatch({ changes: { from, insert: text } });
    const session = createMappedSession(
        editor,
        editorView,
        text,
        from,
        from + text.length,
        owner,
        true
    );
    if (!session) {
        const current = editorView.state.doc.sliceString(from, from + text.length);
        if (current === text) {
            editorView.dispatch({ changes: { from, to: from + text.length } });
        }
        return null;
    }
    editor.setCursor(editor.offsetToPos(from + text.length));
    return session;
}

export function createMappedExistingRangeSession(
    editor: Editor,
    expected: string,
    start: EditorPosition,
    owner: TrackedEditorRangeOwner = {}
): TrackedEditorRangeSession | null {
    const editorView = getTrackedEditorView(editor, owner.view);
    if (!editorView) return null;
    const from = editor.posToOffset(start);
    return createMappedSession(
        editor,
        editorView,
        expected,
        from,
        from + expected.length,
        owner,
        false
    );
}

function createMappedSession(
    editor: Editor,
    editorView: EditorView,
    expected: string,
    from: number,
    to: number,
    owner: TrackedEditorRangeOwner,
    inserted: boolean
): TrackedEditorRangeSession | null {
    const controller: RangeController = {
        id: `image-assistant-range-${++nextRangeId}`,
        editor,
        editorView,
        ownerView: owner.view ?? null,
        ownerFilePath: owner.file?.path ?? owner.view?.file?.path ?? null,
        expected,
        status: "active"
    };
    editorView.dispatch({
        effects: addTrackedRangeEffect.of({
            record: { from, to, controller }
        })
    });
    if (!getRecord(controller)) return null;

    const apply = (replacement: string): boolean => {
        const record = getRecord(controller);
        if (!record || controller.status !== "active") return false;
        if (!isOwnerCurrent(controller)) {
            controller.status = "detached";
            releaseRecord(controller);
            return false;
        }
        if (controller.editorView.state.doc.sliceString(record.from, record.to)
            !== controller.expected) {
            controller.status = "modified";
            releaseRecord(controller);
            return false;
        }

        const cursorOffset = controller.editor.posToOffset(controller.editor.getCursor());
        try {
            controller.editorView.dispatch({
                changes: {
                    from: record.from,
                    to: record.to,
                    insert: replacement
                },
                effects: removeTrackedRangeEffect.of({ id: controller.id })
            });
            controller.status = "completed";
            if (cursorOffset === record.to) {
                controller.editor.setCursor(
                    controller.editor.offsetToPos(record.from + replacement.length)
                );
            }
            return true;
        } catch {
            controller.status = "stale";
            releaseRecord(controller);
            return false;
        }
    };

    return {
        get start(): EditorPosition {
            const record = getRecord(controller);
            return controller.editor.offsetToPos(record?.from ?? from);
        },
        length: expected.length,
        get active(): boolean {
            return controller.status === "active" && !!getRecord(controller);
        },
        inserted,
        get status(): TrackedRangeStatus {
            return controller.status;
        },
        replace: apply,
        remove: () => apply(""),
        release(): boolean {
            if (controller.status !== "active") return false;
            controller.status = "completed";
            releaseRecord(controller);
            return true;
        }
    };
}

function getTrackedEditorView(
    editor: Editor,
    ownerView?: MarkdownView | null
): EditorView | null {
    return resolveEditorView(
        editor,
        ownerView,
        trackedEditorRangeField as StateField<unknown>
    );
}

function getRecord(controller: RangeController): TrackedRangeRecord | null {
    return controller.editorView.state
        .field(trackedEditorRangeField, false)
        ?.get(controller.id) ?? null;
}

function releaseRecord(controller: RangeController): void {
    try {
        controller.editorView.dispatch({
            effects: removeTrackedRangeEffect.of({ id: controller.id })
        });
    } catch {
        // The owning EditorView may already be destroyed.
    }
}

function isOwnerCurrent(controller: RangeController): boolean {
    if (!controller.ownerView) return true;
    if (controller.ownerView.editor !== controller.editor) return false;
    if (controller.ownerView.contentEl
        && !controller.ownerView.contentEl.isConnected) return false;
    if (controller.ownerFilePath
        && controller.ownerView.file?.path !== controller.ownerFilePath) {
        return false;
    }
    const currentEditorView = (controller.ownerView.editor as Editor & {
        cm?: EditorView;
    }).cm;
    return !currentEditorView || currentEditorView === controller.editorView;
}

function overlapsTrackedRange(
    changes: ChangeSet,
    record: TrackedRangeRecord
): boolean {
    let overlaps = false;
    changes.iterChanges((fromA, toA) => {
        if (overlaps) return;
        if (fromA === toA) {
            overlaps = fromA > record.from && fromA < record.to;
            return;
        }
        overlaps = fromA < record.to && toA > record.from;
    });
    return overlaps;
}
