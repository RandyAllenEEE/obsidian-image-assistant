import { requestUrl, App } from "obsidian";
import { OCRSettings } from "../OCRSettings";
import TexWrapper from "./tex-wrapper";
// 建议使用 'js-md5' 库，或者根据你现有的 crypto 实现
// import md5 from 'js-md5'; 
import * as crypto from 'crypto';
import { withTimeout } from "../../utils/NetworkRequestUtils";
import { createOcrImagePayload } from "./ImagePayload";

export default class SimpleTex extends TexWrapper {
    settings: OCRSettings;
    app: App;

    constructor(app: App, isMultiline: boolean, settings: OCRSettings) {
        super(isMultiline);
        this.app = app;
        this.settings = settings;
    }

    private async getSecret(secretId?: string): Promise<string | null> {
        const secretStorage = (this.app as any).secretStorage;
        if (!secretStorage || !secretId) return null;

        const value = await secretStorage.getSecret(secretId);
        return typeof value === "string" && value.length > 0 ? value : null;
    }

    private randomStr(randomlength = 16) {
        let result = '';
        const chars = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789';
        const length = chars.length;
        for (let i = 0; i < randomlength; i++) {
            result += chars.charAt(Math.floor(Math.random() * length));
        }
        return result;
    }

    private generateSignature(reqData: Record<string, string>, appId: string, secret: string, timestamp: string, randomStr: string): string {
        const headerParams: Record<string, string> = {
            "app-id": appId,
            "random-str": randomStr,
            "timestamp": timestamp
        };
        const mergedParams = { ...reqData, ...headerParams };
        const sortedKeys = Object.keys(mergedParams).sort();
        let preSignString = "";
        for (let i = 0; i < sortedKeys.length; i++) {
            const key = sortedKeys[i];
            if (i > 0) preSignString += "&";
            preSignString += `${key}=${mergedParams[key]}`;
        }
        preSignString += "&secret=" + secret;

        // 注意：如果在移动端运行，这里需要用 js-md5 库替换 node crypto
        return crypto.createHash('md5').update(preSignString).digest('hex');
    }

    /**
     * 辅助函数：将多个 Uint8Array 合并为一个
     */
    private mergeArrays(arrays: Uint8Array[]): Uint8Array {
        let totalLength = 0;
        for (const arr of arrays) {
            totalLength += arr.length;
        }
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const arr of arrays) {
            result.set(arr, offset);
            offset += arr.length;
        }
        return result;
    }

    async getTex(image: Uint8Array): Promise<string> {
        const imagePayload = await createOcrImagePayload(image);
        // 1. 生成随机 Boundary
        const boundary = "----SimpleTexBoundary" + this.randomStr(16);

        // 2. 准备鉴权 Header
        const headers: Record<string, string> = {
            "Content-Type": `multipart/form-data; boundary=${boundary}`
        };

        // Retrieve secrets from SecretStorage using linked IDs in settings
        const appId = await this.getSecret(this.settings.simpleTex.appIdSecretId);
        const appSecret = await this.getSecret(this.settings.simpleTex.appSecretSecretId);
        const token = await this.getSecret(this.settings.simpleTex.tokenSecretId);

        // 鉴权逻辑
        if (appId && appSecret) {
            const timestamp = Math.floor(Date.now() / 1000).toString();
            const rStr = this.randomStr(16);
            const reqData = {}; // 目前没有额外的非文件参数
            const sign = this.generateSignature(reqData, appId, appSecret, timestamp, rStr);

            headers["app-id"] = appId;
            headers["timestamp"] = timestamp;
            headers["random-str"] = rStr;
            headers["sign"] = sign;
        } else if (token) {
            headers["token"] = token;
        } else {
            throw new Error("SimpleTeX authentication not configured.");
        }

        // 3. 手动构建 Multipart Body
        // requestUrl 不支持 FormData 对象，必须手动拼接二进制流
        const encoder = new TextEncoder();

        const prePayload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${imagePayload.fileName}"\r\nContent-Type: ${imagePayload.mimeType}\r\n\r\n`;
        const postPayload = `\r\n--${boundary}--\r\n`;

        const bodyBuffer = this.mergeArrays([
            encoder.encode(prePayload),
            new Uint8Array(imagePayload.data),
            encoder.encode(postPayload)
        ]);

        // 4. 使用 Obsidian 的 requestUrl 发送请求 (绕过 CORS)
        try {
            const response = await withTimeout(
                requestUrl({
                    url: "https://server.simpletex.cn/api/latex_ocr_turbo",
                    method: "POST",
                    headers: headers,
                    body: bodyBuffer.buffer as ArrayBuffer // 将 Uint8Array 转回 ArrayBuffer
                }),
                120_000,
                "SimpleTex OCR"
            );

            if (response.status < 200 || response.status >= 300) {
                const detail = typeof response.text === "string" ? response.text.trim().slice(0, 300) : "";
                throw new Error(`HTTP Error ${response.status}${detail ? `: ${detail}` : ""}`);
            }

            const data: unknown = response.json;
            if (typeof data !== "object" || data === null || Array.isArray(data)) {
                throw new Error("SimpleTex returned an invalid response");
            }
            const payload = data as {
                status?: unknown;
                err_info?: { err_msg?: unknown };
                res?: { latex?: unknown; err_info?: { err_msg?: unknown } };
            };

            if (payload.status === false) {
                const errorMsg = typeof payload.err_info?.err_msg === "string"
                    ? payload.err_info.err_msg
                    : "Unknown error";
                throw new Error(`SimpleTex API Error: ${errorMsg}`);
            }

            if (!payload.res || typeof payload.res.latex !== "string" || !payload.res.latex.trim()) {
                // 容错处理
                if (typeof payload.res?.err_info?.err_msg === "string") {
                    throw new Error(`SimpleTex server error: ${payload.res.err_info.err_msg}`);
                }
                throw new Error('Identification success but no LaTeX returned');
            }

            return payload.res.latex.trim();

        } catch (error) {
            console.error("SimpleTex Request Failed:", error);
            throw error;
        }
    }
}
