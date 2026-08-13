import { loadPdfJs } from "obsidian";
import type { DrawingAiAttachment } from "../DrawioTypes";

export const NEXT_AI_MAX_FILES = 5;
export const NEXT_AI_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const NEXT_AI_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const NEXT_AI_MAX_EXTRACTED_CHARS = 150_000;

const TEXT_EXTENSIONS = new Set([
    "txt", "md", "markdown", "json", "csv", "xml", "html", "css", "js", "ts",
    "jsx", "tsx", "py", "java", "c", "cpp", "h", "go", "rs", "yaml", "yml",
    "toml", "ini", "log", "sh", "bash", "zsh"
]);

interface PdfTextItem {
    readonly str?: string;
    readonly hasEOL?: boolean;
}

interface PdfPage {
    getTextContent(): Promise<{ items: readonly unknown[] }>;
}

interface PdfDocument {
    readonly numPages: number;
    getPage(pageNumber: number): Promise<PdfPage>;
    destroy?(): Promise<void> | void;
}

interface PdfJs {
    getDocument(options: { data: Uint8Array }): { promise: Promise<PdfDocument> };
}

export async function processNextAiFiles(files: readonly File[]): Promise<DrawingAiAttachment[]> {
    if (files.length > NEXT_AI_MAX_FILES) {
        throw new Error(`Next AI accepts at most ${NEXT_AI_MAX_FILES} files per message.`);
    }
    const attachments: DrawingAiAttachment[] = [];
    for (const file of files) attachments.push(await processNextAiFile(file));
    return attachments;
}

export async function processNextAiFile(file: File): Promise<DrawingAiAttachment> {
    if (isImage(file)) {
        if (file.size > NEXT_AI_MAX_IMAGE_BYTES) {
            throw new Error(`${file.name} exceeds the 2 MB image limit.`);
        }
        return {
            id: createId(),
            kind: "image",
            name: file.name || "image",
            mediaType: file.type || "image/png",
            size: file.size,
            dataUrl: await blobToDataUrl(file)
        };
    }
    if (isPdf(file)) {
        assertDocumentSize(file);
        return {
            id: createId(),
            kind: "pdf",
            name: file.name || "document.pdf",
            mediaType: "application/pdf",
            size: file.size,
            extractedText: limitExtractedText(await extractPdfText(file), file.name)
        };
    }
    if (isText(file)) {
        assertDocumentSize(file);
        return {
            id: createId(),
            kind: "text",
            name: file.name || "document.txt",
            mediaType: file.type || "text/plain",
            size: file.size,
            extractedText: limitExtractedText(await file.text(), file.name)
        };
    }
    throw new Error(`${file.name || "File"} is not a supported image, PDF, or text file.`);
}

function assertDocumentSize(file: File): void {
    if (file.size > NEXT_AI_MAX_DOCUMENT_BYTES) {
        throw new Error(`${file.name} exceeds the 25 MB document limit.`);
    }
}

export function createUrlAttachment(
    url: string,
    title: string,
    content: string,
    charCount: number
): DrawingAiAttachment {
    return {
        id: createId(),
        kind: "url",
        name: title.trim() || url,
        mediaType: "text/markdown",
        size: charCount,
        extractedText: limitExtractedText(content, title || url),
        sourceUrl: url
    };
}

export function createCanvasAttachment(dataUrl: string): DrawingAiAttachment {
    const size = estimateDataUrlBytes(dataUrl);
    if (size > NEXT_AI_MAX_IMAGE_BYTES) {
        throw new Error("The current canvas screenshot exceeds the 2 MB Next AI image limit.");
    }
    return {
        id: createId(),
        kind: "canvas",
        name: "current-canvas.png",
        mediaType: "image/png",
        size,
        dataUrl
    };
}

export function buildNextAiMessageText(
    text: string,
    attachments: readonly DrawingAiAttachment[]
): string {
    const sections = [text.trim()];
    for (const attachment of attachments) {
        if (!attachment.extractedText) continue;
        if (attachment.kind === "url") {
            sections.push(
                `[URL: ${attachment.sourceUrl ?? attachment.name}]\nTitle: ${attachment.name}\n\n${attachment.extractedText}`
            );
        } else {
            const label = attachment.kind === "pdf" ? "PDF" : "File";
            sections.push(`[${label}: ${attachment.name}]\n${attachment.extractedText}`);
        }
    }
    return sections.filter(Boolean).join("\n\n");
}

export function isSupportedNextAiFile(file: File): boolean {
    return isImage(file) || isPdf(file) || isText(file);
}

async function extractPdfText(file: File): Promise<string> {
    const pdfJs = await loadPdfJs() as PdfJs;
    const document = await pdfJs.getDocument({
        data: new Uint8Array(await file.arrayBuffer())
    }).promise;
    const pages: string[] = [];
    try {
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
            const page = await document.getPage(pageNumber);
            const content = await page.getTextContent();
            let value = "";
            for (const candidate of content.items) {
                if (!candidate || typeof candidate !== "object") continue;
                const item = candidate as PdfTextItem;
                if (typeof item.str !== "string") continue;
                value += item.str;
                value += item.hasEOL ? "\n" : " ";
            }
            pages.push(value.trim());
        }
    } finally {
        await document.destroy?.();
    }
    return pages.filter(Boolean).join("\n\n");
}

function limitExtractedText(value: string, label: string): string {
    if (value.length > NEXT_AI_MAX_EXTRACTED_CHARS) {
        throw new Error(`${label} exceeds the 150k extracted-text limit.`);
    }
    return value;
}

function isImage(file: File): boolean {
    return file.type.toLowerCase().startsWith("image/");
}

function isPdf(file: File): boolean {
    return file.type.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isText(file: File): boolean {
    const type = file.type.toLowerCase();
    if (type.startsWith("text/") || type === "application/json") return true;
    const extension = file.name.toLowerCase().split(".").pop() ?? "";
    return TEXT_EXTENSIONS.has(extension);
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => {
            if (typeof reader.result === "string") resolve(reader.result);
            else reject(new Error("Unable to encode the image attachment."));
        }, { once: true });
        reader.addEventListener("error", () => reject(
            reader.error ?? new Error("Unable to read the image attachment.")
        ), { once: true });
        reader.readAsDataURL(blob);
    });
}

function estimateDataUrlBytes(value: string): number {
    const comma = value.indexOf(",");
    if (comma < 0) return value.length;
    const metadata = value.slice(0, comma);
    const payload = value.slice(comma + 1);
    return /;base64/i.test(metadata)
        ? Math.ceil(payload.length * 3 / 4)
        : new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
}

function createId(): string {
    return globalThis.crypto?.randomUUID?.()
        ?? `image-assistant-attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
