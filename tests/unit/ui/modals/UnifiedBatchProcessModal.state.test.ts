import { describe, expect, it, vi } from "vitest";
import { UnifiedBatchProcessModal } from "../../../../src/ui/modals/UnifiedBatchProcessModal";
import { fakeTFile, fakeTFolder } from "../../../factories/obsidian";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}

function task(id: string) {
    return { id, name: id, path: id, source: id, selected: true, status: 'pending' as const };
}

function mode(id: string, loadTasks: () => Promise<any[]>, processTask = vi.fn(async (item: any) => ({
    status: "success",
    success: true,
    item: item.source,
}))) {
    return {
        id,
        renderSettings: vi.fn(),
        loadTasks,
        processTask,
        getReviewActions: vi.fn(() => []),
        handleReviewAction: vi.fn(async () => undefined),
        disposeItemResult: vi.fn(),
    } as any;
}

function createModal(initialMode: any, additionalModes: any[] = []) {
    const app = {} as any;
    const plugin = { settings: { global: { batchConcurrency: 1 } } } as any;
    const modal = new UnifiedBatchProcessModal(app, plugin, "vault", null, "local_process");
    const modes = new Map<string, any>([
        [initialMode.id, initialMode] as const,
        ...additionalModes.map(item => [item.id, item] as const)
    ]);
    (modal as any).modeMap = modes;
    (modal as any).currentMode = initialMode;
    modal.onOpen();
    return modal;
}

describe("UnifiedBatchProcessModal state machine", () => {
    it.each([
        ["note", fakeTFile({ path: "note.md" })],
        ["folder", fakeTFolder({ path: "images" })],
        ["vault", null]
    ] as const)("constructs all three modes for %s scope", (scope, target) => {
        for (const initialMode of ["local_process", "upload", "download"] as const) {
            const modal = new UnifiedBatchProcessModal(
                {} as any,
                { settings: { global: { batchConcurrency: 1 } } } as any,
                scope,
                target as any,
                initialMode
            );
            expect([...(modal as any).modeMap.keys()]).toEqual(["local_process", "upload", "download"]);
            expect((modal as any).currentMode.id).toBe(initialMode);
        }
    });
    it("ignores a stale task load after switching modes", async () => {
        const stale = deferred<any[]>();
        const firstMode = mode("local_process", () => stale.promise);
        const secondMode = mode("upload", async () => [task("upload-task")]);
        const modal = createModal(firstMode, [secondMode]);

        expect(await (modal as any).switchMode("upload")).toBe(true);
        expect((modal as any).currentMode).toBe(secondMode);
        stale.resolve([task("stale-local-task")]);
        await Promise.resolve();

        expect((modal as any).tasks.map((item: any) => item.id)).toEqual(["upload-task"]);
        expect((modal as any).state).toBe("ready");
    });

    it("does not report an older mode switch as successful after a newer switch wins", async () => {
        const firstMode = mode("local_process", async () => []);
        const slowUpload = deferred<any[]>();
        const uploadMode = mode("upload", () => slowUpload.promise);
        const downloadMode = mode("download", async () => [task("download-task")]);
        const modal = createModal(firstMode, [uploadMode, downloadMode]);
        await Promise.resolve();
        await Promise.resolve();

        const staleSwitch = (modal as any).switchMode("upload");
        const currentSwitch = (modal as any).switchMode("download");

        await expect(currentSwitch).resolves.toBe(true);
        slowUpload.resolve([task("upload-task")]);
        await expect(staleSwitch).resolves.toBe(false);
        expect((modal as any).currentMode).toBe(downloadMode);
        expect((modal as any).tasks.map((item: any) => item.id)).toEqual(["download-task"]);
    });

    it("ignores duplicate start requests while a batch is running", async () => {
        const pending = deferred<any>();
        const processTask = vi.fn(() => pending.promise);
        const currentMode = mode("local_process", async () => [task("one")], processTask);
        const modal = createModal(currentMode);
        await Promise.resolve();
        await Promise.resolve();

        const firstRun = (modal as any).executeBatch();
        const duplicateRun = (modal as any).executeBatch();
        expect(processTask).toHaveBeenCalledOnce();

        pending.resolve({ status: "success", success: true, item: "one" });
        await Promise.all([firstRun, duplicateRun]);
        expect((modal as any).state).toBe("review");
    });

    it("locks mode and settings controls for the whole run and review", async () => {
        const pending = deferred<any>();
        const currentMode = mode("local_process", async () => [task("one")], vi.fn(() => pending.promise));
        const modal = createModal(currentMode);
        await Promise.resolve();
        await Promise.resolve();
        const sidebarControls = () => Array.from(
            modal.contentEl.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(
                ".batch-sidebar button, .batch-sidebar input, .batch-sidebar select"
            )
        );

        const run = (modal as any).executeBatch();
        expect(sidebarControls().length).toBeGreaterThan(0);
        expect(sidebarControls().every(control => control.disabled)).toBe(true);

        pending.resolve({ status: "success", success: true, item: "one" });
        await run;

        expect((modal as any).state).toBe("review");
        expect(sidebarControls().every(control => control.disabled)).toBe(true);
    });

    it("stops scheduling tasks after the modal closes", async () => {
        const pending = deferred<any>();
        const processTask = vi.fn()
            .mockImplementationOnce(() => pending.promise)
            .mockResolvedValue({ status: "success", success: true, item: "two" });
        const currentMode = mode("local_process", async () => [task("one"), task("two")], processTask);
        const modal = createModal(currentMode);
        await Promise.resolve();
        await Promise.resolve();

        const run = (modal as any).executeBatch();
        modal.onClose();
        pending.resolve({ status: "success", success: true, item: "one" });
        await run;

        expect(processTask).toHaveBeenCalledOnce();
        expect((modal as any).state).toBe("closed");
        expect(currentMode.disposeItemResult).toHaveBeenCalledWith(
            expect.objectContaining({ item: "one", success: true })
        );
    });

    it("releases completed item resources when a review is closed", async () => {
        const currentMode = mode("download", async () => [task("one")]);
        const modal = createModal(currentMode);
        await Promise.resolve();
        await Promise.resolve();

        await (modal as any).executeBatch();
        modal.onClose();

        expect(currentMode.disposeItemResult).toHaveBeenCalledOnce();
        expect(currentMode.disposeItemResult).toHaveBeenCalledWith(
            expect.objectContaining({ item: "one", success: true })
        );
    });

    it("does not let a closed execution resume after the same modal instance reopens", async () => {
        const pending = deferred<any>();
        const processTask = vi.fn()
            .mockImplementationOnce(() => pending.promise)
            .mockResolvedValue({ status: "success", success: true, item: "two" });
        const currentMode = mode("local_process", async () => [task("one"), task("two")], processTask);
        const modal = createModal(currentMode);
        await Promise.resolve();
        await Promise.resolve();

        const staleRun = (modal as any).executeBatch();
        modal.onClose();
        modal.onOpen();
        await Promise.resolve();
        await Promise.resolve();
        pending.resolve({ status: "success", success: true, item: "one" });
        await staleRun;

        expect(processTask).toHaveBeenCalledOnce();
        expect((modal as any).state).toBe("ready");
        expect((modal as any).tasks.map((item: any) => item.id)).toEqual(["one", "two"]);
    });

    it("does not let a stale review action close a reopened modal", async () => {
        const action = deferred<boolean>();
        const currentMode = mode("local_process", async () => [task("one")]);
        currentMode.getReviewActions.mockReturnValue([
            { id: "done", label: "Done", style: "primary" }
        ]);
        currentMode.handleReviewAction.mockImplementation(() => action.promise);
        const modal = createModal(currentMode);
        await Promise.resolve();
        await Promise.resolve();
        const renderSpy = vi.spyOn((modal as any).reviewRenderer, "render");
        const closeSpy = vi.spyOn(modal, "close");

        await (modal as any).executeBatch();
        const onAction = renderSpy.mock.calls[0][3] as (actionId: string) => Promise<void>;
        const staleAction = onAction("done");
        modal.onClose();
        modal.onOpen();
        await Promise.resolve();
        await Promise.resolve();
        action.resolve(true);
        await staleAction;

        expect(closeSpy).not.toHaveBeenCalled();
        expect((modal as any).state).toBe("ready");
    });

    it("keeps the review window open when a destructive action is rejected", async () => {
        const currentMode = mode("local_process", async () => [task("one")]);
        currentMode.getReviewActions.mockReturnValue([
            { id: "replace_delete", label: "Replace and delete", style: "danger" }
        ]);
        currentMode.handleReviewAction.mockResolvedValue(false);
        const modal = createModal(currentMode);
        await Promise.resolve();
        await Promise.resolve();
        const renderSpy = vi.spyOn((modal as any).reviewRenderer, "render");

        await (modal as any).executeBatch();
        const onAction = renderSpy.mock.calls[0][3] as (action: string) => Promise<void>;
        await onAction("replace_delete");

        expect((modal as any).state).toBe("review");
    });
});
