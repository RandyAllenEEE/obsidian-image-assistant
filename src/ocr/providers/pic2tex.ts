import TexWrapper from "./tex-wrapper";
import { OCRSettings } from "../OCRSettings";

export default class Pic2Tex extends TexWrapper {
	settings: OCRSettings;

	constructor(isMultiline: boolean, settings: OCRSettings) {
		super(isMultiline);
		this.settings = settings;
	}

	async getTex(image: Uint8Array): Promise<string> {
		const formData = new FormData();
		const uint8Array = new Uint8Array(image);
		const blob = new Blob([uint8Array], { type: 'image/png' });
		formData.append("file", blob, "test.png");

		let response;
		let options: any = {
			method: "POST",
			body: formData,
		};		if (this.settings.pix2tex.username && this.settings.pix2tex.password) {
			options.headers = {
				Authorization: `Basic ${btoa(`${this.settings.pix2tex.username}:${this.settings.pix2tex.password}`)
					}`,
			};
		}
		response = await fetch(this.settings.pix2tex.url, options);

		if (!response.ok) throw response; // Not a ok response, we throw here and let method calling to show error message

		const jsonString = await response.text();
		// Remove the quotes at the start and end of the string
		let latexText = jsonString.substring(1, jsonString.length - 1);
		// Replace all occurrences of \ with \
		latexText = latexText.replace(/\\\\/g, "\\");
		return latexText;

	}
}