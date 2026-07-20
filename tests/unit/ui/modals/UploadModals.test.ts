import { describe, expect, it, vi } from "vitest";
import type {
    ReferenceInventory,
    ReferenceWorkflowDecisionAction
} from "../../../../src/utils/ImageReferenceWorkflowCoordinator";
import { ImageReferenceDecisionModal } from "../../../../src/ui/modals/ImageReferenceDecisionModal";
import { UploadErrorDialog } from "../../../../src/ui/modals/UploadModals";
import { fakeTFile } from "../../../factories/obsidian";

function makeInventory(overrides: Partial<ReferenceInventory> = {}): ReferenceInventory {
    const source = { kind: "local" as const, file: fakeTFile({ path: "assets/image.png" }) };
    return {
        source,
        safety: {
            complete: true,
            markdown: [],
            canvas: [],
            uncertainFiles: [],
            referenceCount: 3,
            safeToDelete: false
        },
        mutableMarkdown: [],
        mutableCanvas: [],
        mutableComplete: true,
        uncertainFiles: [],
        totalReferences: 3,
        mutableReferences: 2,
        protectedFencedReferences: 1,
        outOfBoundaryReferences: 0,
        markdownReferences: 2,
        canvasReferences: 1,
        sourceDeletable: true,
        canDeleteAfterAll: false,
        signature: "inventory",
        ...overrides
    };
}

describe("upload and reference workflow modals", () => {
    it("reports retry and close-as-cancel exactly once for upload errors", () => {
        const onChoice = vi.fn();
        const retry = new UploadErrorDialog({} as any, "image.png", "offline", onChoice);
        retry.onOpen();
        retry.contentEl.querySelectorAll<HTMLButtonElement>("button")[0].click();

        const closed = new UploadErrorDialog({} as any, "image.png", "offline", onChoice);
        closed.onOpen();
        closed.onClose();
        closed.onClose();

        expect(onChoice.mock.calls.map(call => call[0])).toEqual(["retry", "cancel"]);
    });

    it("renders structured inventory without interpreting reference source as HTML", () => {
        const maliciousPath = "notes/<img src=x onerror=alert(1)>.md";
        const inventory = makeInventory({
            uncertainFiles: [maliciousPath],
            safety: {
                complete: false,
                markdown: [],
                canvas: [],
                uncertainFiles: [maliciousPath],
                referenceCount: 3,
                safeToDelete: false
            }
        });
        const modal = new ImageReferenceDecisionModal({} as any, {
            operation: "delete",
            inventory,
            sourceLabel: "assets/image.png",
            allowedActions: new Set(["clicked-keep-source", "cancel"]),
            onDecision: vi.fn()
        });

        modal.onOpen();

        expect(modal.contentEl.textContent).toContain("3 total");
        expect(modal.contentEl.textContent).toContain("fenced-code protected: 1");
        expect(modal.contentEl.textContent).toContain(maliciousPath);
        expect(modal.contentEl.querySelector("img")).toBeNull();
    });

    it("reports document-boundary references separately from fenced-code protection", () => {
        const modal = new ImageReferenceDecisionModal({} as any, {
            operation: "upload",
            inventory: makeInventory({
                protectedFencedReferences: 0,
                outOfBoundaryReferences: 1
            }),
            sourceLabel: "assets/image.png",
            destinationLabel: "https://cdn.example/image.png",
            allowedActions: new Set(["all-keep-source", "cancel"]),
            onDecision: vi.fn()
        });

        modal.onOpen();

        expect(modal.contentEl.textContent).toContain("fenced-code protected: 0");
        expect(modal.contentEl.textContent).toContain("outside this scope: 1");
        expect(modal.contentEl.textContent).toContain(
            "outside this operation's document scope"
        );
        expect(modal.contentEl.textContent).not.toContain(
            "protected by the fenced-code setting"
        );
    });

    it("reports every authorized generic action with separate scope and source semantics", async () => {
        const actions: ReferenceWorkflowDecisionAction[] = [
            "clicked-keep-source",
            "all-keep-source",
            "all-delete-source",
            "delete-source-only",
            "keep-transfer",
            "cancel"
        ];
        const decisions: unknown[] = [];

        for (let index = 0; index < actions.length; index++) {
            const modal = new ImageReferenceDecisionModal({} as any, {
                operation: "upload",
                inventory: makeInventory(),
                sourceLabel: "assets/image.png",
                destinationLabel: "https://cdn.example/image.png",
                allowedActions: new Set(actions),
                onDecision: decision => {
                    decisions.push(decision);
                }
            });
            modal.onOpen();
            modal.contentEl.querySelectorAll<HTMLButtonElement>("button")[index].click();
            await vi.waitFor(() => expect(decisions).toHaveLength(index + 1));
        }

        expect(decisions).toEqual([
            { action: "clicked-keep-source", scope: "clicked", deleteSource: false },
            { action: "all-keep-source", scope: "all", deleteSource: false },
            { action: "all-delete-source", scope: "all", deleteSource: true },
            { action: "delete-source-only", scope: "none", deleteSource: true },
            { action: "keep-transfer", scope: "none", deleteSource: false },
            { action: "cancel", scope: "none", deleteSource: false }
        ]);
    });

    it("disables all controls and ignores repeated clicks while an action is pending", async () => {
        let resolve!: () => void;
        const onDecision = vi.fn(() => new Promise<void>(done => {
            resolve = done;
        }));
        const modal = new ImageReferenceDecisionModal({} as any, {
            operation: "download",
            inventory: makeInventory(),
            sourceLabel: "https://cdn.example/image.png",
            destinationLabel: "assets/image.png",
            allowedActions: new Set(["clicked-keep-source", "cancel"]),
            onDecision
        });
        modal.onOpen();
        const buttons = modal.contentEl.querySelectorAll<HTMLButtonElement>("button");

        buttons[0].click();
        buttons[0].click();

        expect(onDecision).toHaveBeenCalledOnce();
        expect([...buttons].every(button => button.disabled)).toBe(true);
        resolve();
        await Promise.resolve();
    });

    it("treats closing the decision modal as cancel once", () => {
        const onDecision = vi.fn();
        const modal = new ImageReferenceDecisionModal({} as any, {
            operation: "delete",
            inventory: makeInventory(),
            sourceLabel: "assets/image.png",
            allowedActions: new Set(["cancel"]),
            onDecision
        });
        modal.onOpen();

        modal.onClose();
        modal.onClose();

        expect(onDecision).toHaveBeenCalledOnce();
        expect(onDecision).toHaveBeenCalledWith({
            action: "cancel",
            scope: "none",
            deleteSource: false
        });
    });
});
