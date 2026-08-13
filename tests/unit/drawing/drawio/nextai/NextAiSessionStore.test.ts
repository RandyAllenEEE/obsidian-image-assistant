import type { UIMessage } from "ai";
import { NextAiSessionStore } from "../../../../../src/drawing/drawio/nextai/NextAiSessionStore";

describe("NextAiSessionStore", () => {
    it("writes v2 atomically, deduplicates attachment data, and hydrates it on read", async () => {
        const adapter = new MemoryAdapter();
        const plugin = makePlugin(adapter);
        const dataUrl = "data:image/png;base64,AA==";
        const message: UIMessage = {
            id: "user-1",
            role: "user",
            parts: [
                { type: "text", text: "draw" },
                { type: "file", mediaType: "image/png", filename: "same.png", url: dataUrl }
            ]
        };
        const store = new NextAiSessionStore(plugin as never);
        await store.save({
            id: "session-1",
            filePath: "Drawing.drawio.svg",
            title: "Draw",
            updatedAt: 10,
            messages: [message],
            userPresentation: {
                "user-1": {
                    text: "draw",
                    attachments: [{
                        name: "same.png",
                        kind: "image",
                        mediaType: "image/png",
                        size: 1,
                        dataUrl
                    }]
                }
            },
            previousXml: "<mxfile/>",
            lastUserText: "draw",
            diagramXml: "<mxfile/>",
            userXmlSnapshots: { "user-1": "<mxfile/>" },
            diagramHistory: [{
                id: "history-1",
                createdAt: 9,
                label: "draw",
                xml: "<mxfile/>",
                previewSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>'
            }],
            thumbnailDataUrl: "data:image/png;base64,AQ=="
        });

        const raw = adapter.files.get(".obsidian/plugins/image-assistant/next-ai-sessions.json")!;
        expect(JSON.parse(raw)).toMatchObject({ version: 2 });
        expect(raw.match(/data:image\/png;base64,AA==/g)).toHaveLength(1);
        expect(adapter.files.has(".obsidian/plugins/image-assistant/next-ai-sessions.json.tmp")).toBe(false);

        const restored = await new NextAiSessionStore(plugin as never).get("session-1");
        expect(restored?.messages[0].parts[1]).toMatchObject({ type: "file", url: dataUrl });
        expect(restored?.userPresentation["user-1"].attachments[0].dataUrl).toBe(dataUrl);
        expect(restored?.userXmlSnapshots["user-1"]).toBe("<mxfile/>");
        expect(restored?.thumbnailDataUrl).toBe("data:image/png;base64,AQ==");
        expect(restored?.diagramHistory[0].previewSvg).toContain("<svg");
    });

    it("loads legacy v1 records and tolerates a malformed sibling record", async () => {
        const adapter = new MemoryAdapter();
        adapter.files.set(".obsidian/plugins/image-assistant/next-ai-sessions.json", JSON.stringify({
            version: 1,
            sessions: [{
                id: "legacy",
                filePath: "Legacy.drawio.svg",
                title: "Legacy",
                updatedAt: 1,
                messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "hello" }] }],
                userPresentation: {},
                previousXml: "",
                lastUserText: "hello",
                diagramXml: "<mxfile/>"
            }, { broken: true }]
        }));

        const sessions = await new NextAiSessionStore(makePlugin(adapter) as never).list();
        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({ id: "legacy", userXmlSnapshots: {} });
    });
});

class MemoryAdapter {
    readonly files = new Map<string, string>();

    async exists(path: string): Promise<boolean> {
        return this.files.has(path);
    }

    async read(path: string): Promise<string> {
        const value = this.files.get(path);
        if (value === undefined) throw new Error("missing");
        return value;
    }

    async write(path: string, value: string): Promise<void> {
        this.files.set(path, value);
    }

    async remove(path: string): Promise<void> {
        this.files.delete(path);
    }

    async rename(from: string, to: string): Promise<void> {
        const value = await this.read(from);
        this.files.set(to, value);
        this.files.delete(from);
    }
}

function makePlugin(adapter: MemoryAdapter): object {
    return {
        manifest: { dir: ".obsidian/plugins/image-assistant" },
        app: { vault: { adapter } }
    };
}
