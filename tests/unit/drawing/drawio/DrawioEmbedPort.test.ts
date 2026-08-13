import { DrawioEmbedPort } from "../../../../src/drawing/drawio/DrawioEmbedPort";

describe("DrawioEmbedPort", () => {
    beforeEach(() => {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
        if (!descriptor?.set) throw new Error("The test DOM does not expose the iframe src setter.");
        vi.spyOn(HTMLIFrameElement.prototype, "src", "set").mockImplementation(function () {
            descriptor.set!.call(this, "about:blank");
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.replaceChildren();
    });

    it("completes init, load, autosave and correlated Unicode export", async () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const port = new DrawioEmbedPort("https://embed.diagrams.net/?lang=zh");
        const mounting = port.mount(container);
        const iframe = container.querySelector("iframe")!;
        const frame = iframe.contentWindow!;

        expect(iframe.style.width).toBe("100%");
        expect(iframe.style.height).toBe("100%");
        expect(iframe.style.border).toBe("0px");

        const post = vi.spyOn(frame, "postMessage").mockImplementation(() => undefined);
        dispatch(frame, "https://evil.example", { event: "init" });
        dispatch(frame, "https://embed.diagrams.net", { event: "init" });
        await mounting;

        const loading = port.load("<mxGraphModel><root/></mxGraphModel>");
        expect(post.mock.calls.at(-1)?.[1]).toBe("https://embed.diagrams.net");
        dispatch(frame, "https://embed.diagrams.net", {
            event: "load",
            currentPage: 1,
            bounds: { x: 10, y: 20, width: 300, height: 200 },
            scale: 1.25
        });
        await expect(loading).resolves.toEqual({
            currentPage: 1,
            bounds: { x: 10, y: 20, width: 300, height: 200 },
            scale: 1.25
        });

        const dirty = vi.fn();
        port.onDirty(dirty);
        dispatch(frame, "https://embed.diagrams.net", {
            event: "autosave",
            message: {
                action: "load",
                xml: "<mxGraphModel><root/></mxGraphModel>",
                autosave: 1
            },
            xml: "<mxGraphModel><root><mxCell id=\"0\"/></root></mxGraphModel>"
        });
        expect(dirty).toHaveBeenCalledOnce();

        post.mockClear();
        const exporting = port.export("xmlsvg");
        await vi.waitFor(() => expect(post).toHaveBeenCalled());
        const request = JSON.parse(String(post.mock.calls.at(-1)?.[0]));
        expect(request).toMatchObject({ action: "export", format: "xmlsvg" });
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" content="&lt;mxGraphModel&gt;你好&lt;/mxGraphModel&gt;"/>';
        dispatch(frame, "https://embed.diagrams.net", {
            event: "export",
            format: "svg",
            message: {
                action: "export",
                format: "xmlsvg",
                message: "image-assistant-stale-response"
            },
            data: `data:image/svg+xml,${encodeURIComponent(svg)}`
        });
        let settled = false;
        void exporting.finally(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);

        // Current official builds echo the whole request object and label xmlsvg as svg.
        dispatch(frame, "https://embed.diagrams.net", {
            event: "export",
            format: "svg",
            message: request,
            data: `data:image/svg+xml,${encodeURIComponent(svg)}`
        });
        await expect(exporting).resolves.toEqual({
            data: svg,
            metadata: {
                currentPage: 1,
                bounds: { x: 10, y: 20, width: 300, height: 200 },
                scale: 1.25
            }
        });

        // Other compatible deployments omit the optional message echo entirely.
        post.mockClear();
        const exportingWithoutEcho = port.export("xmlsvg");
        await vi.waitFor(() => expect(post).toHaveBeenCalled());
        dispatch(frame, "https://embed.diagrams.net", {
            event: "export",
            format: "svg",
            data: `data:image/svg+xml,${encodeURIComponent(svg)}`
        });
        await expect(exportingWithoutEcho).resolves.toMatchObject({ data: svg });

        post.mockClear();
        const pngExport = port.export("png", { currentPage: true });
        await vi.waitFor(() => expect(post).toHaveBeenCalled());
        const pngRequest = JSON.parse(String(post.mock.calls.at(-1)?.[0]));
        expect(pngRequest).toMatchObject({
            action: "export",
            format: "png",
            currentPage: true
        });
        dispatch(frame, "https://embed.diagrams.net", {
            event: "export",
            format: "png",
            message: pngRequest,
            currentPage: 2,
            data: "data:image/png;base64,AA=="
        });
        await expect(pngExport).resolves.toMatchObject({
            data: "data:image/png;base64,AA==",
            metadata: { currentPage: 2 }
        });

        post.mockClear();
        const svgExport = port.export("svg", { currentPage: true });
        await vi.waitFor(() => expect(post).toHaveBeenCalled());
        const svgRequest = JSON.parse(String(post.mock.calls.at(-1)?.[0]));
        const plainSvg = '<svg xmlns="http://www.w3.org/2000/svg"><text>你好</text></svg>';
        dispatch(frame, "https://embed.diagrams.net", {
            event: "export",
            format: "svg",
            message: svgRequest,
            data: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(plainSvg)))}`
        });
        await expect(svgExport).resolves.toMatchObject({ data: plainSvg });

        post.mockClear();
        const reloading = port.load("<mxfile><diagram/><diagram/><diagram/></mxfile>");
        await vi.waitFor(() => expect(post).toHaveBeenCalled());
        dispatch(frame, "https://embed.diagrams.net", {
            event: "load",
            currentPage: 0,
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            scale: 1
        });
        await vi.waitFor(() => expect(post.mock.calls.some(call => {
            const value = JSON.parse(String(call[0]));
            return value.action === "export" && value.format === "xml";
        })).toBe(true));
        const requests = post.mock.calls.map(call => JSON.parse(String(call[0])));
        expect(requests.filter(value => value.action === "invokeAction")).toEqual([
            { action: "invokeAction", actionName: "nextPage" },
            { action: "invokeAction", actionName: "nextPage" }
        ]);
        const pageExport = [...requests].reverse().find((value: { action?: string }) =>
            value.action === "export");
        dispatch(frame, "https://embed.diagrams.net", {
            event: "export",
            format: "xml",
            message: pageExport,
            currentPage: 2,
            xml: "<mxfile><diagram/><diagram/><diagram/></mxfile>"
        });
        await expect(reloading).resolves.toMatchObject({ currentPage: 2 });
        port.destroy();
        expect(container.querySelector("iframe")).toBeNull();
    });

    it("ignores malformed and wrong-source messages", async () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const port = new DrawioEmbedPort("https://embed.diagrams.net/");
        const mounting = port.mount(container);
        const frame = container.querySelector("iframe")!.contentWindow!;
        vi.spyOn(frame, "postMessage").mockImplementation(() => undefined);
        window.dispatchEvent(new MessageEvent("message", {
            data: "not json",
            origin: "https://embed.diagrams.net",
            source: frame
        }));
        window.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({ event: "init" }),
            origin: "https://embed.diagrams.net",
            source: window
        }));
        dispatch(frame, "https://embed.diagrams.net", { event: "init" });
        await expect(mounting).resolves.toBeUndefined();
        port.destroy();
    });

    it("accepts a load acknowledgement with invalid optional view metadata", async () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const port = new DrawioEmbedPort("https://embed.diagrams.net/");
        const mounting = port.mount(container);
        const frame = container.querySelector("iframe")!.contentWindow!;
        vi.spyOn(frame, "postMessage").mockImplementation(() => undefined);

        dispatch(frame, "https://embed.diagrams.net", { event: "init" });
        await mounting;

        const loading = port.load("<mxGraphModel><root/></mxGraphModel>");
        dispatch(frame, "https://embed.diagrams.net", {
            event: "load",
            message: null,
            xml: null,
            currentPage: null,
            bounds: null,
            scale: 0
        });

        await expect(loading).resolves.toEqual({
            currentPage: null,
            bounds: null,
            scale: null
        });
        port.destroy();
    });

    it("keeps sending to the authenticated init peer when contentWindow is rewrapped", async () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const port = new DrawioEmbedPort("https://embed.diagrams.net/");
        const mounting = port.mount(container);
        const iframe = container.querySelector("iframe")!;
        const authenticatedPeer = iframe.contentWindow!;
        const post = vi.spyOn(authenticatedPeer, "postMessage").mockImplementation(() => undefined);

        dispatch(authenticatedPeer, "https://embed.diagrams.net", { event: "init" });
        await mounting;
        Object.defineProperty(iframe, "contentWindow", {
            configurable: true,
            value: { postMessage: vi.fn() }
        });

        const loading = port.load("<mxGraphModel><root/></mxGraphModel>");
        expect(post).toHaveBeenCalledWith(
            expect.stringContaining('"action":"load"'),
            "https://embed.diagrams.net"
        );
        dispatch(authenticatedPeer, "https://embed.diagrams.net", { event: "load" });
        await expect(loading).resolves.toMatchObject({ currentPage: null });
        port.destroy();
    });

    it("fails a load immediately when the authenticated peer cannot receive it", async () => {
        vi.useFakeTimers();
        const { port, post } = await createReadyPort();
        post.mockImplementationOnce(() => { throw new Error("transport blocked"); });

        await expect(port.load("<mxGraphModel><root/></mxGraphModel>"))
            .rejects.toThrow(/transport blocked/i);
        await vi.advanceTimersByTimeAsync(30_000);
        await expect(port.export("xml")).rejects.toThrow(/reopen.*retry/i);
        port.destroy();
        vi.useRealTimers();
    });

    it("restores the latest confirmed autosave after an iframe reload", async () => {
        const { port, frame, post } = await createReadyPort();
        const sourceA = "<mxGraphModel><root><mxCell id=\"a\"/></root></mxGraphModel>";
        const sourceB = "<mxGraphModel><root><mxCell id=\"b\"/></root></mxGraphModel>";

        const initialLoad = port.load(sourceA);
        dispatch(frame, "https://embed.diagrams.net", { event: "load" });
        await initialLoad;
        dispatch(frame, "https://embed.diagrams.net", { event: "autosave", xml: sourceB });

        post.mockClear();
        dispatch(frame, "https://embed.diagrams.net", { event: "init" });
        await vi.waitFor(() => expect(post).toHaveBeenCalled());
        expect(readPostedMessages(post)).toContainEqual(expect.objectContaining({
            action: "load",
            xml: sourceB
        }));
        dispatch(frame, "https://embed.diagrams.net", { event: "load" });
        await Promise.resolve();
        port.destroy();
    });

    it("restores the last confirmed source instead of an interrupted pending load", async () => {
        const { port, frame, post } = await createReadyPort();
        const sourceA = "<mxGraphModel><root><mxCell id=\"a\"/></root></mxGraphModel>";
        const sourceB = "<mxGraphModel><root><mxCell id=\"b\"/></root></mxGraphModel>";

        const initialLoad = port.load(sourceA);
        dispatch(frame, "https://embed.diagrams.net", { event: "load" });
        await initialLoad;
        post.mockClear();

        const interrupted = port.load(sourceB);
        dispatch(frame, "https://embed.diagrams.net", { event: "init" });
        await expect(interrupted).rejects.toThrow(/reloaded during an operation/i);
        await vi.waitFor(() => expect(readPostedMessages(post).filter(value =>
            value.action === "load").length).toBe(2));
        expect(readPostedMessages(post).filter(value => value.action === "load")).toEqual([
            expect.objectContaining({ xml: sourceB }),
            expect.objectContaining({ xml: sourceA })
        ]);
        dispatch(frame, "https://embed.diagrams.net", { event: "load" });
        await Promise.resolve();
        port.destroy();
    });

    it("invalidates the port after a load timeout so a late acknowledgement cannot cross requests", async () => {
        vi.useFakeTimers();
        const { port, frame } = await createReadyPort();
        const loading = port.load("<mxGraphModel><root/></mxGraphModel>");
        const rejection = expect(loading).rejects.toThrow(/did not finish loading/i);

        await vi.advanceTimersByTimeAsync(30_000);
        await rejection;
        await expect(port.load("<mxGraphModel><root><mxCell/></root></mxGraphModel>"))
            .rejects.toThrow(/reopen.*retry/i);
        dispatch(frame, "https://embed.diagrams.net", { event: "load" });
        port.destroy();
        vi.useRealTimers();
    });

    it("verifies loading with a correlated XML export when the load event is missing", async () => {
        vi.useFakeTimers();
        const { port, frame, post } = await createReadyPort();
        const source = '<mxfile host="test"><diagram id="page" name="Page-1"><mxGraphModel dx="1200" dy="800"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="probe" value="sentinel" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>';
        const loading = port.load(source);

        await vi.advanceTimersByTimeAsync(1_500);
        const probe = readPostedMessages(post).find(value =>
            value.action === "export" && value.format === "xml");
        expect(probe).toMatchObject({
            action: "export",
            format: "xml",
            message: expect.stringMatching(/^image-assistant-load-probe-/)
        });
        dispatch(frame, "https://embed.diagrams.net", {
            event: "export",
            format: "xml",
            message: probe,
            xml: source.replace('dx="1200" dy="800"', 'dy="20" dx="10"')
        });

        await expect(loading).resolves.toEqual({
            currentPage: null,
            bounds: null,
            scale: null
        });
        port.destroy();
        vi.useRealTimers();
    });

    it("rejects a load probe that exports a different active diagram", async () => {
        vi.useFakeTimers();
        const { port, frame, post } = await createReadyPort();
        const requested = '<mxGraphModel><root><mxCell id="requested"/></root></mxGraphModel>';
        const loading = port.load(requested);
        const rejection = expect(loading).rejects.toThrow(/did not match the requested model/i);

        await vi.advanceTimersByTimeAsync(1_500);
        const probe = readPostedMessages(post).find(value =>
            value.action === "export" && value.format === "xml");
        dispatch(frame, "https://embed.diagrams.net", {
            event: "export",
            format: "xml",
            message: probe,
            xml: '<mxGraphModel><root><mxCell id="stale"/></root></mxGraphModel>'
        });

        await rejection;
        await expect(port.export("xml")).rejects.toThrow(/did not match/i);
        port.destroy();
        vi.useRealTimers();
    });

    it("rejects active and queued exports from an iframe epoch that reloaded", async () => {
        const { port, frame, post } = await createReadyPort();
        const source = "<mxGraphModel><root/></mxGraphModel>";
        const loading = port.load(source);
        dispatch(frame, "https://embed.diagrams.net", { event: "load" });
        await loading;

        post.mockClear();
        const active = port.export("xml");
        const queued = port.export("svg");
        await vi.waitFor(() => expect(readPostedMessages(post)).toContainEqual(
            expect.objectContaining({ action: "export", format: "xml" })
        ));
        dispatch(frame, "https://embed.diagrams.net", { event: "init" });

        await expect(active).rejects.toThrow(/reloaded during an operation/i);
        await expect(queued).rejects.toThrow(/reloaded before the export started/i);
        await vi.waitFor(() => expect(readPostedMessages(post)).toContainEqual(
            expect.objectContaining({ action: "load", xml: source })
        ));
        expect(readPostedMessages(post)).not.toContainEqual(
            expect.objectContaining({ action: "export", format: "svg" })
        );

        dispatch(frame, "https://embed.diagrams.net", { event: "load" });
        await Promise.resolve();
        port.destroy();
    });

    it("keeps strict origin validation and reports the rejected response origin", async () => {
        vi.useFakeTimers();
        const container = document.createElement("div");
        document.body.appendChild(container);
        const port = new DrawioEmbedPort("https://embed.diagrams.net/");
        const mounting = port.mount(container);
        const frame = container.querySelector("iframe")!.contentWindow!;
        const rejection = expect(mounting).rejects.toThrow(
            /responded from https:\/\/redirected\.example.*embed\.diagrams\.net/i
        );

        dispatch(frame, "https://redirected.example", { event: "init" });
        await vi.advanceTimersByTimeAsync(30_000);
        await rejection;
        port.destroy();
        vi.useRealTimers();
    });
});

function dispatch(source: Window, origin: string, data: unknown): void {
    window.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify(data),
        origin,
        source
    }));
}

async function createReadyPort(): Promise<{
    port: DrawioEmbedPort;
    frame: Window;
    post: ReturnType<typeof vi.spyOn>;
}> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const port = new DrawioEmbedPort("https://embed.diagrams.net/");
    const mounting = port.mount(container);
    const frame = container.querySelector("iframe")!.contentWindow!;
    const post = vi.spyOn(frame, "postMessage").mockImplementation(() => undefined);
    dispatch(frame, "https://embed.diagrams.net", { event: "init" });
    await mounting;
    return { port, frame, post };
}

function readPostedMessages(post: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
    return post.mock.calls.map(call => JSON.parse(String(call[0])) as Record<string, unknown>);
}
