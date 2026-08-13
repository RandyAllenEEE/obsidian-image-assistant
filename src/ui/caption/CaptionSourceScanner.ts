import {
    getCaptionLinkDescriptors,
    isMarkdownSourceContextIncluded,
    MarkdownSourceContextIndex,
    type ImageSourceDescriptor,
    type MarkdownSourceLineState
} from '../../utils/MarkdownSourceContext';

export interface CaptionSourceChange {
    fromA: number;
    toA: number;
    fromB: number;
    toB: number;
    inserted: string;
}

export interface CaptionSourceScan {
    source: string;
    descriptors: ImageSourceDescriptor[];
    lines: readonly MarkdownSourceLineState[];
    scannedLineCount: number;
    fullScan: boolean;
}

export interface CaptionSourceUpdate {
    scan: CaptionSourceScan;
    changedFrom: number;
    changedTo: number;
    incremental: boolean;
}

/**
 * Caption-specific policy over MarkdownSourceContextIndex. The shared index is
 * the only source of Markdown context semantics; this layer only filters and
 * incrementally reuses stable prose lines.
 */
export class CaptionSourceScanner {
    scan(source: string): CaptionSourceScan {
        const index = MarkdownSourceContextIndex.create(source);
        return {
            source,
            descriptors: getCaptionLinkDescriptors(source),
            lines: index.getLineStates(),
            scannedLineCount: index.getLineStates().length,
            fullScan: true
        };
    }

    update(
        previous: CaptionSourceScan,
        source: string,
        changes: readonly CaptionSourceChange[]
    ): CaptionSourceUpdate {
        const incremental = this.trySingleLineUpdate(previous, source, changes);
        if (incremental) return incremental;

        return {
            scan: this.scan(source),
            changedFrom: 0,
            changedTo: source.length,
            incremental: false
        };
    }

    private trySingleLineUpdate(
        previous: CaptionSourceScan,
        source: string,
        changes: readonly CaptionSourceChange[]
    ): CaptionSourceUpdate | null {
        if (changes.length !== 1) return null;
        const change = changes[0];
        const removed = previous.source.slice(change.fromA, change.toA);
        if (removed.includes('\n') || change.inserted.includes('\n')) return null;

        const line = findLineAt(previous.lines, change.fromA);
        if (!line || change.toA > line.to) return null;
        if (!isMarkdownSourceContextIncluded(line.context)) return null;
        if (line.input.htmlComment || line.output.htmlComment
            || line.input.inlineBacktickLength || line.output.inlineBacktickLength) return null;

        const newLineEnd = source.indexOf('\n', line.from);
        const rawEnd = newLineEnd < 0 ? source.length : newLineEnd;
        const contentEnd = rawEnd > line.from && source[rawEnd - 1] === '\r'
            ? rawEnd - 1
            : rawEnd;
        const newLineText = source.slice(line.from, contentEnd);
        if (hasStructuralMarkdown(line.text) || hasStructuralMarkdown(newLineText)) return null;

        const delta = source.length - previous.source.length;
        const newRangeEnd = newLineEnd < 0 ? source.length : newLineEnd + 1;
        const localDescriptors = getCaptionLinkDescriptors(newLineText).map(descriptor => ({
            ...descriptor,
            index: descriptor.index + line.from,
            end: descriptor.end + line.from,
            line: line.line,
            lineStart: line.from,
            lineEnd: contentEnd,
            context: line.context
        }));

        const descriptors = previous.descriptors
            .filter(descriptor => descriptor.line !== line.line)
            .map(descriptor => descriptor.line > line.line
                ? shiftDescriptor(descriptor, delta)
                : { ...descriptor })
            .concat(localDescriptors)
            .sort((left, right) => left.index - right.index);
        assignOrdinals(descriptors);

        const lines = previous.lines.map(candidate => {
            if (candidate.line === line.line) {
                return {
                    ...candidate,
                    text: newLineText,
                    to: newRangeEnd
                };
            }
            if (candidate.line > line.line) {
                return {
                    ...candidate,
                    from: candidate.from + delta,
                    to: candidate.to + delta
                };
            }
            return candidate;
        });

        return {
            scan: {
                source,
                descriptors,
                lines,
                scannedLineCount: 1,
                fullScan: false
            },
            changedFrom: line.from,
            changedTo: newRangeEnd,
            incremental: true
        };
    }
}

function findLineAt(
    lines: readonly MarkdownSourceLineState[],
    position: number
): MarkdownSourceLineState | null {
    let low = 0;
    let high = lines.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        const line = lines[middle];
        if (position < line.from) {
            high = middle - 1;
        } else if (position > line.to || position === line.to && middle < lines.length - 1) {
            low = middle + 1;
        } else {
            return line;
        }
    }
    return null;
}

function hasStructuralMarkdown(line: string): boolean {
    return /[`~<>]/.test(line)
        || /^\uFEFF?\s*(?:---|\.\.\.)\s*$/.test(line)
        || /^\s*(?:>\s*)+\[![^\]]+\][+-]?/.test(line);
}

function shiftDescriptor(descriptor: ImageSourceDescriptor, delta: number): ImageSourceDescriptor {
    return {
        ...descriptor,
        index: descriptor.index + delta,
        end: descriptor.end + delta,
        lineStart: descriptor.lineStart + delta,
        lineEnd: descriptor.lineEnd + delta
    };
}

function assignOrdinals(descriptors: ImageSourceDescriptor[]): void {
    const counts = new Map<string, number>();
    for (const descriptor of descriptors) {
        const ordinal = counts.get(descriptor.normalizedTarget) ?? 0;
        descriptor.ordinal = ordinal;
        counts.set(descriptor.normalizedTarget, ordinal + 1);
    }
}
