import { requestUrl, RequestUrlParam } from "obsidian";
import { OCRSettings } from "../OCRSettings";
import TexWrapper from "./tex-wrapper";
// 建议使用 'js-md5' 库，或者根据你现有的 crypto 实现
// import md5 from 'js-md5'; 
import * as crypto from 'crypto'; 

export default class SimpleTex extends TexWrapper {
    settings: OCRSettings;

    constructor(isMultiline: boolean, settings: OCRSettings) {
        super(isMultiline);
        this.settings = settings;
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
        // 1. 生成随机 Boundary
        const boundary = "----SimpleTexBoundary" + this.randomStr(16);
        
        // 2. 准备鉴权 Header
        let headers: Record<string, string> = {
            "Content-Type": `multipart/form-data; boundary=${boundary}`
        };

        // 鉴权逻辑
        if (this.settings.simpleTexAppId && this.settings.simpleTexAppSecret) {
            const timestamp = Math.floor(Date.now() / 1000).toString();
            const rStr = this.randomStr(16);
            const reqData = {}; // 目前没有额外的非文件参数
            const sign = this.generateSignature(reqData, this.settings.simpleTexAppId, this.settings.simpleTexAppSecret, timestamp, rStr);
            
            headers["app-id"] = this.settings.simpleTexAppId;
            headers["timestamp"] = timestamp;
            headers["random-str"] = rStr;
            headers["sign"] = sign;
        } else if (this.settings.simpleTexToken) {
            headers["token"] = this.settings.simpleTexToken;
        } else {
            throw new Error("SimpleTeX authentication not configured.");
        }

        // 3. 手动构建 Multipart Body
        // requestUrl 不支持 FormData 对象，必须手动拼接二进制流
        const encoder = new TextEncoder();
        
        const prePayload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`;
        const postPayload = `\r\n--${boundary}--`;

        const bodyBuffer = this.mergeArrays([
            encoder.encode(prePayload),
            image, // 图片原始二进制数据
            encoder.encode(postPayload)
        ]);

        // 4. 使用 Obsidian 的 requestUrl 发送请求 (绕过 CORS)
        try {
            const response = await requestUrl({
                url: "https://server.simpletex.cn/api/latex_ocr_turbo",
                method: "POST",
                headers: headers,
                body: bodyBuffer.buffer as ArrayBuffer // 将 Uint8Array 转回 ArrayBuffer
            });

            if (response.status !== 200) {
                throw new Error(`HTTP Error ${response.status}: ${response.text}`);
            }

            const data = response.json;
            
            if (data.status === false) {
                const errorMsg = data.err_info?.err_msg || "Unknown error";
                throw new Error(`SimpleTex API Error: ${errorMsg}`);
            }

            if (!data.res || !data.res.latex) {
                // 容错处理
                if (data.res && data.res.err_info) {
                    throw new Error(`SimpleTex server error: ${data.res.err_info.err_msg}`);
                }
                throw new Error('Identification success but no LaTeX returned');
            }

            return data.res.latex;

        } catch (error) {
            console.error("SimpleTex Request Failed:", error);
            throw error;
        }
    }
}
