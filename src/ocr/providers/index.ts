import { OCRSettings } from "../OCRSettings";
import { OCRProvider } from "../OCRSettings";

// Provider imports
import SimpleTex from "./simple-tex";
import Pic2Tex from "./pic2tex";
import Texify from "./texify";
import { AIModelConverter } from "./AIModelConverter";

/**
 * 获取 LaTeX Provider
 * @param isMultiline 是否多行模式
 * @param settings OCR 设置
 * @returns OCR Provider 实例
 */
export function getLatexProvider(
    isMultiline: boolean,
    settings: OCRSettings
): OCRProvider {
    switch (settings.latexProvider) {
        case "SimpleTex":
            return new SimpleTex(isMultiline, settings);
        case "Pix2Tex":
            return new Pic2Tex(isMultiline, settings);
        case "Texify":
            return new Texify(settings.texify);
        case "LLM":
            return new AIModelConverter(isMultiline, settings, "latex");
        default:
            throw new Error(`Unknown LaTeX provider: ${settings.latexProvider}`);
    }
}

/**
 * 获取 Markdown Provider
 * @param settings OCR 设置
 * @returns OCR Provider 实例
 */
export function getMarkdownProvider(settings: OCRSettings): OCRProvider {
    switch (settings.markdownProvider) {
        case "Texify":
            return new Texify(settings.texify);
        case "LLM":
            return new AIModelConverter(false, settings, "markdown");
        default:
            throw new Error(`Unknown Markdown provider: ${settings.markdownProvider}`);
    }
}