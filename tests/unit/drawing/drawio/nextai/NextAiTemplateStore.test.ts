import { NextAiTemplateStore } from "../../../../../src/drawing/drawio/nextai/NextAiTemplateStore";
import { DEFAULT_SETTINGS } from "../../../../../src/settings/defaults";

describe("NextAiTemplateStore", () => {
    it("migrates legacy settings to the sidecar and retains template metadata", async () => {
        const files = new Map<string, string>();
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.drawing.drawio.nextAi.promptTemplates = [{
            id: "legacy",
            title: "Legacy",
            description: "Migrated",
            body: "Draw a flowchart",
            pinned: true,
            createdAt: 10,
            updatedAt: 20,
            useCount: 2
        }];
        const plugin = {
            manifest: { dir: ".obsidian/plugins/image-assistant" },
            settings,
            saveSettings: vi.fn(async () => undefined),
            app: { vault: { adapter: makeAdapter(files) } }
        } as any;
        const store = new NextAiTemplateStore(plugin);

        expect(await store.list()).toMatchObject([{
            id: "legacy",
            title: "Legacy",
            pinned: true,
            useCount: 2
        }]);
        expect(settings.drawing.drawio.nextAi.promptTemplates).toEqual([]);
        expect(plugin.saveSettings).toHaveBeenCalledOnce();

        await store.recordUse("legacy");
        expect((await store.list())[0].useCount).toBe(3);
        expect(files.has(".obsidian/plugins/image-assistant/next-ai-templates.json")).toBe(true);
    });

    it("imports both document and array JSON while rejecting empty input", async () => {
        const files = new Map<string, string>();
        const plugin = {
            manifest: { dir: ".obsidian/plugins/image-assistant" },
            settings: structuredClone(DEFAULT_SETTINGS),
            saveSettings: vi.fn(async () => undefined),
            app: { vault: { adapter: makeAdapter(files) } }
        } as any;
        const store = new NextAiTemplateStore(plugin);
        const count = await store.importJson(JSON.stringify([{ id: "one", name: "One", prompt: "Body" }]));
        expect(count).toBe(1);
        expect((await store.list())[0]).toMatchObject({ title: "One", body: "Body" });
        await expect(store.importJson("[]")).rejects.toThrow(/No valid/);
    });
});

function makeAdapter(files: Map<string, string>) {
    return {
        exists: vi.fn(async (path: string) => files.has(path)),
        read: vi.fn(async (path: string) => files.get(path) ?? ""),
        write: vi.fn(async (path: string, value: string) => { files.set(path, value); }),
        rename: vi.fn(async (from: string, to: string) => {
            const value = files.get(from);
            if (value === undefined) throw new Error("missing");
            files.delete(from);
            files.set(to, value);
        }),
        remove: vi.fn(async (path: string) => { files.delete(path); })
    };
}
