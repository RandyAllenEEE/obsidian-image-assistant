import { createDrawioProtocolSender } from "../../../../src/drawing/drawio/DrawioProtocolSender";

describe("DrawioProtocolSender", () => {
    it("posts directly when the iframe belongs to the current window", () => {
        const target = { postMessage: vi.fn() } as unknown as Window;
        const sender = createDrawioProtocolSender(window);

        sender(target, '{"action":"load"}', "https://embed.diagrams.net");

        expect(target.postMessage).toHaveBeenCalledWith(
            '{"action":"load"}',
            "https://embed.diagrams.net"
        );
    });

    it("creates a constant owner-realm bridge for an Obsidian popout", () => {
        const realmSender = vi.fn();
        const realmFunction = vi.fn(() => realmSender);
        const ownerWindow = { Function: realmFunction } as unknown as Window;
        const target = {} as Window;

        const sender = createDrawioProtocolSender(ownerWindow);
        sender(target, "sensitive diagram xml", "https://embed.diagrams.net");

        expect(realmFunction).toHaveBeenCalledWith(
            "target",
            "payload",
            "targetOrigin",
            expect.stringContaining("target.postMessage(payload, targetOrigin)")
        );
        expect(realmFunction.mock.calls.flat().join(" ")).not.toContain("sensitive diagram xml");
        expect(realmSender).toHaveBeenCalledWith(
            target,
            "sensitive diagram xml",
            "https://embed.diagrams.net"
        );
    });
});
