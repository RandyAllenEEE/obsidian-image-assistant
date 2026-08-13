import type { UIMessage } from "ai";
import { DEFAULT_SETTINGS } from "../../../../../src/settings/defaults";

const aiMocks = vi.hoisted(() => ({
    responses: [] as Array<UIMessage | AsyncIterable<UIMessage>>
}));

vi.mock("ai", async importOriginal => {
    const actual = await importOriginal<typeof import("ai")>();
    return {
        ...actual,
        DefaultChatTransport: class {
            async sendMessages(): Promise<AsyncIterable<UIMessage>> {
                const response = aiMocks.responses.shift();
                if (!response) throw new Error("No fake Next AI response was queued.");
                if (Symbol.asyncIterator in response) return response;
                return (async function* () { yield structuredClone(response); })();
            }
        },
        readUIMessageStream: ({ stream }: { stream: AsyncIterable<UIMessage> }) => stream
    };
});

import { NextAiSession } from "../../../../../src/drawing/drawio/nextai/NextAiSession";
import { NextAiHttpClient } from "../../../../../src/drawing/drawio/nextai/NextAiHttpClient";

const vertex = (value: string) =>
    `<mxCell id="2" value="${value}" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>`;

describe("NextAiSession", () => {
    it("edits only the active page and confirms the applied revision before tool success", async () => {
        const host = makeHost(multiPageXml(), 1);
        const session = new NextAiSession(makePlugin(false) as never, host as never, makeStore() as never);
        aiMocks.responses.push(
            toolMessage("edit_diagram", "tool-1", {
                operations: [{ operation: "update", cell_id: "2", new_xml: vertex("updated") }]
            }),
            textMessage("done")
        );

        await session.send({ text: "Update details", attachments: [] });

        expect(host.xml).toContain('<diagram id="first" name="Overview"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="first"');
        expect(host.xml).toContain('id="2" value="updated"');
        expect(host.ensureRevisionSaved).toHaveBeenCalledWith(1);
        session.destroy();
    });

    it("returns a structured result for an unknown client tool without executing it", async () => {
        const host = makeHost(singlePageXml(), 0);
        const session = new NextAiSession(makePlugin(false) as never, host as never, makeStore() as never);
        let latest: any;
        session.subscribe(snapshot => { latest = snapshot; });
        aiMocks.responses.push(
            toolMessage("future_client_tool", "future-1", { value: true }),
            textMessage("fallback")
        );

        await session.send({ text: "Use future tool", attachments: [] });

        const tool = latest.messages
            .flatMap((message: UIMessage) => message.parts)
            .find((part: any) => part.toolCallId === "future-1");
        expect(tool).toMatchObject({
            state: "output-available",
            output: { ok: false, code: "unsupported-client-tool", toolName: "future_client_tool" }
        });
        expect(host.applyDiagramXml).not.toHaveBeenCalled();
        session.destroy();
    });

    it("accepts a saved result with warnings after three VLM improvement retries", async () => {
        const host = makeHost(singlePageXml(), 0);
        const session = new NextAiSession(makePlugin(true) as never, host as never, makeStore() as never);
        let latest: any;
        session.subscribe(snapshot => { latest = snapshot; });
        for (let attempt = 0; attempt < 4; attempt++) {
            aiMocks.responses.push(toolMessage("edit_diagram", `vlm-${attempt}`, {
                operations: [{
                    operation: "update",
                    cell_id: "2",
                    new_xml: vertex(`attempt-${attempt}`)
                }]
            }));
        }
        vi.spyOn(NextAiHttpClient.prototype, "validateDiagram").mockResolvedValue({
            valid: false,
            issues: ["Overlap"],
            suggestions: ["Add spacing"],
            verification: "performed",
            source: "user-model"
        });

        await session.send({ text: "Improve layout", attachments: [] });

        expect(host.ensureRevisionSaved).toHaveBeenCalledTimes(4);
        expect(latest.status).toBe("ready");
        expect(latest.validation).toMatchObject({
            status: "accepted-with-issues",
            issues: ["Overlap"],
            suggestions: ["Add spacing"]
        });
        expect(latest.error).toBe("");
        session.destroy();
    });

    it("labels an empty Next AI server result as reported rather than verified", async () => {
        const host = makeHost(singlePageXml(), 0);
        const plugin = makePlugin(false) as any;
        plugin.settings.drawing.drawio.nextAi.visualValidationMode = "next-ai-server";
        const session = new NextAiSession(plugin, host as never, makeStore() as never);
        let latest: any;
        session.subscribe(snapshot => { latest = snapshot; });
        aiMocks.responses.push(
            toolMessage("edit_diagram", "server-vlm", {
                operations: [{ operation: "update", cell_id: "2", new_xml: vertex("updated") }]
            }),
            textMessage("done")
        );
        vi.spyOn(NextAiHttpClient.prototype, "validateDiagram").mockResolvedValue({
            valid: true,
            issues: [],
            suggestions: [],
            verification: "server-reported",
            source: "next-ai-server"
        });

        await session.send({ text: "Improve layout", attachments: [] });

        expect(latest.validation.status).toBe("server-reported");
        expect(latest.validation.message).toContain("does not indicate whether a vision model actually ran");
        expect(latest.status).toBe("ready");
        session.destroy();
    });

    it("restores the user message XML snapshot before retrying the answer", async () => {
        const initial = singlePageXml();
        const host = makeHost(initial, 0);
        const session = new NextAiSession(makePlugin(false) as never, host as never, makeStore() as never);
        aiMocks.responses.push(
            toolMessage("edit_diagram", "first", {
                operations: [{ operation: "update", cell_id: "2", new_xml: vertex("first-result") }]
            }),
            textMessage("first done")
        );
        await session.send({ text: "Change it", attachments: [] });
        expect(host.xml).toContain('value="first-result"');

        aiMocks.responses.push(
            toolMessage("edit_diagram", "retry", {
                operations: [{ operation: "update", cell_id: "2", new_xml: vertex("retry-result") }]
            }),
            textMessage("retry done")
        );
        await session.retry();

        expect(host.applyDiagramXml.mock.calls[1][0]).toBe(initial);
        expect(host.xml).toContain('value="retry-result"');
        expect(host.xml).not.toContain("first-result");
        session.destroy();
    });

    it("ignores a tool call that arrives after Stop", async () => {
        const host = makeHost(singlePageXml(), 0);
        const session = new NextAiSession(makePlugin(false) as never, host as never, makeStore() as never);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        aiMocks.responses.push((async function* () {
            await gate;
            yield toolMessage("edit_diagram", "late", {
                operations: [{ operation: "update", cell_id: "2", new_xml: vertex("late") }]
            });
        })());

        const sending = session.send({ text: "Wait", attachments: [] });
        await vi.waitFor(() => expect(host.exportXml).toHaveBeenCalled());
        session.stop();
        release();
        await sending;

        expect(host.applyDiagramXml).not.toHaveBeenCalled();
        expect(host.xml).not.toContain('value="late"');
        session.destroy();
    });

    it("edits a user message after restoring its pre-submit XML snapshot", async () => {
        const initial = singlePageXml();
        const host = makeHost(initial, 0);
        const session = new NextAiSession(makePlugin(false) as never, host as never, makeStore() as never);
        let latest: any;
        session.subscribe(snapshot => { latest = snapshot; });
        aiMocks.responses.push(textMessage("original answer"));
        await session.send({ text: "Original prompt", attachments: [] });
        const userId = latest.messages.find((message: UIMessage) => message.role === "user").id;

        aiMocks.responses.push(textMessage("edited answer"));
        await session.editUserMessage(userId, "Edited prompt");

        expect(host.applyDiagramXml).toHaveBeenCalledWith(initial);
        expect(latest.userPresentation[userId].text).toBe("Edited prompt");
        expect(latest.messages.filter((message: UIMessage) => message.role === "assistant")).toHaveLength(1);
        session.destroy();
    });

    it("claims the generation before the first await so deferred double-send submits once", async () => {
        const host = makeHost(singlePageXml(), 0);
        const firstExport = deferred<string>();
        host.exportXml
            .mockImplementationOnce(() => firstExport.promise)
            .mockImplementation(async () => host.xml);
        const session = new NextAiSession(makePlugin(false) as never, host as never, makeStore() as never);
        let latest: any;
        session.subscribe(snapshot => { latest = snapshot; });
        aiMocks.responses.push(textMessage("only answer"));

        const first = session.send({ text: "First", attachments: [] });
        const second = session.send({ text: "Second", attachments: [] });
        await second;
        expect(latest.status).toBe("submitted");

        firstExport.resolve(host.xml);
        await first;

        expect(latest.messages.filter((message: UIMessage) => message.role === "user"))
            .toHaveLength(1);
        expect(Object.values(latest.userPresentation)).toEqual([{
            text: "First",
            attachments: []
        }]);
        session.destroy();
    });

    it.each(["startNew", "destroy"] as const)(
        "does not revive a delayed constructor restore after %s",
        async action => {
            const host = makeHost(singlePageXml(), 0);
            const restore = deferred<any[]>();
            const store = makeStore() as any;
            store.list.mockImplementationOnce(() => restore.promise);
            const session = new NextAiSession(makePlugin(false) as never, host as never, store);
            let latest: any;
            session.subscribe(snapshot => { latest = snapshot; });

            session[action]();
            restore.resolve([storedSession(textMessage("stale history"))]);
            await restore.promise;
            await Promise.resolve();

            expect(host.replaceAiHistory).not.toHaveBeenCalled();
            if (action === "startNew") {
                expect(latest.messages).toEqual([]);
                session.destroy();
            }
        }
    );

    it("rejects an AI commit when the canvas changes while history is captured", async () => {
        const host = makeHost(singlePageXml(), 0);
        const history = deferred<void>();
        host.captureAiHistory.mockImplementationOnce(() => history.promise);
        const session = new NextAiSession(makePlugin(false) as never, host as never, makeStore() as never);
        let latest: any;
        session.subscribe(snapshot => { latest = snapshot; });
        aiMocks.responses.push(
            toolMessage("edit_diagram", "history-race", {
                operations: [{ operation: "update", cell_id: "2", new_xml: vertex("ai-result") }]
            }),
            textMessage("conflict acknowledged")
        );

        const sending = session.send({ text: "Change it", attachments: [] });
        await vi.waitFor(() => expect(host.captureAiHistory).toHaveBeenCalledOnce());
        host.xml = singlePageXml().replace('value="initial"', 'value="manual-change"');
        host.revision++;
        history.resolve();
        await sending;

        expect(host.applyDiagramXml).not.toHaveBeenCalled();
        expect(host.xml).toContain('value="manual-change"');
        expect(host.xml).not.toContain('value="ai-result"');
        const tool = latest.messages
            .flatMap((message: UIMessage) => message.parts)
            .find((part: any) => part.toolCallId === "history-race");
        expect(tool).toMatchObject({
            state: "output-error",
            errorText: expect.stringContaining("recording diagram history")
        });
        session.destroy();
    });
});

function makePlugin(visualValidationEnabled: boolean): object {
    const settings = structuredClone(DEFAULT_SETTINGS);
    Object.assign(settings.drawing.drawio.nextAi, {
        enabled: true,
        serviceUrl: "https://next.example/",
        apiBaseUrl: "https://api.example/v1",
        apiKeySecretId: "api-key",
        model: "diagram-model",
        visualValidationMode: visualValidationEnabled ? "next-ai-server" : "disabled"
    });
    return {
        settings,
        app: {
            secretStorage: {
                getSecret: vi.fn(async () => "provider-secret")
            }
        }
    };
}

function makeHost(initialXml: string, currentPage: number): any {
    const host: any = {
        file: { path: "Diagram.drawio.svg" },
        xml: initialXml,
        revision: 0,
        exportXml: vi.fn(async () => host.xml),
        getRevision: vi.fn(() => host.revision),
        getViewMetadata: vi.fn(() => ({ currentPage, bounds: null, scale: 1 })),
        captureAiHistory: vi.fn(async () => undefined),
        applyDiagramXml: vi.fn(async (xml: string) => {
            host.xml = xml;
            host.revision++;
            return host.revision;
        }),
        ensureRevisionSaved: vi.fn(async () => undefined),
        exportPng: vi.fn(async () => "data:image/png;base64,AA=="),
        replaceAiHistory: vi.fn(),
        getAiHistory: vi.fn(() => [])
    };
    return host;
}

function makeStore(): object {
    return {
        list: vi.fn(async () => []),
        get: vi.fn(async () => null),
        save: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined)
    };
}

function toolMessage(name: string, toolCallId: string, input: unknown): UIMessage {
    return {
        id: `assistant-${toolCallId}`,
        role: "assistant",
        parts: [{
            type: `tool-${name}`,
            toolCallId,
            state: "input-available",
            input
        } as UIMessage["parts"][number]]
    };
}

function textMessage(text: string): UIMessage {
    return { id: `assistant-${text}`, role: "assistant", parts: [{ type: "text", text }] };
}

function singlePageXml(): string {
    return `<mxfile><diagram id="only" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${vertex("initial")}</root></mxGraphModel></diagram></mxfile>`;
}

function multiPageXml(): string {
    const model = (value: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${vertex(value)}</root></mxGraphModel>`;
    return `<mxfile><diagram id="first" name="Overview">${model("first")}</diagram><diagram id="second" name="Details">${model("second")}</diagram></mxfile>`;
}

function storedSession(...messages: UIMessage[]): any {
    return {
        id: "stored-session",
        filePath: "Diagram.drawio.svg",
        title: "Stored chat",
        updatedAt: 1,
        messages,
        userPresentation: {},
        previousXml: "",
        lastUserText: "stale",
        diagramXml: "",
        userXmlSnapshots: {},
        diagramHistory: [{ id: "stale-history" }]
    };
}

function deferred<T>(): {
    readonly promise: Promise<T>;
    resolve(value: T | PromiseLike<T>): void;
} {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
