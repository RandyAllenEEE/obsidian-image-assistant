import { buildDrawioEmbedUrl } from "../../../../src/drawing/drawio/DrawioEmbedUrl";

describe("buildDrawioEmbedUrl", () => {
    it("preserves deployment paths and custom query values while forcing embed protocol flags", () => {
        const { url } = buildDrawioEmbedUrl("https://example.com/draw/?lang=zh&embed=0#section");
        expect(url.pathname).toBe("/draw/");
        expect(url.searchParams.get("lang")).toBe("zh");
        expect(url.searchParams.get("embed")).toBe("1");
        expect(url.searchParams.get("proto")).toBe("json");
        expect(url.searchParams.get("returnbounds")).toBe("1");
        expect(url.searchParams.has("configure")).toBe(false);
        expect(url.searchParams.get("noExitBtn")).toBe("1");
        expect(url.hash).toBe("#section");
    });

    it("warns for the official app host and plain HTTP", () => {
        expect(buildDrawioEmbedUrl("https://app.diagrams.net/").warning).toMatch(/embed\.diagrams\.net/);
        expect(buildDrawioEmbedUrl("http://localhost:8080/").warning).toMatch(/not encrypted/i);
    });

    it("maps native UI themes and explicit dark appearance without disturbing custom parameters", () => {
        const minimal = buildDrawioEmbedUrl("https://example.com/?lang=zh", {
            theme: "minimal",
            dark: true
        }).url;
        expect(minimal.searchParams.get("ui")).toBe("min");
        expect(minimal.searchParams.get("dark")).toBe("1");
        expect(minimal.searchParams.get("lang")).toBe("zh");

        const lightDarkUi = buildDrawioEmbedUrl("https://example.com/", {
            theme: "dark",
            dark: false
        }).url;
        expect(lightDarkUi.searchParams.get("ui")).toBe("dark");
        expect(lightDarkUi.searchParams.get("dark")).toBe("0");
    });

    it("rejects unsafe or unsupported URLs at runtime", () => {
        expect(() => buildDrawioEmbedUrl("javascript:alert(1)")).toThrow(/HTTP or HTTPS/);
        expect(() => buildDrawioEmbedUrl("https://user:secret@example.com/")).toThrow(/credentials/);
        expect(() => buildDrawioEmbedUrl("not a url")).toThrow(/valid Draw\.io URL/);
    });
});
