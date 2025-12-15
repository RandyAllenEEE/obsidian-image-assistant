// OCR Provider 抽象接口
export interface OCRProvider {
    sendRequest(image: Uint8Array): Promise<string>;
}

// OCR 设置接口
export interface OCRSettings {
    simpleTexToken: string;
    latexProvider: "SimpleTex" | "Pix2Tex" | "Texify" | "LLM";
    markdownProvider: "Texify" | "LLM";
    texify: {
        url: string;
        username: string;
        password: string;
    };
    pix2tex: {
        url: string;
        username: string;
        password: string;
    };
    aiModel: {
        endpoint: string;
        model: string;
        apiKey: string;
        maxTokens: number;
        prompts: {
            latex: string;
            markdown: string;
        };
    };
}

// 默认 OCR 设置
export const DEFAULT_OCR_SETTINGS: OCRSettings = {
    simpleTexToken: "",
    latexProvider: "SimpleTex",
    markdownProvider: "Texify",
    texify: {
        url: "http://127.0.0.1:5000/predict",
        username: "",
        password: ""
    },
    pix2tex: {
        url: "http://127.0.0.1:8502/predict/",
        username: "",
        password: ""
    },
    aiModel: {
        endpoint: "",
        model: "",
        apiKey: "",
        maxTokens: 300,
        prompts: {
            latex: "Convert the math equation in the image to LaTeX format. Output only the LaTeX code without wrapping $ or $$.",
            markdown: "Convert the content in the image to Markdown format."
        }
    }
};
