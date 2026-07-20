import { basename, join } from "path-browserify";
import { requestUrl, normalizePath, FileSystemAdapter, TFile } from "obsidian";

import { bufferToArrayBuffer } from "../../utils";
import { payloadGenerator } from "../../payloadGenerator";

import type ImageConverterPlugin from "../../main";
import type { Image, Response, Uploader } from "./types";
import type { CloudUploadSettings } from "../../settings/types";
import { withTimeout } from "../../utils/NetworkRequestUtils";
import type { UploadRecord } from "../../utils/UploadHistoryManager";
import { detectImageBinaryType } from "../../utils/ImageBinaryType";
import { StreamingImageFetcher } from "../../utils/StreamingImageFetcher";

const CLOUD_REQUEST_TIMEOUT_MS = 60_000;

interface PicGoResponse {
  success?: unknown;
  message?: unknown;
  msg?: unknown;
  result?: unknown;
  fullResult?: unknown;
}

export default class PicGoUploader implements Uploader {
  settings: CloudUploadSettings;
  plugin: ImageConverterPlugin;

  constructor(
    plugin: ImageConverterPlugin,
    private readonly imageFetcher = new StreamingImageFetcher()
  ) {
    this.plugin = plugin;
    this.settings = plugin.settings.pasteHandling.cloud;
  }

  private async uploadFiles(fileList: Array<Image | string>) {
    let response: Awaited<ReturnType<typeof requestUrl>>;

    if (this.settings.remoteServerMode) {
      const files = [];
      for (let i = 0; i < fileList.length; i++) {
        files.push(await this.toRemoteUploadFile(fileList[i], i));
      }
      response = await this.uploadFileByData(files);
    } else {
      const basePath = (
        this.plugin.app.vault.adapter as FileSystemAdapter
      ).getBasePath();

      const list = fileList.map(item => {
        if (typeof item === "string") {
          return item;
        } else {
          return normalizePath(join(basePath, item.path));
        }
      });

      response = await withTimeout(
        requestUrl({
          url: this.settings.uploadServer,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ list: list }),
        }),
        CLOUD_REQUEST_TIMEOUT_MS,
        "Cloud upload"
      );
    }

    return this.handleResponse(response);
  }

  private async toRemoteUploadFile(input: Image | string, index: number): Promise<File> {
    if (typeof input !== "string") {
      const sourceFile = input.file;
      if (!sourceFile) throw new Error(`Missing Vault file for upload: ${input.path}`);
      const data = await this.plugin.app.vault.readBinary(sourceFile);
      return this.createDetectedUploadFile(data, input.name || sourceFile.name);
    }

    if (/^https?:\/\//i.test(input)) {
      const response = await this.imageFetcher.fetch(input);

      const detected = await detectImageBinaryType(response.data);
      if (!detected) throw new Error("Remote URL did not return a recognized image");

      const contentType = (this.getResponseHeader(response.headers, "content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (contentType && !contentType.startsWith("image/") && contentType !== "application/octet-stream") {
        console.warn(
          `[PicGo] Server declared ${contentType}; using verified ${detected.mime} bytes instead.`
        );
      }

      const pathname = new URL(input).pathname;
      const encodedName = basename(pathname);
      let decodedName = encodedName;
      try {
        decodedName = decodeURIComponent(encodedName);
      } catch {
        // Keep the encoded basename when the server accepts a malformed escape sequence.
      }
      const stem = decodedName.replace(/\.[^/.]+$/, "").replace(/[\\/:*?"<>|]/g, "-") || `remote-${index}`;
      return new File([response.data], `${stem}.${detected.ext}`, { type: detected.mime });
    }

    const vaultPath = normalizePath(input);
    const vaultFile = this.plugin.app.vault.getAbstractFileByPath(vaultPath);
    if (vaultFile instanceof TFile) {
      const data = await this.plugin.app.vault.readBinary(vaultFile);
      return this.createDetectedUploadFile(data, vaultFile.name);
    }

    if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(input)) {
      throw new Error(`Upload path is neither a Vault file nor an absolute path: ${input}`);
    }

    const { readFile } = require("fs/promises") as typeof import("fs/promises");
    const buffer = await readFile(input);
    return this.createDetectedUploadFile(bufferToArrayBuffer(buffer), basename(input));
  }

  private async createDetectedUploadFile(data: ArrayBuffer, preferredName: string): Promise<File> {
    const detected = await detectImageBinaryType(data);
    if (!detected) {
      throw new Error(`Upload input did not contain a recognized image: ${preferredName}`);
    }

    const originalName = basename(preferredName);
    const stem = originalName.replace(/\.[^/.]+$/, "") || "image";
    return new File([data], `${stem}.${detected.ext}`, { type: detected.mime });
  }

  private getResponseHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
    if (!headers) return undefined;
    return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  }

  private async uploadFileByData(fileList: FileList | File[]) {
    const payload_data: {
      [key: string]: (string | Blob | ArrayBuffer | File)[];
    } = {
      list: [],
    };

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      payload_data["list"].push(file);
    }

    const [request_body, boundary_string] = await payloadGenerator(
      payload_data
    );

    const options = {
      method: "POST",
      url: this.settings.uploadServer,
      contentType: `multipart/form-data; boundary=----${boundary_string}`,
      body: request_body,
    };
    const response = await withTimeout(
      requestUrl(options),
      CLOUD_REQUEST_TIMEOUT_MS,
      "Cloud upload"
    );

    return response;
  }

  // src/uploader/picgo.ts

  private async uploadFileByClipboard(fileList?: FileList): Promise<any> {
    // 1. 安全检查：如果 fileList 是空的，直接返回错误，防止后续代码报错
    if (!fileList || fileList.length === 0) {
      return {
        success: false,
        msg: "No files found in clipboard",
        result: [],
      };
    }

    let res: Awaited<ReturnType<typeof requestUrl>>;

    if (this.settings.remoteServerMode) {
      const files = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const arrayBuffer = await file.arrayBuffer();
        files.push(await this.createDetectedUploadFile(arrayBuffer, file.name || `clipboard-${i}`));
      }
      res = await this.uploadFileByData(files);
    } else {
      res = await withTimeout(
        requestUrl({
          url: this.settings.uploadServer,
          method: "POST",
        }),
        CLOUD_REQUEST_TIMEOUT_MS,
        "Cloud upload"
      );
    }
    return this.handleResponse(res);
  }
  /**
   * 处理返回值
   */
  private async handleResponse(
    response: Awaited<ReturnType<typeof requestUrl>>
  ): Promise<Response> {
    const rawData: unknown = await response.json;
    if (!this.isRecord(rawData)) {
      return { success: false, msg: "Cloud upload returned an invalid response", result: [] };
    }
    const data = rawData as PicGoResponse;
    const message = this.getResponseMessage(data);

    if (response.status < 200 || response.status >= 300) {
      console.error(response, data);
      return {
        success: false,
        msg: message,
        result: [],
      };
    }
    if (data.success === false) {
      console.error(response, data);
      return {
        success: false,
        msg: message,
        result: [],
      };
    }

    const result = this.getResultUrls(data.result);
    if (result.length === 0) {
      return {
        success: false,
        msg: message || "Cloud upload returned no image URL",
        result: [],
      };
    }

    // piclist
    if (Array.isArray(data.fullResult)) {
      for (const record of data.fullResult) {
        if (!this.isRecord(record) || typeof record.url !== "string" || !this.isHttpUrl(record.url)) continue;
        try {
          await this.plugin.historyManager.addRecord(record as UploadRecord);
        } catch (error) {
          console.error("[PicGo] Uploaded image history could not be saved:", error);
        }
      }
    }

    return {
      success: true,
      msg: "success",
      result,
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private getResponseMessage(data: PicGoResponse): string | undefined {
    if (typeof data.msg === "string" && data.msg.trim()) return data.msg;
    if (typeof data.message === "string" && data.message.trim()) return data.message;
    return undefined;
  }

  private getResultUrls(value: unknown): string[] {
    if (typeof value === "string") return this.isHttpUrl(value) ? [value.trim()] : [];
    if (!Array.isArray(value)) return [];
    return value.filter((url): url is string => typeof url === "string" && this.isHttpUrl(url))
      .map(url => url.trim());
  }

  private isHttpUrl(value: string): boolean {
    try {
      const parsed = new URL(value.trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  async upload(fileList: Array<Image | string>) {
    return this.uploadFiles(fileList);
  }
  async uploadByClipboard(fileList?: FileList) {
    return this.uploadFileByClipboard(fileList);
  }
}
