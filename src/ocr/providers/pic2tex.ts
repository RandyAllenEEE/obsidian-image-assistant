import TexWrapper from "./tex-wrapper";
import { OCRSettings } from "../OCRSettings";
import { createBasicAuthorization, fetchWithTimeout } from "../../utils/NetworkRequestUtils";
import { createOcrImagePayload } from "./ImagePayload";
import { App } from "obsidian";

export default class Pic2Tex extends TexWrapper {
	settings: OCRSettings;

	constructor(isMultiline: boolean, settings: OCRSettings, private readonly app?: App) {
		super(isMultiline);
		this.settings = settings;
	}

	async getTex(image: Uint8Array): Promise<string> {
		const payload = await createOcrImagePayload(image);
		const formData = new FormData();
		const file = new File([payload.data], payload.fileName, { type: payload.mimeType });
		formData.append("file", file);

		const options: any = {
			method: "POST",
			body: formData,
		};
		const password = this.getPassword();
		if (this.settings.pix2tex.username || password) {
			options.headers = {
				Authorization: createBasicAuthorization(
					this.settings.pix2tex.username,
					password
				),
			};
		}
		const response = await fetchWithTimeout(this.settings.pix2tex.url, options);

		if (!response.ok) {
			const detail = (await response.text()).trim();
			throw new Error(`Pic2Tex request failed with status ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
		}

		const responseText = (await response.text()).trim();
		if (!responseText) throw new Error("Pic2Tex returned an empty response");

		let parsed: unknown;
		try {
			parsed = JSON.parse(responseText);
		} catch {
			throw new Error("Pic2Tex returned malformed JSON");
		}
		const latexText = typeof parsed === "string"
			? parsed.trim()
			: this.extractLatex(parsed);
		if (!latexText) throw new Error("Pic2Tex returned no LaTeX content");
		return latexText;

	}

	private extractLatex(value: unknown): string {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
		const candidate = value as Record<string, unknown>;
		for (const key of ["latex", "result", "text"]) {
			if (typeof candidate[key] === "string") return candidate[key].trim();
		}
		return "";
	}

	private getPassword(): string {
		const secretId = this.settings.pix2tex.passwordSecretId.trim();
		return secretId && this.app?.secretStorage
			? this.app.secretStorage.getSecret(secretId) ?? ""
			: "";
	}
}
