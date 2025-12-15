import OCRProvider from "./ocr-provider";
import { TexifyResponse } from "./TexifyResponse";
import { SelfHostedSettings } from "./SelfHostedSettings";

export default class Texify implements OCRProvider {
	settings: SelfHostedSettings;

	constructor(settings: SelfHostedSettings) {
		this.settings = settings;
	}

	async sendRequest(image: Uint8Array): Promise<string> {
		const formData = new FormData();
		const uint8Array = new Uint8Array(image);
		const blob = new Blob([uint8Array], { type: 'image/png' });
		formData.append("image", blob, "image.png");
		let options: any = {
			method: "POST",
			body: formData,
		};
		if (this.settings.username && this.settings.password) {
			options.headers = {
				Authorization: `Basic ${btoa(`${this.settings.username}:${this.settings.password}`)
					}`,
			};
		}
		const response = await fetch(this.settings.url, options);
		const parsed: TexifyResponse = await response.json() as TexifyResponse;
		console.log(parsed);
		return parsed.results[0];
	}
}
