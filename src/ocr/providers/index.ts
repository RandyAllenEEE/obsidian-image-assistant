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
import { App } from "obsidian"; // Ensure App is imported
// ... imports

/**
 * 获取 LaTeX Provider
 * @param app Obsidian App instance
 * @param isMultiline 是否多行模式
 * @param settings OCR 设置
 * @returns OCR Provider 实例
 */
export function getLatexProvider(
    app: App,
    isMultiline: boolean,
    settings: OCRSettings
): OCRProvider {
    switch (settings.latexProvider) {
        case "SimpleTex":
            return new SimpleTex(app, isMultiline, settings);
        case "Pix2Tex":
            return new Pic2Tex(isMultiline, settings);
        case "Texify":
            return new Texify(settings.texify);
        case "LLM":
            return new AIModelConverter(app, isMultiline, settings, "latex");
        default:
            throw new Error(`Unknown LaTeX provider: ${settings.latexProvider}`);
    }
}

/**
 * 获取 Markdown Provider
 * @param app Obsidian App instance
 * @param settings OCR 设置
 * @returns OCR Provider 实例
 */
export function getMarkdownProvider(app: App, settings: OCRSettings): OCRProvider {
    switch (settings.markdownProvider) {
        case "Texify":
            return new Texify(settings.texify);
        case "LLM":
            return new AIModelConverter(app, false, settings, "markdown");
        default:
            throw new Error(`Unknown Markdown provider: ${settings.markdownProvider}`);
    }
}