import { join } from "path-browserify";
import crossSpawn from "cross-spawn";

import { getLastImage } from "../../utils";
import { normalizePath, FileSystemAdapter } from "obsidian";

import type ImageConverterPlugin from "../../main";
import type { Image, Uploader } from "./types";
import type { CloudUploadSettings } from "../../settings/types";

const PICGO_CORE_TIMEOUT_MS = 60_000;

export default class PicGoCoreUploader implements Uploader {
  settings: CloudUploadSettings;
  plugin: ImageConverterPlugin;

  constructor(plugin: ImageConverterPlugin) {
    this.settings = plugin.settings.pasteHandling.cloud;
    this.plugin = plugin;
  }

  private async uploadFiles(fileList: Array<Image | string>) {
    if (fileList.length === 0) {
      return {
        success: false,
        msg: "No files were provided for upload",
        result: [] as string[],
      };
    }

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

    const length = list.length;
    const executable = this.settings.picgoCorePath?.trim() || "picgo";
    const res = await this.exec(executable, ["upload", ...list]);
    const data = res
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => /^https?:\/\//i.test(line))
      .slice(-length);

    if (res.includes("PicGo ERROR") || data.length !== length) {
      return {
        success: false,
        msg: "失败",
        result: [] as string[],
      };
    } else {
      return {
        success: true,
        result: data,
      };
    }
  }

  // PicGo-Core 上传处理
  private async uploadFileByClipboard() {
    const res = await this.uploadByClip();
    const splitList = res.split("\n");
    const lastImage = getLastImage(splitList);

    if (lastImage) {
      return {
        success: true,
        msg: "success",
        result: [lastImage],
      };
    } else {
      return {
        success: false,
        msg: `"Please check PicGo-Core config"\n${res}`,
        result: [],
      };
    }
  }

  // PicGo-Core的剪切上传反馈
  private async uploadByClip() {
    const executable = this.settings.picgoCorePath?.trim() || "picgo";
    return this.exec(executable, ["upload"]);
  }

  private async exec(executable: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = crossSpawn(executable, args, {
        shell: false,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch (error) {
          console.warn("[PicGo-Core] Failed to terminate the timed-out process:", error);
        } finally {
          finish(() => reject(new Error(`PicGo-Core timed out after ${PICGO_CORE_TIMEOUT_MS / 1000} seconds`)));
        }
      }, PICGO_CORE_TIMEOUT_MS);

      child.stdout?.on("data", chunk => { stdout += chunk.toString(); });
      child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
      child.once("error", error => finish(() => reject(error)));
      child.once("close", code => {
        finish(() => {
          if (code === 0) resolve(stdout);
          else reject(new Error(`PicGo-Core exited with code ${code}: ${stderr.trim()}`));
        });
      });
    });
  }

  async upload(fileList: Array<Image | string>) {
    return this.uploadFiles(fileList);
  }
  async uploadByClipboard(fileList?: FileList) {
    return this.uploadFileByClipboard();
  }
}
