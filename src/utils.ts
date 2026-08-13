import { isHttpUrl } from "./utils/NetworkPolicy";

export function getLastImage(list: string[]) {
  for (let index = list.length - 1; index >= 0; index--) {
    const item = list[index]?.trim();
    if (item && isHttpUrl(item)) return item;
  }
  return undefined;
}

export function bufferToArrayBuffer(buffer: Buffer) {
  if (buffer.byteLength === buffer.buffer.byteLength && buffer.byteOffset === 0) {
    return buffer.buffer as ArrayBuffer;
  }
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
