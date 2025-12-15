import OCRProvider from "./ocr-provider";

export default abstract class TexWrapper implements OCRProvider {
	protected isMultiline = false;
	constructor(isMultiline: boolean) {
		this.isMultiline = isMultiline;
	}

	abstract getTex(image: Uint8Array): Promise<string>;

	// 检查公式是否已经包含对齐环境（考虑嵌套情况）
	hasAlignmentEnvironment(latex: string): boolean {
		// 常见的对齐环境
		const alignEnvironments = ['align', 'alignat', 'gather', 'multline', 'eqnarray', 'cases'];
		
		for (const env of alignEnvironments) {
			// 检查是否存在 \begin{env} ... \end{env} 结构
			const beginPattern = new RegExp(`\\\\begin\\{${env}\\*?\\}`, 'g');
			const endPattern = new RegExp(`\\\\end\\{${env}\\*?\\}`, 'g');
			
			const hasBegin = beginPattern.test(latex);
			const hasEnd = endPattern.test(latex);
			
			// 如果同时存在开始和结束标记，则认为有对齐环境
			if (hasBegin && hasEnd) {
				return true;
			}
		}
		
		return false;
	}

	async sendRequest(image: Uint8Array): Promise<string> {
		const res = await this.getTex(image);
		
		// 如果是多行公式，进行特殊处理
		if (this.isMultiline) {
			// 检查是否包含\\（多行公式特征）且不包含任何对齐环境
			if (res.includes("\\\\") && !this.hasAlignmentEnvironment(res)) {
				// 自动添加gather环境
				return `$$\\begin{gather}${res}\\end{gather}$$`;
			}
			return `$$ ${res}$$`;
		}
		return `$${res}$`;
	}
}