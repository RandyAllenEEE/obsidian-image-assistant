import { detectImageBinaryType } from "../../utils/ImageBinaryType";

export interface OcrImagePayload {
    data: ArrayBuffer;
    mimeType: string;
    fileName: string;
}

export async function createOcrImagePayload(image: Uint8Array): Promise<OcrImagePayload> {
    const data = new Uint8Array(image).buffer;
    const detected = await detectImageBinaryType(data);
    if (!detected) throw new Error("OCR input is not a recognized image");

    return {
        data,
        mimeType: detected.mime,
        fileName: `image.${detected.ext}`,
    };
}
