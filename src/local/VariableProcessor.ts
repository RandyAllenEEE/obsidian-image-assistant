// VariableProcessor.ts
import { App, TFile } from "obsidian";
import { ImageAssistantSettings } from "../settings/types";
import { loadImage } from "../utils/ImageLoadUtils";
import { detectImageBinaryType } from "../utils/ImageBinaryType";
import { sha256Hex } from "../utils/BinaryHash";
import {
    NamingTemplateEngine,
    TemplateEvaluationError,
    type TemplateToken
} from "./NamingTemplateEngine";
import { NamingCounterStore } from "./NamingCounterStore";


export interface VariableContext {
    file: TFile | File;
    activeFile: TFile;
}

export interface NamingOperationContext extends VariableContext {
    readonly nowMs?: number;
    readonly quality?: number;
}

export interface NamingEvaluationOptions {
    readonly counterScope?: string;
}

interface NamingSessionState {
    readonly context: NamingOperationContext;
    readonly nowMs: number;
    readonly cache: Map<string, Promise<string>>;
    metadata?: Promise<Record<string, string>>;
    fileStats?: Promise<{ size: number }>;
    fileContent?: Promise<ArrayBuffer>;
    momentValue?: any;
}

// --- Variable List ---
export interface VariableInfo {
    name: string;
    description: string;
    example: string;
}

export class NamingEvaluationSession {
    private readonly state: NamingSessionState;

    constructor(
        private readonly processor: VariableProcessor,
        context: NamingOperationContext
    ) {
        const { moment } = window as typeof window & {
            moment?: (value?: number) => { valueOf?: () => number };
        };
        const momentValue = moment?.(context.nowMs);
        const momentTime = Number(momentValue?.valueOf?.());
        this.state = {
            context,
            nowMs: context.nowMs
                ?? (Number.isFinite(momentTime) ? momentTime : Date.now()),
            cache: new Map(),
            momentValue
        };
    }

    evaluate(
        template: string,
        options: NamingEvaluationOptions = {}
    ): Promise<string> {
        return this.processor.evaluateSessionTemplate(
            template,
            this.state,
            options
        );
    }
}

/**
 * MD5 hash function implementation.
 * Note: Web Crypto API does not support MD5, so this pure JS implementation is required.
 * This is used for non-cryptographic purposes (file naming) where MD5's properties are useful.
 */
function md5(string: string): string {

    function rotateLeft(value: number, shift: number): number {
        return (value << shift) | (value >>> (32 - shift));
    }

    function addUnsigned(lX: number, lY: number): number {
        const lX8 = lX & 0x80000000;
        const lY8 = lY & 0x80000000;
        const lX4 = lX & 0x40000000;
        const lY4 = lY & 0x40000000;
        const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);

        if (lX4 & lY4) {
            return lResult ^ 0x80000000 ^ lX8 ^ lY8;
        }
        if (lX4 | lY4) {
            if (lResult & 0x40000000) {
                return lResult ^ 0xC0000000 ^ lX8 ^ lY8;
            }
            return lResult ^ 0x40000000 ^ lX8 ^ lY8;
        }
        return lResult ^ lX8 ^ lY8;
    }

    function F(x: number, y: number, z: number): number {
        return (x & y) | ((~x) & z);
    }

    function G(x: number, y: number, z: number): number {
        return (x & z) | (y & (~z));
    }

    function H(x: number, y: number, z: number): number {
        return x ^ y ^ z;
    }

    function I(x: number, y: number, z: number): number {
        return y ^ (x | (~z));
    }

    function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
        a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b);
    }

    function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
        a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b);
    }

    function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
        a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b);
    }

    function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
        a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b);
    }

    function convertToWordArray(bytes: Uint8Array): number[] {
        const lMessageLength = bytes.length;
        const lNumberOfWordsTemp1 = lMessageLength + 8;
        const lNumberOfWordsTemp2 = (lNumberOfWordsTemp1 - (lNumberOfWordsTemp1 % 64)) / 64;
        const lNumberOfWords = (lNumberOfWordsTemp2 + 1) * 16;
        const lWordArray: number[] = Array(lNumberOfWords - 1);
        let lBytePosition = 0;
        let lByteCount = 0;

        while (lByteCount < lMessageLength) {
            const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
            lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] = (lWordArray[lWordCount] || 0)
                | (bytes[lByteCount] << lBytePosition);
            lByteCount++;
        }

        const lWordCount = (lByteCount - (lByteCount % 4)) / 4;
        lBytePosition = (lByteCount % 4) * 8;
        lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
        lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
        lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;

        return lWordArray;
    }

    function wordToHex(lValue: number): string {
        let wordToHexValue = "";
        let lByte, lCount;

        for (lCount = 0; lCount <= 3; lCount++) {
            lByte = (lValue >>> (lCount * 8)) & 255;
            const hexPart = `0${lByte.toString(16)}`;
            wordToHexValue = wordToHexValue + hexPart.substr(hexPart.length - 2, 2);
        }

        return wordToHexValue;
    }

    const x = convertToWordArray(new TextEncoder().encode(string));
    let k, AA, BB, CC, DD, a, b, c, d;
    const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
    const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
    const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
    const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

    a = 0x67452301;
    b = 0xEFCDAB89;
    c = 0x98BADCFE;
    d = 0x10325476;

    for (k = 0; k < x.length; k += 16) {
        AA = a;
        BB = b;
        CC = c;
        DD = d;

        a = FF(a, b, c, d, x[k], S11, 0xD76AA478);
        d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
        c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
        b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
        a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
        d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
        c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
        b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
        a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
        d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
        c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
        b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
        a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
        d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
        c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
        b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);

        a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
        d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
        c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
        b = GG(b, c, d, a, x[k], S24, 0xE9B6C7AA);
        a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
        d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
        c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
        b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
        a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
        d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
        c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
        b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
        a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
        d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
        c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
        b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);

        a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
        d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
        c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
        b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
        a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
        d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
        c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
        b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
        a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
        d = HH(d, a, b, c, x[k], S32, 0xEAA127FA);
        c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
        b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
        a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
        d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
        c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
        b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);

        a = II(a, b, c, d, x[k], S41, 0xF4292244);
        d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
        c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
        b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
        a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
        d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
        c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
        b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
        a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
        d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
        c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
        b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
        a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
        d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
        c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
        b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);

        a = addUnsigned(a, AA);
        b = addUnsigned(b, BB);
        c = addUnsigned(c, CC);
        d = addUnsigned(d, DD);
    }

    return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();

}

export class VariableProcessor {
    private readonly templateEngine = new NamingTemplateEngine();
    private readonly counterStore: NamingCounterStore;

    constructor(
        private app: App,
        private settings: ImageAssistantSettings
    ) {
        this.counterStore = new NamingCounterStore(app);
    }

    // Updated list of all available variables
    private allVariables: VariableInfo[] = [
        // Basic
        {
            name: "{imagename}",
            description: "The original name of the image file (without extension).",
            example: "image123",
        },
        {
            name: "{filetype}",
            description: "The file extension of the image.",
            example: "png",
        },
        {
            name: "{sizeb}",
            description: "The size of the image in bytes.",
            example: "24576",
        },
        {
            name: "{sizekb}",
            description: "The size of the image in kilobytes (2 decimal places).",
            example: "24.00",
        },
        {
            name: "{sizemb}",
            description: "The size of the image in megabytes (2 decimal places).",
            example: "0.02",
        },
        {
            name: "{notename}",
            description: "The name of the current note.",
            example: "MeetingNotes",
        },
        {
            name: "{notename_nospaces}",
            description: "The name of the current note with spaces replaced by underscores.",
            example: "Meeting_Notes",
        },

        // Date & Time
        {
            name: "{date}",
            description: "The current date (YYYY-MM-DD).",
            example: "2023-12-28",
        },
        {
            name: "{date:FORMAT}",
            description: "The current date in a custom format using Moment.js syntax.",
            example: "{date:YYYY-MM} -> 2023-12",
        },
        {
            name: "{time}",
            description: "The current time (HH-mm-ss).",
            example: "14-30-00",
        },
        {
            name: "{YYYY}",
            description: "The current year.",
            example: "2023",
        },
        {
            name: "{MM}",
            description: "The current month (01-12).",
            example: "12",
        },
        {
            name: "{DD}",
            description: "The current day of the month (01-31).",
            example: "28",
        },
        {
            name: "{HH}",
            description: "The current hour (00-23).",
            example: "14",
        },
        {
            name: "{mm}",
            description: "The current minute (00-59).",
            example: "30",
        },
        {
            name: "{ss}",
            description: "The current second (00-59).",
            example: "00",
        },
        {
            name: "{weekday}",
            description: "The current day of the week.",
            example: "Thursday",
        },
        {
            name: "{month}",
            description: "The current month name.",
            example: "December",
        },
        {
            name: "{calendar}",
            description: "A calendar view of the current date/time.",
            example: "12/28/2023 2:30 PM",
        },
        {
            name: "{today}",
            description: "The current date (YYYY-MM-DD).",
            example: "2023-12-28",
        },
        {
            name: "{YYYY-MM-DD}",
            description: "The current date (YYYY-MM-DD).",
            example: "2023-12-28",
        },
        {
            name: "{tomorrow}",
            description: "Tomorrow's date (YYYY-MM-DD).",
            example: "2023-12-29",
        },
        {
            name: "{yesterday}",
            description: "Yesterday's date (YYYY-MM-DD).",
            example: "2023-12-27",
        },
        {
            name: "{startofweek}",
            description: "The start of the current week (YYYY-MM-DD).",
            example: "2023-12-24",
        },
        {
            name: "{endofweek}",
            description: "The end of the current week (YYYY-MM-DD).",
            example: "2023-12-30",
        },
        {
            name: "{startofmonth}",
            description: "The start of the current month (YYYY-MM-DD).",
            example: "2023-12-01",
        },
        {
            name: "{endofmonth}",
            description: "The end of the current month (YYYY-MM-DD).",
            example: "2023-12-31",
        },
        {
            name: "{nextweek}",
            description: "The date of next week (YYYY-MM-DD).",
            example: "2024-01-04",
        },
        {
            name: "{lastweek}",
            description: "The date of last week (YYYY-MM-DD).",
            example: "2023-12-21",
        },
        {
            name: "{nextmonth}",
            description: "The date of next month (YYYY-MM-DD).",
            example: "2024-01-28",
        },
        {
            name: "{lastmonth}",
            description: "The date of last month (YYYY-MM-DD).",
            example: "2023-11-28",
        },
        {
            name: "{daysinmonth}",
            description: "The number of days in the current month.",
            example: "31",
        },
        {
            name: "{weekofyear}",
            description: "The week number of the current year.",
            example: "52",
        },
        {
            name: "{quarterofyear}",
            description: "The quarter of the current year.",
            example: "4",
        },
        {
            name: "{week}",
            description: "The current week number (alias for {weekofyear}).",
            example: "52",
        },
        {
            name: "{w}",
            description: "The current week number (alias for {weekofyear}).",
            example: "52",
        },
        {
            name: "{quarter}",
            description: "The current quarter (alias for {quarterofyear}).",
            example: "4",
        },
        {
            name: "{Q}",
            description: "The current quarter (alias for {quarterofyear}).",
            example: "4",
        },
        {
            name: "{dayofyear}",
            description: "The day of the year (1-366).",
            example: "362",
        },
        {
            name: "{DDD}",
            description: "The day of the year (1-366).",
            example: "362",
        },
        {
            name: "{monthname}",
            description: "The name of the current month.",
            example: "December",
        },
        {
            name: "{MMMM}",
            description: "The name of the current month.",
            example: "December",
        },
        {
            name: "{dayname}",
            description: "The name of the current day of the week.",
            example: "Thursday",
        },
        {
            name: "{dddd}",
            description: "The name of the current day of the week.",
            example: "Thursday",
        },
        {
            name: "{dateordinal}",
            description: "The current date with ordinal suffix (e.g., 28th).",
            example: "28th",
        },
        {
            name: "{Do}",
            description: "The current date with ordinal suffix (e.g., 28th).",
            example: "28th",
        },
        {
            name: "{relativetime}",
            description: "The relative time from now.",
            example: "in a few seconds",
        },
        {
            name: "{currentdate}",
            description: "The current date (YYYY-MM-DD).",
            example: "2023-12-28",
        },
        {
            name: "{yyyy}",
            description: "The current year.",
            example: "2023",
        },
        {
            name: "{timestamp}",
            description: "The current timestamp in milliseconds.",
            example: "1672234800000",
        },

        // File & Vault
        {
            name: "{vaultname}",
            description: "The name of the vault.",
            example: "MyVault",
        },
        {
            name: "{vaultpath}",
            description: "The root path of the vault.",
            example: "/Users/username/Documents/MyVault",
        },
        {
            name: "{parentfolder}",
            description: "The name of the immediate parent folder of the note.",
            example: "Project",
        },
        {
            name: "{grandparentfolder}",
            description: "Parent of the parent folder of the note, but not the vault root",
            example: "ParentOfProject"
        },
        {
            name: "{notefolder}",
            description: "The name of the immediate parent folder of the note.",
            example: "Project",
        },
        {
            name: "{notepath}",
            description: "The vault path of the current note, including .md.",
            example: "Project/MeetingNotes.md",
        },
        {
            name: "{rootfolder}",
            description: "The vault name.",
            example: "MyVault",
        },
        {
            name: "{imagepath}",
            description: "The source image vault path, or relative File path when available.",
            example: "Project/assets/image.png",
        },
        {
            name: "{fullpath}",
            description: "Alias for {imagepath}.",
            example: "Project/assets/image.png",
        },

        // Image Metadata
        {
            name: "{width}",
            description: "The width of the image in pixels.",
            example: "800",
        },
        {
            name: "{height}",
            description: "The height of the image in pixels.",
            example: "600",
        },
        {
            name: "{aspectratio}",
            description: "The aspect ratio of the image (width/height, 2 decimal places).",
            example: "1.33",
        },
        {
            name: "{orientation}",
            description: "The orientation of the image (landscape, portrait, or square).",
            example: "landscape",
        },
        {
            name: "{resolution}",
            description: "The resolution of the image (width x height).",
            example: "800x600",
        },

        // Calculated Image Properties
        {
            name: "{ratio}",
            description: "The aspect ratio of the image, same as {aspectratio}.",
            example: "1.33",
        },
        {
            name: "{quality}",
            description: "The quality setting for image conversion/compression.",
            example: "75",
        },
        {
            name: "{megapixels}",
            description: "The size of the image in megapixels (2 decimal places).",
            example: "0.48",
        },
        {
            name: "{issquare}",
            description: "Whether the image is a perfect square (true/false).",
            example: "false",
        },
        {
            name: "{pixelcount}",
            description: "The total number of pixels in the image.",
            example: "480000",
        },
        {
            name: "{aspectratiotype}",
            description: "A common aspect ratio category (e.g., 4:3, 16:9, custom).",
            example: "4:3",
        },
        {
            name: "{resolutioncategory}",
            description: "A category based on pixel count (tiny, small, medium, large, very-large).",
            example: "small",
        },
        {
            name: "{filesizecategory}",
            description: "A category based on file size (e.g., 0-50KB, 51-200KB, etc.).",
            example: "0-50KB",
        },
        {
            name: "{dominantdimension}",
            description: "Whether the width or height is larger, or if they are equal.",
            example: "width",
        },
        {
            name: "{dimensiondifference}",
            description: "The absolute difference between width and height.",
            example: "200",
        },
        {
            name: "{bytesperpixel}",
            description: "The average number of bytes per pixel (2 decimal places).",
            example: "0.50",
        },
        {
            name: "{compressionratio}",
            description: "An estimate of the image compression ratio (2 decimal places).",
            example: "0.33",
        },
        {
            name: "{maxdimension}",
            description: "The larger dimension (width or height) of the image.",
            example: "800",
        },
        {
            name: "{mindimension}",
            description: "The smaller dimension (width or height) of the image.",
            example: "600",
        },
        {
            name: "{diagonalpixels}",
            description: "The diagonal pixel length of the image.",
            example: "1000",
        },
        {
            name: "{aspectratiosimplified}",
            description: "The aspect ratio in its simplest whole number form.",
            example: "4:3",
        },
        {
            name: "{screenfitcategory}",
            description: "A category based on whether the image fits within common screen sizes (e.g., fits-1080p, fits-1440p, fits-4k, above-4k).",
            example: "fits-1080p",
        },

        // Advanced
        {
            name: "{random}",
            description: "A random alphanumeric string (6 characters).",
            example: "a8f7n2",
        },
        {
            name: "{randomHex:X}",
            description: "A random hexadecimal string of X characters.",
            example: "{randomHex:8} -> 3e4a7f9b",
        },
        {
            name: "{counter:000}",
            description: "A persistent folder-and-template counter. The number of zeros determines padding.",
            example: "{counter:000} -> 005",
        },
        {
            name: "{MD5:type}",
            description: "The full MD5 hash of a named source such as filename, time, fullpath, notename, or notepath.",
            example: "{MD5:time} -> 32-character digest",
        },
        {
            name: "{MD5:type:X}",
            description: "The first X characters of an MD5 digest; X must be 1-32.",
            example: "{MD5:fullpath:10} -> 7a3b9e2c1d",
        },
        {
            name: "{MD5:custom text}",
            description: "The full MD5 hash of a custom text.",
            example: "{MD5:MyCustomText} -> 5f9e2b8a3c7d1f6a4e8b2c9d",
        },
        {
            name: "{size:UNIT:DECIMALS}",
            description: "Image size in a specific unit (B, KB, MB) with custom decimal places.",
            example: "{size:KB:3} -> 24.000",
        },
        {
            name: "{sha256:image}",
            description: "The SHA-256 hash of the image content.",
            example: "{sha256:image} -> full hash, {sha256:image:8} -> e3b0c442",
        },
        {
            name: "{sha256:type}",
            description: "The SHA-256 hash of the specified type. Supports: filename, fullpath, parentfolder, rootfolder, extension, notename, notefolder, notepath.",
            example: "{sha256:filename} -> e3b0c442",
        },
        {
            name: "{sha256:type:X}",
            description: "The first X characters of a SHA-256 digest; X must be 1-64.",
            example: "{sha256:fullpath:10} -> e3b0c44298",
        },
        {
            name: "{uuid}",
            description: "A universally unique identifier (UUID).",
            example: "a1b2c3d4-e5f6-7890-1234-567890abcdef",
        },
    ];

    async processTemplate(
        template: string,
        context: NamingOperationContext
    ): Promise<string> {
        return this.createSession(context).evaluate(template);
    }

    createSession(context: NamingOperationContext): NamingEvaluationSession {
        return new NamingEvaluationSession(this, context);
    }

    async processTemplates(
        templates: readonly string[],
        context: NamingOperationContext,
        options: readonly NamingEvaluationOptions[] = []
    ): Promise<readonly string[]> {
        const session = this.createSession(context);
        const results: string[] = [];
        for (let index = 0; index < templates.length; index++) {
            results.push(await session.evaluate(
                templates[index],
                options[index] ?? {}
            ));
        }
        return Object.freeze(results);
    }

    async evaluateSessionTemplate(
        template: string,
        state: NamingSessionState,
        options: NamingEvaluationOptions
    ): Promise<string> {
        return this.templateEngine.evaluate(template, token =>
            this.resolveToken(token, template, state, options)
        );
    }

    private resolveToken(
        token: TemplateToken,
        template: string,
        state: NamingSessionState,
        options: NamingEvaluationOptions
    ): Promise<string | null> {
        const counter = /^counter:(0+)$/i.exec(token.body);
        const counterLike = /^counter:/i.test(token.body);
        if (counterLike && !counter) {
            throw tokenError(token, "Counter syntax must be {counter:000}.");
        }
        if (counter) {
            const scope = options.counterScope
                ?? state.context.activeFile.parent?.path
                ?? "/";
            const key = `${token.source}:${scope}:${template}`;
            return this.getCached(state, key, () =>
                this.counterStore.reserve(scope, template, counter[1].length)
            );
        }

        return this.getCachedNullable(state, token.source, async () => {
            const direct = await this.resolveDirectToken(token.body, state);
            if (direct !== null) return direct;

            const randomHex = /^randomHex:(\d+)$/i.exec(token.body);
            if (/^randomHex:/i.test(token.body) && !randomHex) {
                throw tokenError(token, "randomHex length must be an integer from 1 to 128.");
            }
            if (randomHex) {
                const length = Number(randomHex[1]);
                if (!Number.isInteger(length) || length < 1 || length > 128) {
                    throw tokenError(token, "randomHex length must be from 1 to 128.");
                }
                return this.generateRandomHex(length);
            }

            const size = /^size:(MB|KB|B):(\d+)$/i.exec(token.body);
            if (/^size:/i.test(token.body) && !size) {
                throw tokenError(token, "Size syntax must be {size:B|KB|MB:DECIMALS}.");
            }
            if (size) {
                const decimals = Number(size[2]);
                if (decimals < 0 || decimals > 10) {
                    throw tokenError(token, "Size decimals must be from 0 to 10.");
                }
                const stats = await this.getFileStats(state);
                return this.formatSize(stats.size, size[1].toUpperCase(), decimals);
            }

            if (/^(?:MD5|sha256):/i.test(token.body)) {
                return this.resolveHashToken(token, state);
            }
            if (/^(?:MD5|sha256)$/i.test(token.body)) {
                throw tokenError(token, "Hash syntax requires a source, for example {MD5:time}.");
            }
            return null;
        });
    }

    private async resolveDirectToken(
        body: string,
        state: NamingSessionState
    ): Promise<string | null> {
        const { file, activeFile } = state.context;
        const key = `{${body}}`;
        const filename = file.name;
        const fileParts = splitFilename(filename);
        const imagePath = file instanceof TFile
            ? file.path
            : (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        const parent = activeFile.parent;
        const grandparent = parent?.parent;
        const { moment } = window as typeof window & { moment?: (value?: number) => any };
        state.momentValue ??= moment?.();
        const now = state.momentValue;

        const staticValues: Record<string, string | undefined> = {
            imagename: fileParts.stem,
            notename: activeFile.basename,
            notename_nospaces: activeFile.basename.replace(/\s+/g, "_"),
            notepath: activeFile.path,
            parentfolder: parent?.name ?? "",
            grandparentfolder: grandparent && grandparent.path !== "/"
                ? grandparent.name
                : "",
            notefolder: parent?.name ?? "",
            vaultname: this.app.vault.getName(),
            rootfolder: this.app.vault.getName(),
            vaultpath: (this.app.vault.adapter as {
                getBasePath?: () => string;
                basePath?: string;
            }).getBasePath?.()
                ?? (this.app.vault.adapter as { basePath?: string }).basePath
                ?? this.app.vault.getRoot().path,
            imagepath: imagePath,
            fullpath: imagePath,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale: navigator.language,
            platform: navigator.platform,
            useragent: navigator.userAgent,
            timestamp: state.nowMs.toString()
        };
        if (Object.prototype.hasOwnProperty.call(staticValues, body)) {
            return staticValues[body] ?? "";
        }
        if (body === "random") return this.generateRandomString();
        if (body === "uuid") return crypto.randomUUID();

        if (body === "filetype") {
            if (fileParts.extension) return fileParts.extension;
            const detected = await this.getDetectedFileType(state);
            if (!detected) {
                throw new Error("The source image type could not be detected.");
            }
            return detected;
        }

        if (["sizeb", "sizekb", "sizemb"].includes(body)) {
            const { size } = await this.getFileStats(state);
            if (body === "sizeb") return size.toString();
            if (body === "sizekb") return (size / 1024).toFixed(2);
            return (size / (1024 * 1024)).toFixed(2);
        }

        const dateValue = this.resolveDateToken(key, body, now);
        if (dateValue !== null) return dateValue;

        const dateFormat = /^date:(.+)$/.exec(body);
        if (dateFormat) {
            if (!now) throw new Error("Moment.js is unavailable.");
            return now.format(dateFormat[1]);
        }
        if (body.startsWith("date:")) {
            throw new Error("Date format cannot be empty.");
        }

        if (isImageMetadataToken(key)) {
            const metadata = await this.getSessionMetadata(state);
            const value = metadata[key];
            if (value === undefined) {
                throw new Error(`Image metadata for ${key} is unavailable.`);
            }
            return value;
        }
        if (body === "quality") {
            return (state.context.quality
                ?? this.settings.localProcessing.conversion.quality).toString();
        }
        return null;
    }

    private resolveDateToken(
        token: string,
        body: string,
        now: any
    ): string | null {
        const formats: Record<string, string> = {
            YYYY: "YYYY",
            MM: "MM",
            DD: "DD",
            HH: "HH",
            mm: "mm",
            ss: "ss",
            date: "YYYY-MM-DD",
            weekday: "dddd",
            month: "MMMM",
            today: "YYYY-MM-DD",
            "YYYY-MM-DD": "YYYY-MM-DD",
            week: "w",
            w: "w",
            quarter: "Q",
            Q: "Q",
            dayofyear: "DDD",
            DDD: "DDD",
            monthname: "MMMM",
            MMMM: "MMMM",
            dayname: "dddd",
            dddd: "dddd",
            dateordinal: "Do",
            Do: "Do",
            currentdate: "YYYY-MM-DD",
            yyyy: "YYYY",
            time: "HH-mm-ss"
        };
        if (Object.prototype.hasOwnProperty.call(formats, body)) {
            if (!now) throw new Error(`Moment.js is unavailable for ${token}.`);
            return now.format(formats[body]);
        }
        if (!now) {
            return [
                "calendar", "tomorrow", "yesterday", "startofweek", "endofweek",
                "startofmonth", "endofmonth", "nextweek", "lastweek",
                "nextmonth", "lastmonth", "daysinmonth", "weekofyear",
                "quarterofyear", "relativetime"
            ].includes(body)
                ? (() => { throw new Error(`Moment.js is unavailable for ${token}.`); })()
                : null;
        }
        switch (body) {
            case "calendar": return now.calendar();
            case "tomorrow": return cloneMoment(now).add(1, "day").format("YYYY-MM-DD");
            case "yesterday": return cloneMoment(now).subtract(1, "day").format("YYYY-MM-DD");
            case "startofweek": return cloneMoment(now).startOf("week").format("YYYY-MM-DD");
            case "endofweek": return cloneMoment(now).endOf("week").format("YYYY-MM-DD");
            case "startofmonth": return cloneMoment(now).startOf("month").format("YYYY-MM-DD");
            case "endofmonth": return cloneMoment(now).endOf("month").format("YYYY-MM-DD");
            case "nextweek": return cloneMoment(now).add(1, "week").format("YYYY-MM-DD");
            case "lastweek": return cloneMoment(now).subtract(1, "week").format("YYYY-MM-DD");
            case "nextmonth": return cloneMoment(now).add(1, "month").format("YYYY-MM-DD");
            case "lastmonth": return cloneMoment(now).subtract(1, "month").format("YYYY-MM-DD");
            case "daysinmonth": return now.daysInMonth().toString();
            case "weekofyear": return now.week().toString();
            case "quarterofyear": return now.quarter().toString();
            case "relativetime": return now.fromNow();
            default: return null;
        }
    }

    private async resolveHashToken(
        token: TemplateToken,
        state: NamingSessionState
    ): Promise<string> {
        const separator = token.body.indexOf(":");
        const algorithm = token.body.slice(0, separator).toLowerCase();
        let source = token.body.slice(separator + 1);
        let length: number | undefined;
        const lengthMatch = /:(\d+)$/.exec(source);
        if (lengthMatch) {
            length = Number(lengthMatch[1]);
            source = source.slice(0, -lengthMatch[0].length);
        }
        const maxLength = algorithm === "md5" ? 32 : 64;
        if (!source) throw tokenError(token, "Hash source cannot be empty.");
        if (length !== undefined
            && (!Number.isInteger(length) || length < 1 || length > maxLength)) {
            throw tokenError(
                token,
                `${algorithm.toUpperCase()} length must be from 1 to ${maxLength}.`
            );
        }

        let digest: string;
        if (algorithm === "sha256" && source.toLowerCase() === "image") {
            digest = await sha256Hex(await this.getFileContent(state));
        } else {
            const text = await this.resolveHashSource(source, state);
            digest = algorithm === "md5"
                ? md5(text)
                : await this.generateSHA256(text);
        }
        return length === undefined ? digest : digest.slice(0, length);
    }

    private async resolveHashSource(
        source: string,
        state: NamingSessionState
    ): Promise<string> {
        const normalized = source.toLowerCase();
        const aliases: Record<string, string> = {
            filename: "imagename",
            extension: "filetype",
            time: "timestamp"
        };
        const canonical = aliases[normalized] ?? normalized;
        const reserved = new Set([
            "imagename", "filetype", "imagepath", "fullpath",
            "parentfolder", "grandparentfolder", "rootfolder",
            "notename", "notename_nospaces", "notefolder", "notepath",
            "vaultname", "vaultpath", "timestamp", "date"
        ]);
        if (canonical === "rootfolder") return this.app.vault.getName();
        if (reserved.has(canonical)) {
            const value = await this.resolveDirectToken(canonical, state);
            if (value === null) {
                throw new Error(`Hash source '${source}' is unavailable.`);
            }
            return value;
        }
        return source;
    }

    private getCached(
        state: NamingSessionState,
        key: string,
        factory: () => Promise<string>
    ): Promise<string> {
        const cached = state.cache.get(key);
        if (cached) return cached;
        const value = factory();
        state.cache.set(key, value);
        return value;
    }

    private async getCachedNullable(
        state: NamingSessionState,
        key: string,
        factory: () => Promise<string | null>
    ): Promise<string | null> {
        const cached = state.cache.get(key);
        if (cached) return cached;
        const value = await factory();
        if (value !== null) state.cache.set(key, Promise.resolve(value));
        return value;
    }

    private getSessionMetadata(
        state: NamingSessionState
    ): Promise<Record<string, string>> {
        state.metadata ??= state.context.file instanceof TFile
            ? Promise.all([
                this.getFileContent(state),
                this.getFileStats(state)
            ]).then(([content, stats]) =>
                this.getImageMetadata(state.context.file, content, stats.size)
            )
            : this.getImageMetadata(state.context.file);
        return state.metadata;
    }

    private getFileStats(state: NamingSessionState): Promise<{ size: number }> {
        state.fileStats ??= (async () => {
            const { file } = state.context;
            if (!(file instanceof TFile)) return { size: file.size };
            const stats = await this.app.vault.adapter.stat(file.path);
            if (!stats) throw new Error(`File stats are unavailable for ${file.path}.`);
            return { size: stats.size };
        })();
        return state.fileStats;
    }

    private getFileContent(state: NamingSessionState): Promise<ArrayBuffer> {
        state.fileContent ??= state.context.file instanceof TFile
            ? this.app.vault.readBinary(state.context.file)
            : state.context.file.arrayBuffer();
        return state.fileContent;
    }

    private async getDetectedFileType(state: NamingSessionState): Promise<string | null> {
        const detected = await detectImageBinaryType(await this.getFileContent(state));
        return detected?.ext ?? null;
    }

    private generateRandomString(): string {
        const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
        const bytes = new Uint8Array(6);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
    }

    /**
     * Validates a template to ensure variables won't resolve to empty strings that would cause issues
     * @param template The template string to validate
     * @param context The variable context containing file and activeFile
     * @returns Object with validation results and any error messages
     */
    validateTemplate(template: string, context: VariableContext): { valid: boolean; errors: string[] } {
        const { activeFile } = context;
        const errors: string[] = [];
        try {
            for (const token of this.templateEngine.parse(template)) {
                const tokenErrorMessage = validateTemplateTokenBody(token.body);
                if (tokenErrorMessage) {
                    errors.push(`${token.source}: ${tokenErrorMessage}`);
                }
            }
        } catch (error) {
            if (error instanceof TemplateEvaluationError) {
                errors.push(...error.diagnostics.map(diagnostic => diagnostic.message));
            } else {
                errors.push(error instanceof Error ? error.message : String(error));
            }
        }

        // Check for {grandparentfolder} usage
        if (template.includes("{grandparentfolder}")) {
            const parentFolder = activeFile.parent;
            const grandparentFolder = parentFolder?.parent;

            // If there's no grandparent or the grandparent is the vault root
            if (!grandparentFolder || grandparentFolder.path === "/") {
                errors.push("Cannot use {grandparentfolder} - the current note has no grandparent folder. Please modify your template.");
            }
        }

        // Check for {parentfolder} usage when note is in vault root
        if (template.includes("{parentfolder}")) {
            const parentFolder = activeFile.parent;

            // If there's no parent or the parent is the vault root
            if (!parentFolder || parentFolder.path === "/") {
                errors.push("Cannot use {parentfolder} - the current note is in the vault root. Please modify your template.");
            }
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    // Expose allVariables publicly
    public getAllVariables(): VariableInfo[] {
        return this.allVariables;
    }
    public getCategorizedVariables(): Record<string, VariableInfo[]> {
        return this.groupVariablesByCategory(this.allVariables);
    }

    // Method to group variables by category (used by AvailableVariablesModal)
    private groupVariablesByCategory(variables: VariableInfo[]): Record<string, VariableInfo[]> {


        const categorized: Record<string, VariableInfo[]> = {
            "Basic": [],
            "Date & Time": [],
            "File & Vault": [],
            "Image Metadata": [],
            "Calculated Image Properties": [],
            "Advanced": []
        };


        for (const variable of variables) {
            if (variable.name.startsWith("{date") || ["{YYYY}", "{MM}", "{DD}", "{HH}", "{mm}", "{ss}", "{weekday}", "{month}", "{calendar}", "{today}", "{YYYY-MM-DD}", "{tomorrow}", "{yesterday}", "{startofweek}", "{endofweek}", "{startofmonth}", "{endofmonth}", "{nextweek}", "{lastweek}", "{nextmonth}", "{lastmonth}", "{daysinmonth}", "{weekofyear}", "{quarterofyear}", "{week}", "{w}", "{quarter}", "{Q}", "{dayofyear}", "{DDD}", "{monthname}", "{MMMM}", "{dayname}", "{dddd}", "{dateordinal}", "{Do}", "{relativetime}", "{currentdate}", "{yyyy}", "{time}", "{timestamp}"].includes(variable.name)) {
                categorized["Date & Time"].push(variable);
            } else if (["{vaultname}", "{vaultpath}", "{parentfolder}", "{grandparentfolder}", "{notefolder}", "{notepath}"].includes(variable.name)) {
                categorized["File & Vault"].push(variable);
            } else if (["{imagename}", "{filetype}", "{sizeb}", "{sizekb}", "{sizemb}", "{notename}", "{notename_nospaces}"].includes(variable.name)) {
                categorized["Basic"].push(variable);
            } else if (["{width}", "{height}", "{aspectratio}", "{orientation}", "{resolution}"].includes(variable.name)) {
                categorized["Image Metadata"].push(variable);
            } else if (["{ratio}", "{quality}", "{megapixels}", "{issquare}", "{pixelcount}", "{aspectratiotype}", "{resolutioncategory}", "{filesizecategory}", "{dominantdimension}", "{dimensiondifference}", "{bytesperpixel}", "{compressionratio}", "{maxdimension}", "{mindimension}", "{diagonalpixels}", "{aspectratiosimplified}", "{screenfitcategory}"].includes(variable.name)) {
                categorized["Calculated Image Properties"].push(variable);
            } else {
                categorized["Advanced"].push(variable);
            }
        }

        return categorized;
    }

    private async getImageMetadata(
        file: TFile | File,
        providedContent?: ArrayBuffer,
        providedSize?: number
    ): Promise<Record<string, string>> {
        const metadata: Record<string, string> = {};

        const fileExtension = file instanceof TFile ? file.extension.toLowerCase() : file.name.split('.').pop()?.toLowerCase() || '';
        const isHeicOrTiff = ['heic', 'heif', 'tiff', 'tif'].includes(fileExtension);

        if (isHeicOrTiff) {
            // For HEIC and TIFF, return empty metadata initially, as metadata should be extracted after decoding
            return metadata;
        }

        if (file instanceof TFile) {
            // Handle TFile (files already in the vault)
            let objectUrl: string | null = null;
            try {
                const fileContent = providedContent
                    ?? await this.app.vault.readBinary(file);
                const detected = await detectImageBinaryType(fileContent);
                const blob = new Blob([fileContent], { type: detected?.mime ?? "application/octet-stream" });
                const img = new Image();
                objectUrl = URL.createObjectURL(blob);
                await loadImage(img, objectUrl);

                const { width, height } = img;

                metadata["{width}"] = width.toString();
                metadata["{height}"] = height.toString();
                metadata["{aspectratio}"] = (width / height).toFixed(2);
                metadata["{orientation}"] =
                    width > height
                        ? "landscape"
                        : width < height
                            ? "portrait"
                            : "square";

                // Calculate more properties
                const aspectRatio = width / height;
                const isSquare = Math.abs(aspectRatio - 1) < 0.01;
                const pixelCount = width * height;

                // Get file stats using app.vault.adapter.stat for TFile
                let fileSizeInBytes = providedSize ?? 0;
                if (providedSize === undefined) {
                    try {
                        const fileStats = await this.app.vault.adapter.stat(file.path);
                        if (fileStats) {
                            fileSizeInBytes = fileStats.size;
                        } else {
                            throw new Error("File stats not available");
                        }
                    } catch (error) {
                        console.error("Error getting file stats:", error);
                    }
                }

                // Add properties to metadata object

                Object.assign(metadata, {
                    // Existing properties
                    '{ratio}': aspectRatio.toFixed(2),
                    '{quality}': this.settings.localProcessing.conversion.quality.toString(),
                    '{resolution}': `${img.width}x${img.height}`,
                    '{megapixels}': (pixelCount / 1000000).toFixed(2),

                    // New properties
                    '{issquare}': isSquare.toString(),
                    '{pixelcount}': pixelCount.toString(),
                    '{aspectratiotype}': (() => {
                        if (isSquare) return '1:1';
                        if (Math.abs(aspectRatio - 1.33) < 0.1) return '4:3';
                        if (Math.abs(aspectRatio - 1.78) < 0.1) return '16:9';
                        if (Math.abs(aspectRatio - 1.6) < 0.1) return '16:10';
                        return 'custom';
                    })(),
                    '{resolutioncategory}': (() => {
                        if (pixelCount < 100000) return 'tiny';      // < 0.1MP  (e.g., 316x316 or smaller)
                        if (pixelCount < 500000) return 'small';     // < 0.5MP  (e.g., 707x707 or smaller)
                        if (pixelCount < 2000000) return 'medium';   // < 2MP    (e.g., 1414x1414 or smaller)
                        if (pixelCount < 8000000) return 'large';    // < 8MP    (e.g., 2828x2828 or smaller)
                        return 'very-large';                         // >= 8MP   (e.g., larger than 2828x2828)
                    })(),
                    '{filesizecategory}': (() => {
                        if (fileSizeInBytes < 50 * 1024) return '0-50KB';
                        if (fileSizeInBytes < 200 * 1024) return '51-200KB';
                        if (fileSizeInBytes < 1024 * 1024) return '201-1024KB';
                        if (fileSizeInBytes < 5 * 1024 * 1024) return '1025KB-5MB';
                        if (fileSizeInBytes < 10 * 1024 * 1024) return '5MB-10MB';
                        return '10MB+';
                    })(),
                    '{dominantdimension}': width > height ? 'width' : (width < height ? 'height' : 'equal'),
                    '{dimensiondifference}': Math.abs(width - height).toString(),
                    '{bytesperpixel}': (fileSizeInBytes / pixelCount).toFixed(2),
                    '{compressionratio}': (fileSizeInBytes / (pixelCount * 3)).toFixed(2), // Assuming RGB
                    '{maxdimension}': Math.max(width, height).toString(),
                    '{mindimension}': Math.min(width, height).toString(),
                    '{diagonalpixels}': Math.sqrt(width * width + height * height).toFixed(0),
                    '{aspectratiosimplified}': (() => {

                        const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
                        const w = width;
                        const h = height;
                        const divisor = gcd(w, h);

                        return `${w / divisor}:${h / divisor}`;
                    })(),
                    '{screenfitcategory}': (() => {
                        const standardWidth = 1920;
                        const standardHeight = 1080;
                        if (width <= standardWidth && height <= standardHeight) return 'fits-1080p';
                        if (width <= 2560 && height <= 1440) return 'fits-1440p';
                        if (width <= 3840 && height <= 2160) return 'fits-4k';
                        return 'above-4k';
                    })(),
                });

            } catch (error) {
                console.error("Error extracting image metadata for TFile:", error);
            } finally {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
            }
        } else {
            // Handle File (files being dragged or pasted)
            let objectUrl: string | null = null;
            try {
                const img = new Image();
                objectUrl = URL.createObjectURL(file);
                await loadImage(img, objectUrl);

                const { width, height } = img;

                metadata["{width}"] = width.toString();
                metadata["{height}"] = height.toString();
                metadata["{aspectratio}"] = (width / height).toFixed(2);
                metadata["{orientation}"] =
                    width > height
                        ? "landscape"
                        : width < height
                            ? "portrait"
                            : "square";

                // Calculate more properties
                const aspectRatio = width / height;
                const isSquare = Math.abs(aspectRatio - 1) < 0.01;
                const pixelCount = width * height;

                // Get file size directly from the File object
                const fileSizeInBytes = file.size;

                // Add properties to metadata object

                Object.assign(metadata, {
                    // Existing properties
                    '{ratio}': aspectRatio.toFixed(2),
                    '{quality}': this.settings.localProcessing.conversion.quality.toString(),
                    '{resolution}': `${img.width}x${img.height}`,
                    '{megapixels}': (pixelCount / 1000000).toFixed(2),

                    // New properties
                    '{issquare}': isSquare.toString(),
                    '{pixelcount}': pixelCount.toString(),
                    '{aspectratiotype}': (() => {
                        if (isSquare) return '1:1';
                        if (Math.abs(aspectRatio - 1.33) < 0.1) return '4:3';
                        if (Math.abs(aspectRatio - 1.78) < 0.1) return '16:9';
                        if (Math.abs(aspectRatio - 1.6) < 0.1) return '16:10';
                        return 'custom';
                    })(),
                    '{resolutioncategory}': (() => {
                        if (pixelCount < 100000) return 'tiny';      // < 0.1MP  (e.g., 316x316 or smaller)
                        if (pixelCount < 500000) return 'small';     // < 0.5MP  (e.g., 707x707 or smaller)
                        if (pixelCount < 2000000) return 'medium';   // < 2MP    (e.g., 1414x1414 or smaller)
                        if (pixelCount < 8000000) return 'large';    // < 8MP    (e.g., 2828x2828 or smaller)
                        return 'very-large';                         // >= 8MP   (e.g., larger than 2828x2828)
                    })(),
                    '{filesizecategory}': (() => {
                        if (fileSizeInBytes < 50 * 1024) return '0-50KB';
                        if (fileSizeInBytes < 200 * 1024) return '51-200KB';
                        if (fileSizeInBytes < 1024 * 1024) return '201-1024KB';
                        if (fileSizeInBytes < 5 * 1024 * 1024) return '1025KB-5MB';
                        if (fileSizeInBytes < 10 * 1024 * 1024) return '5MB-10MB';
                        return '10MB+';
                    })(),
                    '{dominantdimension}': width > height ? 'width' : (width < height ? 'height' : 'equal'),
                    '{dimensiondifference}': Math.abs(width - height).toString(),
                    '{bytesperpixel}': (fileSizeInBytes / pixelCount).toFixed(2),
                    '{compressionratio}': (fileSizeInBytes / (pixelCount * 3)).toFixed(2), // Assuming RGB
                    '{maxdimension}': Math.max(width, height).toString(),
                    '{mindimension}': Math.min(width, height).toString(),
                    '{diagonalpixels}': Math.sqrt(width * width + height * height).toFixed(0),
                    '{aspectratiosimplified}': (() => {

                        const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
                        const w = width;
                        const h = height;
                        const divisor = gcd(w, h);

                        return `${w / divisor}:${h / divisor}`;
                    })(),
                    '{screenfitcategory}': (() => {
                        const standardWidth = 1920;
                        const standardHeight = 1080;
                        if (width <= standardWidth && height <= standardHeight) return 'fits-1080p';
                        if (width <= 2560 && height <= 1440) return 'fits-1440p';
                        if (width <= 3840 && height <= 2160) return 'fits-4k';
                        return 'above-4k';
                    })(),
                });

            } catch (error) {
                console.error("Error extracting image metadata for File:", error);
            } finally {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
            }
        }

        return metadata;
    }

    private formatSize(
        size: number,
        unit: string,
        decimals: number
    ): string {
        switch (unit) {
            case "MB":
                return (size / (1024 * 1024)).toFixed(decimals);
            case "KB":
                return (size / 1024).toFixed(decimals);
            case "B":
                return size.toFixed(decimals);
            default:
                return size.toString();
        }
    }

    private generateRandomHex(size: number): string {
        const array = new Uint8Array(Math.ceil(size / 2));
        window.crypto.getRandomValues(array);
        return Array.from(array)
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("")
            .substring(0, size); // Trim in case size is odd
    }

    private async generateSHA256(text: string): Promise<string> {
        const encoder = new TextEncoder();
        return sha256Hex(encoder.encode(text).buffer);
    }
}

const IMAGE_METADATA_TOKENS = new Set([
    "{width}", "{height}", "{aspectratio}", "{orientation}", "{resolution}",
    "{ratio}", "{megapixels}", "{issquare}", "{pixelcount}",
    "{aspectratiotype}", "{resolutioncategory}", "{filesizecategory}",
    "{dominantdimension}", "{dimensiondifference}", "{bytesperpixel}",
    "{compressionratio}", "{maxdimension}", "{mindimension}",
    "{diagonalpixels}", "{aspectratiosimplified}", "{screenfitcategory}"
]);

function isImageMetadataToken(token: string): boolean {
    return IMAGE_METADATA_TOKENS.has(token);
}

function splitFilename(filename: string): {
    readonly stem: string;
    readonly extension: string;
} {
    const normalized = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
    const dot = normalized.lastIndexOf(".");
    if (dot <= 0 || dot === normalized.length - 1) {
        return {
            stem: normalized.replace(/^\.+/, "") || "image",
            extension: ""
        };
    }
    return {
        stem: normalized.slice(0, dot),
        extension: normalized.slice(dot + 1)
    };
}

function tokenError(token: TemplateToken, message: string): TemplateEvaluationError {
    return new TemplateEvaluationError([{
        code: "invalid-argument",
        token: token.source,
        message: `${token.source}: ${message}`,
        offset: token.start
    }]);
}

function cloneMoment(value: any): any {
    if (typeof value?.clone === "function") return value.clone();
    const momentFactory = (window as typeof window & {
        moment?: (input?: number) => any;
    }).moment;
    const timestamp = Number(value?.valueOf?.());
    return momentFactory?.(Number.isFinite(timestamp) ? timestamp : undefined)
        ?? value;
}

const DIRECT_TEMPLATE_TOKEN_BODIES = new Set([
    "imagename", "filetype", "sizeb", "sizekb", "sizemb",
    "notename", "notename_nospaces", "date", "time",
    "YYYY", "MM", "DD", "HH", "mm", "ss", "weekday", "month",
    "calendar", "today", "YYYY-MM-DD", "tomorrow", "yesterday",
    "startofweek", "endofweek", "startofmonth", "endofmonth",
    "nextweek", "lastweek", "nextmonth", "lastmonth", "daysinmonth",
    "weekofyear", "quarterofyear", "week", "w", "quarter", "Q",
    "dayofyear", "DDD", "monthname", "MMMM", "dayname", "dddd",
    "dateordinal", "Do", "relativetime", "currentdate", "yyyy",
    "timestamp", "parentfolder", "grandparentfolder", "notefolder",
    "notepath", "rootfolder", "vaultname", "vaultpath", "imagepath",
    "fullpath", "timezone", "locale", "platform", "useragent",
    "random", "uuid", "quality"
]);

for (const metadataToken of IMAGE_METADATA_TOKENS) {
    DIRECT_TEMPLATE_TOKEN_BODIES.add(metadataToken.slice(1, -1));
}

function validateTemplateTokenBody(body: string): string | null {
    if (DIRECT_TEMPLATE_TOKEN_BODIES.has(body)) return null;
    if (/^date:.+$/i.test(body)) return null;
    if (body.startsWith("date:")) return "Date format cannot be empty.";
    if (/^counter:0+$/i.test(body)) return null;
    if (/^counter:/i.test(body)) return "Counter syntax must be {counter:000}.";

    const randomHex = /^randomHex:(\d+)$/i.exec(body);
    if (randomHex) {
        const length = Number(randomHex[1]);
        return length >= 1 && length <= 128
            ? null
            : "randomHex length must be from 1 to 128.";
    }
    if (/^randomHex:/i.test(body)) {
        return "randomHex length must be an integer from 1 to 128.";
    }

    const size = /^size:(MB|KB|B):(\d+)$/i.exec(body);
    if (size) {
        const decimals = Number(size[2]);
        return decimals <= 10 ? null : "Size decimals must be from 0 to 10.";
    }
    if (/^size:/i.test(body)) {
        return "Size syntax must be {size:B|KB|MB:DECIMALS}.";
    }

    const hash = /^(MD5|sha256):(.+)$/i.exec(body);
    if (hash) {
        let source = hash[2];
        let length: number | undefined;
        const lengthMatch = /:(\d+)$/.exec(source);
        if (lengthMatch) {
            length = Number(lengthMatch[1]);
            source = source.slice(0, -lengthMatch[0].length);
        }
        if (!source) return "Hash source cannot be empty.";
        const maxLength = hash[1].toLowerCase() === "md5" ? 32 : 64;
        if (length !== undefined && (length < 1 || length > maxLength)) {
            return `${hash[1].toUpperCase()} length must be from 1 to ${maxLength}.`;
        }
        return null;
    }
    if (/^(MD5|sha256)$/i.test(body)) {
        return "Hash syntax requires a source, for example {MD5:time}.";
    }
    return "Unknown template token.";
}
