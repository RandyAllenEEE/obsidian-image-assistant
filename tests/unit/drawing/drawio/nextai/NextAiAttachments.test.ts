import { loadPdfJs } from "obsidian";
import {
    buildNextAiMessageText,
    createCanvasAttachment,
    NEXT_AI_MAX_DOCUMENT_BYTES,
    NEXT_AI_MAX_FILES,
    processNextAiFile,
    processNextAiFiles
} from "../../../../../src/drawing/drawio/nextai/NextAiAttachments";

describe("NextAiAttachments", () => {
    it("enforces file-count, image, and document read limits", async () => {
        const files = Array.from({ length: NEXT_AI_MAX_FILES + 1 }, (_, index) =>
            new File(["x"], `${index}.txt`, { type: "text/plain" }));
        await expect(processNextAiFiles(files)).rejects.toThrow(/at most 5/);

        const largeDocument = new File([new Uint8Array(NEXT_AI_MAX_DOCUMENT_BYTES + 1)], "large.txt", {
            type: "text/plain"
        });
        await expect(processNextAiFile(largeDocument)).rejects.toThrow(/25 MB/);

        const largeCanvas = `data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}`;
        expect(() => createCanvasAttachment(largeCanvas)).toThrow(/2 MB/);
    });

    it("extracts PDF text and always destroys the PDF.js document", async () => {
        const destroy = vi.fn(async () => undefined);
        vi.mocked(loadPdfJs).mockResolvedValue({
            getDocument: () => ({
                promise: Promise.resolve({
                    numPages: 2,
                    getPage: async (page: number) => ({
                        getTextContent: async () => ({
                            items: [{ str: `Page ${page}`, hasEOL: true }, { str: "body" }]
                        })
                    }),
                    destroy
                })
            })
        } as never);

        const attachment = await processNextAiFile(new File(["pdf"], "sample.pdf", {
            type: "application/pdf"
        }));
        expect(attachment).toMatchObject({
            kind: "pdf",
            extractedText: "Page 1\nbody\n\nPage 2\nbody"
        });
        expect(destroy).toHaveBeenCalledOnce();
    });

    it("keeps extracted document bodies out of presentation text while sending them to the model", async () => {
        const attachment = await processNextAiFile(new File(["private context"], "notes.txt", {
            type: "text/plain"
        }));
        expect(buildNextAiMessageText("Draw this", [attachment])).toContain("private context");
        expect(attachment.name).toBe("notes.txt");
    });
});
