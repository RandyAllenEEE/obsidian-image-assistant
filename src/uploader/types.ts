import type { TFile } from "obsidian";

export interface Image {
  path: string;
  name: string;
  source: string;
  file?: TFile | null;
}

export interface Response {
  success: boolean;
  msg?: string;
  result: string[];
}

export interface Uploader {
  upload(fileList: Array<Image> | Array<string>): Promise<Response>;
  uploadByClipboard(fileList?: FileList): Promise<Response>;
}
