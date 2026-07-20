import type {
    Editor,
    EditorPosition,
    MarkdownView,
    TFile
} from "obsidian";

export interface EditorRangeMutationContext {
    readonly editor: Editor;
    readonly view: MarkdownView;
    readonly file: TFile;
}

export interface EditorRangeMutationRequest {
    readonly line: number;
    readonly start: number;
    readonly end: number;
    readonly expectedText: string;
    readonly replacement: string;
    readonly removeStandaloneLine?: boolean;
}

export interface EditorRangeMutationResult {
    readonly applied: boolean;
    readonly saved: boolean;
    readonly rolledBack: boolean;
    readonly rollbackSaved: boolean;
    readonly uncertain: boolean;
    readonly stale: boolean;
    readonly error?: string;
}

interface PreparedMutation {
    readonly from: EditorPosition;
    readonly to: EditorPosition;
    readonly original: string;
    readonly replacement: string;
}

export class EditorRangeMutationTransaction {
    async run(
        context: EditorRangeMutationContext,
        request: EditorRangeMutationRequest
    ): Promise<EditorRangeMutationResult> {
        if (context.view.file?.path !== context.file.path) return staleResult();

        const mutation = this.prepare(context.editor, request);
        if (!mutation) return staleResult();

        const beforeValue = context.editor.getValue();
        context.editor.replaceRange(
            mutation.replacement,
            mutation.from,
            mutation.to
        );
        const afterValue = context.editor.getValue();

        try {
            await context.view.save();
            return {
                applied: true,
                saved: true,
                rolledBack: false,
                rollbackSaved: false,
                uncertain: false,
                stale: false
            };
        } catch (error) {
            let rolledBack = false;
            let rollbackSaved = false;
            let rollbackError: unknown;
            if (context.editor.getValue() === afterValue) {
                const replacementEnd = advancePosition(
                    mutation.from,
                    mutation.replacement
                );
                context.editor.replaceRange(
                    mutation.original,
                    mutation.from,
                    replacementEnd
                );
                rolledBack = context.editor.getValue() === beforeValue;
                if (rolledBack && context.view.file?.path === context.file.path) {
                    try {
                        await context.view.save();
                        rollbackSaved = true;
                    } catch (saveError) {
                        rollbackError = saveError;
                    }
                }
            }
            const uncertain = !rolledBack || !rollbackSaved;
            return {
                applied: true,
                saved: false,
                rolledBack,
                rollbackSaved,
                uncertain,
                stale: false,
                error: rollbackError
                    ? `${getErrorMessage(error)}; rollback save failed: ${getErrorMessage(rollbackError)}`
                    : getErrorMessage(error)
            };
        }
    }

    private prepare(
        editor: Editor,
        request: EditorRangeMutationRequest
    ): PreparedMutation | null {
        if (request.line < 0 || request.line >= editor.lineCount()) return null;
        const line = editor.getLine(request.line);
        if (request.start < 0
            || request.end < request.start
            || request.end > line.length
            || line.slice(request.start, request.end) !== request.expectedText) {
            return null;
        }

        if (request.removeStandaloneLine
            && request.replacement === ""
            && line.trim() === request.expectedText.trim()) {
            return prepareStandaloneLineRemoval(editor, request.line);
        }

        let end = request.end;
        if (request.replacement === "") {
            while (line[end] === " " || line[end] === "\t") end++;
        }
        return {
            from: { line: request.line, ch: request.start },
            to: { line: request.line, ch: end },
            original: line.slice(request.start, end),
            replacement: request.replacement
        };
    }
}

function prepareStandaloneLineRemoval(
    editor: Editor,
    line: number
): PreparedMutation {
    const lineText = editor.getLine(line);
    if (editor.lineCount() === 1) {
        return {
            from: { line: 0, ch: 0 },
            to: { line: 0, ch: lineText.length },
            original: lineText,
            replacement: ""
        };
    }
    if (line < editor.lineCount() - 1) {
        return {
            from: { line, ch: 0 },
            to: { line: line + 1, ch: 0 },
            original: `${lineText}\n`,
            replacement: ""
        };
    }

    const previousLine = line - 1;
    const previousText = editor.getLine(previousLine);
    return {
        from: { line: previousLine, ch: previousText.length },
        to: { line, ch: lineText.length },
        original: `\n${lineText}`,
        replacement: ""
    };
}

function advancePosition(
    start: EditorPosition,
    text: string
): EditorPosition {
    const lines = text.split("\n");
    return lines.length === 1
        ? { line: start.line, ch: start.ch + text.length }
        : {
            line: start.line + lines.length - 1,
            ch: lines[lines.length - 1].length
        };
}

function staleResult(): EditorRangeMutationResult {
    return {
        applied: false,
        saved: false,
        rolledBack: false,
        rollbackSaved: false,
        uncertain: false,
        stale: true
    };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
