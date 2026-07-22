import { describe, expect, it, vi } from "vitest";
import { MarkdownSourceContextIndex } from "../../../src/utils/MarkdownSourceContext";
import { REFERENCE_INDEX_VERSION } from "../../../src/utils/reference-index/ReferenceIndexDocument";
import { ReferenceIndexWorkerCore } from "../../../src/utils/reference-index/ReferenceIndexWorkerCore";

const MARKDOWN_METADATA = {
    path: "notes/source.md",
    kind: "markdown" as const,
    mtime: 10,
    size: 100
};

describe("ReferenceIndexWorkerCore", () => {
    it("parses one Markdown context index and keeps safety and mutation views in one record", () => {
        const create = vi.spyOn(MarkdownSourceContextIndex, "create");
        const core = new ReferenceIndexWorkerCore();
        core.upsertDocument(MARKDOWN_METADATA, [
            "![[assets/photo.png|prose]]",
            "```markdown",
            "![[assets/photo.png|protected]]",
            "```",
            "```ad-note",
            "![[assets/photo.png|admonition]]",
            "```",
            "![remote](https://cdn.example.com/image?id=1)"
        ].join("\n"));

        expect(create).toHaveBeenCalledOnce();
        expect(core.queryLocal(["photo.png"], true, [])["photo.png"].references)
            .toHaveLength(3);
        expect(core.queryLocal(["photo.png"], false, [])["photo.png"].references)
            .toHaveLength(2);
        expect(core.queryUrl(
            "https://cdn.example.com/image?id=1",
            true,
            []
        ).references).toHaveLength(1);
    });

    it("uses an overlay without rebuilding contributions for every requested bucket", () => {
        const core = new ReferenceIndexWorkerCore();
        core.upsertDocument(MARKDOWN_METADATA, "![[assets/photo.png]]");
        core.upsertOverlay(MARKDOWN_METADATA, [
            "![[assets/second.png]]",
            "![remote](https://cdn.example.com/new)"
        ].join("\n"));

        const local = core.queryLocal(
            ["photo.png", "second.png"],
            true,
            [MARKDOWN_METADATA.path]
        );
        expect(local["photo.png"].references).toHaveLength(0);
        expect(local["second.png"].references).toHaveLength(1);
        expect(core.queryUrl(
            "https://cdn.example.com/new",
            true,
            [MARKDOWN_METADATA.path]
        ).references).toHaveLength(1);
    });

    it("round-trips only V3 data and rejects malformed or legacy payloads", () => {
        const core = new ReferenceIndexWorkerCore();
        core.upsertDocument(MARKDOWN_METADATA, "![[assets/photo.png]]");
        const serialized = core.serialize();
        const persisted = JSON.parse(new TextDecoder().decode(new Uint8Array(serialized)));

        expect(persisted.version).toBe(REFERENCE_INDEX_VERSION);
        expect(new ReferenceIndexWorkerCore().hydrate(serialized).accepted).toBe(true);
        expect(new ReferenceIndexWorkerCore().hydrate(
            new TextEncoder().encode('{"version":2,"documents":[]}').buffer
        ).accepted).toBe(false);
        expect(new ReferenceIndexWorkerCore().hydrate(
            new TextEncoder().encode("{broken").buffer
        ).accepted).toBe(false);
    });
});
