import OCRProvider from "./ocr-provider";
import { TexifyResponse } from "./TexifyResponse";
import TexWrapper from "./tex-wrapper";
import { SimpleTexResponse } from "./SimpleTexResponse";
import { OCRSettings } from "../OCRSettings";

// Simpletex is web service that converts images to latex
export default class SimpleTex extends TexWrapper {
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
		response = await fetch("https://server.simpletex.cn/api/latex_ocr_turbo", {
			method: "POST",
			headers: {
				token: this.settings.simpleTexToken,
			},
			body: formData,
		});

		if (!response.ok) {
			console.error("SimpleTex response", response);
			const errorText = await response.text();
			throw new Error(`SimpleTex API error: ${response.status} - ${errorText}`);
		}
		const resText = await response.text();
		console.log("Simple tex response", resText);
		const data = JSON.parse(resText);
		
		// 检查API返回的状态
		if (!data.status) {
			const errorMsg = data.err_info?.err_msg || 'Unknown error';
			throw new Error(`SimpleTex service error: ${errorMsg}`);
		}
		
		// 检查返回的数据结构是否正确
		if (!data.res) {
			throw new Error('SimpleTex API returned success status but no result data');
		}
		
		// 检查是否有错误信息在res字段中（某些错误情况下会出现这种情况）
		if (data.res.err_info) {
			const errorMsg = data.res.err_info.err_msg || 'Unknown server error';
			throw new Error(`SimpleTex server error: ${errorMsg}`);
		}
		
		// 检查是否有latex结果
		if (!data.res.latex) {
			throw new Error('SimpleTex API returned success status but no latex result');
		}
		
		console.log("Simple tex data", data);
		return data.res.latex;
	}}