import { describe, expect, it } from "vitest";
import { payloadGenerator } from "../../src/payloadGenerator";

function decode(buffer: ArrayBuffer): string {
    return new TextDecoder().decode(buffer);
}

describe("payloadGenerator", () => {
    it("emits exactly one closing boundary", async () => {
        const [payload, boundaryString] = await payloadGenerator({ first: "one", second: "two" });
        const body = decode(payload);
        const closingBoundary = `------${boundaryString}--\r\n`;

        expect(body.endsWith(closingBoundary)).toBe(true);
        expect(body.split(closingBoundary)).toHaveLength(2);
    });

    it("sanitizes field names and file names used in multipart headers", async () => {
        const file = new File(["image"], "unsafe\r\n\"name.png", { type: "image/png" });
        const [payload] = await payloadGenerator({ 'field\r\n"injected': file });
        const body = decode(payload);

        expect(body).toContain('name="field___injected"');
        expect(body).toContain('filename="unsafe___name.png"');
        expect(body).not.toContain("\r\n\"injected");
        expect(body).not.toContain("\r\n\"name.png");
    });

    it("preserves string field values", async () => {
        const [payload] = await payloadGenerator({ description: 'line one\r\n"line two"' });

        expect(decode(payload)).toContain('line one\r\n"line two"');
    });
});
