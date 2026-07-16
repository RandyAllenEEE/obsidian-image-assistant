// OCR Provider 抽象接口
export interface OCRProvider {
    sendRequest(image: Uint8Array): Promise<string>;
}

// OCR 设置接口
export interface OCRSettings {
    latexProvider: "SimpleTex" | "Pix2Tex" | "Texify" | "LLM";
    markdownProvider: "Texify" | "LLM";
    simpleTex: {
        appIdSecretId: string;
        appSecretSecretId: string;
        tokenSecretId: string;
    };
    texify: {
        url: string;
        username: string;
        passwordSecretId: string;
    };
    pix2tex: {
        url: string;
        username: string;
        passwordSecretId: string;
    };
    aiModel: {
        providerType: "openai" | "ollama";
        endpoint: string;
        model: string;
        maxTokens: number;
        apiKeySecretId: string;
        prompts: {
            latex: string;
            markdown: string;
        };
    };
}

// 默认 OCR 设置
export const DEFAULT_OCR_SETTINGS: OCRSettings = {
    latexProvider: "SimpleTex",
    markdownProvider: "Texify",
    simpleTex: {
        appIdSecretId: "",
        appSecretSecretId: "",
        tokenSecretId: ""
    },
    texify: {
        url: "http://127.0.0.1:5000/predict",
        username: "",
        passwordSecretId: ""
    },
    pix2tex: {
        url: "http://127.0.0.1:8502/predict/",
        username: "",
        passwordSecretId: ""
    },
    aiModel: {
        providerType: "openai",
        endpoint: "",
        model: "",
        maxTokens: 300,
        apiKeySecretId: "",
        prompts: {
            latex: "Convert the math equation in the image to LaTeX format. Output only the LaTeX code without wrapping $ or $$.",
            markdown: "Convert the content in the image to Markdown format."
        }
    }
};
