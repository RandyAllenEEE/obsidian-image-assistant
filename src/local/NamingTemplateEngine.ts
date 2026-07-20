export type TemplateDiagnosticCode =
    | "malformed-token"
    | "unknown-token"
    | "invalid-argument"
    | "unavailable-value";

export interface TemplateDiagnostic {
    readonly code: TemplateDiagnosticCode;
    readonly token: string;
    readonly message: string;
    readonly offset: number;
}

export class TemplateEvaluationError extends Error {
    constructor(
        readonly diagnostics: readonly TemplateDiagnostic[]
    ) {
        super(diagnostics.map(diagnostic => diagnostic.message).join("; "));
        this.name = "TemplateEvaluationError";
    }
}

export interface TemplateToken {
    readonly source: string;
    readonly body: string;
    readonly start: number;
    readonly end: number;
}

export type TemplateTokenResolver = (
    token: TemplateToken
) => Promise<string | null>;

/**
 * Parses and evaluates a template in one pass. Replacement values are appended
 * directly to the output and can never be interpreted as more template input.
 */
export class NamingTemplateEngine {
    parse(template: string): readonly TemplateToken[] {
        const tokens: TemplateToken[] = [];
        let index = 0;

        while (index < template.length) {
            const open = template.indexOf("{", index);
            const strayClose = template.indexOf("}", index);
            if (strayClose >= 0 && (open < 0 || strayClose < open)) {
                throw new TemplateEvaluationError([{
                    code: "malformed-token",
                    token: "}",
                    message: `Unexpected closing brace at offset ${strayClose}.`,
                    offset: strayClose
                }]);
            }
            if (open < 0) break;

            const close = template.indexOf("}", open + 1);
            if (close < 0) {
                throw new TemplateEvaluationError([{
                    code: "malformed-token",
                    token: template.slice(open),
                    message: `Unclosed template token at offset ${open}.`,
                    offset: open
                }]);
            }
            const body = template.slice(open + 1, close);
            if (!body || body.includes("{")) {
                throw new TemplateEvaluationError([{
                    code: "malformed-token",
                    token: template.slice(open, close + 1),
                    message: `Malformed template token at offset ${open}.`,
                    offset: open
                }]);
            }
            tokens.push({
                source: template.slice(open, close + 1),
                body,
                start: open,
                end: close + 1
            });
            index = close + 1;
        }

        return Object.freeze(tokens);
    }

    async evaluate(
        template: string,
        resolver: TemplateTokenResolver
    ): Promise<string> {
        const tokens = this.parse(template);
        if (tokens.length === 0) return template;

        const diagnostics: TemplateDiagnostic[] = [];
        const resolved = new Map<TemplateToken, string>();
        for (const token of tokens) {
            try {
                const value = await resolver(token);
                if (value === null) {
                    diagnostics.push({
                        code: "unknown-token",
                        token: token.source,
                        message: `Unknown template token ${token.source}.`,
                        offset: token.start
                    });
                } else {
                    resolved.set(token, value);
                }
            } catch (error) {
                if (error instanceof TemplateEvaluationError) {
                    diagnostics.push(...error.diagnostics.map(diagnostic => ({
                        ...diagnostic,
                        offset: token.start
                    })));
                } else {
                    diagnostics.push({
                        code: "unavailable-value",
                        token: token.source,
                        message: error instanceof Error
                            ? `${token.source}: ${error.message}`
                            : `${token.source}: ${String(error)}`,
                        offset: token.start
                    });
                }
            }
        }
        if (diagnostics.length > 0) {
            throw new TemplateEvaluationError(Object.freeze(diagnostics));
        }

        let result = "";
        let cursor = 0;
        for (const token of tokens) {
            result += template.slice(cursor, token.start);
            result += resolved.get(token) ?? "";
            cursor = token.end;
        }
        return result + template.slice(cursor);
    }
}
