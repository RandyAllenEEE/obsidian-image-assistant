import OCRProvider from "./ocr-provider";
import { TexifyResponse } from "./TexifyResponse";
import { SelfHostedSettings } from "./SelfHostedSettings";
import { App } from "obsidian";
import {
	createBasicAuthorization,
	fetchWithTimeout,
	readResponseTextWithLimit
} from "../../utils/NetworkRequestUtils";
import { createOcrImagePayload } from "./ImagePayload";

export default class Texify implements OCRProvider {
	settings: SelfHostedSettings;

	constructor(settings: SelfHostedSettings, private readonly app?: App) {
		this.settings = settings;
	}

	async sendRequest(image: Uint8Array): Promise<string> {
		const payload = await createOcrImagePayload(image);
		const formData = new FormData();
		const file = new File([payload.data], payload.fileName, { type: payload.mimeType });
		formData.append("image", file);
		const options: any = {
			method: "POST",
			body: formData,
		};
		const password = this.getPassword();
		if (this.settings.username || password) {
			options.headers = {
				Authorization: createBasicAuthorization(this.settings.username, password),
			};
		}
		const response = await fetchWithTimeout(this.settings.url, options);
		let responseText: string;
		try {
			responseText = (await readResponseTextWithLimit(response)).trim();
		} catch (error) {
			if (error instanceof Error && error.message.includes("byte limit")) throw error;
			throw new Error("Texify returned malformed JSON");
		}
		if (response.ok === false) {
			const detail = responseText;
			throw new Error(`Texify request failed with status ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(responseText);
		} catch {
			throw new Error("Texify returned malformed JSON");
		}
		const results = typeof parsed === "object" && parsed !== null
			? (parsed as TexifyResponse).results
			: undefined;
		if (!Array.isArray(results) || typeof results[0] !== "string" || !results[0].trim()) {
			throw new Error("Texify returned no result");
		}
		return results[0].trim();
	}

	private getPassword(): string {
		const secretId = this.settings.passwordSecretId?.trim();
		if (secretId && this.app?.secretStorage) {
			return this.app.secretStorage.getSecret(secretId) ?? "";
		}
		return "";
	}
}
