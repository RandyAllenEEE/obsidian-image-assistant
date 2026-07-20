import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../../src/utils/BinaryHash";
import {
    captureImageFileRevision,
    verifyImageFileRevision
} from "../../../src/utils/ImageFileRevision";
import { ImageEditCommitService } from "../../../src/utils/ImageEditCommitService";
import { ModalCommitGuard } from "../../../src/utils/ModalCommitGuard";
import { fakeApp, fakeTFile, fakeVault } from "../../factories/obsidian";
import { makePngBytes } from "../../factories/image";

describe("image edit lifecycle utilities", () => {
    it("uses a deterministic SHA-256 fallback when Web Crypto is unavailable", async () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
        Object.defineProperty(globalThis, "crypto", {
            configurable: true,
            value: {}
        });
        try {
            const digest = await sha256Hex(
                new TextEncoder().encode("abc").buffer as ArrayBuffer
            );
            expect(digest).toBe(
                "ba7816bf8f01cfea414140de5dae2223"
                + "b00361a396177a9cb410ff61f20015ad"
            );
        } finally {
            if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
        }
    });

    it("detects content and mtime changes before an edit commit", async () => {
        const file = fakeTFile({
            path: "assets/image.png",
            extension: "png",
            stat: { ctime: 1, mtime: 10, size: 10 }
        });
        const original = makePngBytes({ width: 2, height: 2 });
        const contents = new Map([[file.path, original]]);
        const vault = fakeVault({ files: [file], binaryContents: contents });
        const app = fakeApp({ vault }) as any;
        const revision = await captureImageFileRevision(app, file, original);

        file.stat.mtime = 11;
        const check = await verifyImageFileRevision(app, revision);

        expect(check.matches).toBe(false);
        expect(check.reason).toBe("content-changed");
    });

    it("writes valid output only while the captured revision still matches", async () => {
        const file = fakeTFile({
            path: "assets/image.png",
            extension: "png",
            stat: { ctime: 1, mtime: 10, size: 10 }
        });
        const original = makePngBytes({ width: 2, height: 2 });
        const output = makePngBytes({ width: 3, height: 3 });
        const contents = new Map([[file.path, original]]);
        const vault = fakeVault({ files: [file], binaryContents: contents });
        const app = fakeApp({ vault }) as any;
        const revision = await captureImageFileRevision(app, file, original);
        const service = new ImageEditCommitService(app);

        contents.set(file.path, makePngBytes({ width: 4, height: 4 }));
        const stale = await service.commit({
            file,
            expectedRevision: revision,
            data: output
        });

        expect(stale).toMatchObject({ success: false, written: false, stale: true });
        expect(vault.modifyBinary).not.toHaveBeenCalled();
    });

    it("allows cancellation before commit and locks closing during commit", () => {
        const guard = new ModalCommitGuard();
        guard.reset();
        const first = guard.beginPreparing()!;
        expect(guard.cancel()).toBe(true);
        expect(guard.isCurrent(first)).toBe(false);

        guard.reset();
        const second = guard.beginPreparing()!;
        expect(guard.beginCommitting(second)).toBe(true);
        expect(guard.closeLocked).toBe(true);
        expect(guard.cancel()).toBe(false);
        expect(guard.finish(second)).toBe(true);
        expect(guard.closeLocked).toBe(false);
    });
});
