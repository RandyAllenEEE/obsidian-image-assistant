import { Platform, Notice } from "obsidian";

import PicGoUploader from "./picgo";
import PicGoCoreUploader from "./picgoCore";

import type ImageConverterPlugin from "../../main";
import type { Image } from "./types";

export function getUploader(uploader: string) {
  switch (uploader) {
    case "PicGo":
    case "PicList": // PicList uses the same protocol as PicGo
      return PicGoUploader;
    case "PicGo-Core":
      return PicGoCoreUploader;
    default:
      throw new Error("Invalid uploader");
  }
}

export class UploaderManager {
  uploader: PicGoUploader | PicGoCoreUploader;
  plugin: ImageConverterPlugin;

  constructor(uploader: string, plugin: ImageConverterPlugin) {
    this.plugin = plugin;
    const Uploader = getUploader(uploader);
    this.uploader = new Uploader(this.plugin);
  }

  async upload(fileList: Array<string> | Array<Image>) {
    if (Platform.isMobileApp && !this.plugin.settings.pasteHandling.cloud.remoteServerMode) {
      new Notice("Mobile App must use remote server mode.");
      throw new Error("Mobile App must use remote server mode.");
    }

    const res = await this.uploader.upload(fileList);
    if (!res.success) {
      new Notice(res.msg || "Upload Failed");
      throw new Error(res.msg || "Upload Failed");
    }

    return res;
  }
  async uploadByClipboard(fileList?: FileList) {
    if (Platform.isMobileApp && !this.plugin.settings.pasteHandling.cloud.remoteServerMode) {
      new Notice("Mobile App must use remote server mode.");
      throw new Error("Mobile App must use remote server mode.");
    }

    const res = await this.uploader.uploadByClipboard(fileList);
    if (!res.success) {
      new Notice(res.msg || "Upload Failed");
      throw new Error(res.msg || "Upload Failed");
    }

    return res;
  }
}

export type Uploader = PicGoUploader | PicGoCoreUploader;
export { PicGoUploader, PicGoCoreUploader };
