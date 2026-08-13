import { Editor, normalizePath } from 'obsidian';
import { type ImageLink } from './RegexPatterns';
import {
    getImageLayoutKey,
    getImageSourceDescriptors,
    getImageSourceKey,
    type ImageSourceDescriptor
} from './MarkdownSourceContext';
import { isHttpUrl } from './NetworkPolicy';

export const IMAGE_SOURCE_KEY_ATTRIBUTE = 'data-image-assistant-source-key';
export const IMAGE_LAYOUT_KEY_ATTRIBUTE = 'data-image-assistant-layout-key';

export interface ImageLinkMatch {
    linkText: string;
    line: number;
    start: number;
    end: number;
    score: number;
    descriptor: ImageSourceDescriptor;
    sourceKey: string;
    layoutKey: string;
}

export interface ImageSourceIndex {
    source: string;
    descriptors: readonly ImageSourceDescriptor[];
    lineStarts: readonly number[];
}

export type ImageResolutionResult =
    | { status: 'resolved'; match: ImageLinkMatch }
    | { status: 'pending' }
    | { status: 'absent' };

const SHARED_SOURCE_INDEX_CACHE = new WeakMap<Editor, ImageSourceIndex>();

export class RefinedImageUtils {
    /**
     * Extracts link text using the Editor instance.
     * 
     * @param img 
     * @param editor 
     * @returns 
     */
    public getImageLinkTextFromEditor(img: HTMLImageElement, editor: Editor): string | null {
        return this.getImageLinkMatchFromEditor(img, editor)?.linkText ?? null;
    }

    /**
     * Extracts the best matching link text and exact editor range for an image.
     */
    public getImageLinkMatchFromEditor(
        img: HTMLImageElement,
        editor: Editor,
        viewContent?: HTMLElement,
        preparedIndex?: ImageSourceIndex
    ): ImageLinkMatch | null {
        const result = this.resolveImageLinkFromEditor(img, editor, viewContent, preparedIndex);
        return result.status === 'resolved' ? result.match : null;
    }

    /** Distinguishes a transient CodeMirror mapping gap from a confirmed missing source link. */
    public resolveImageLinkFromEditor(
        img: HTMLImageElement,
        editor: Editor,
        viewContent?: HTMLElement,
        preparedIndex?: ImageSourceIndex
    ): ImageResolutionResult {
        try {
            if (viewContent && !viewContent.contains(img)) return { status: 'absent' };

            const src = img.getAttribute('src');
            if (!src) return { status: 'absent' };

            const sourceIndex = preparedIndex ?? this.getImageSourceIndex(editor);
            const directWidget = getDirectCodeMirrorBlockWidget(img);
            const editorOffset = this.getEditorOffset(img, editor, directWidget);
            if (editorOffset !== null) {
                const positioned = this.selectDescriptorAtOffset(
                    sourceIndex.descriptors.map(descriptor => ({ descriptor, score: 4 })),
                    editorOffset,
                    sourceIndex
                );
                // A normal inline render has a stable CodeMirror position, so
                // an unresolvable position is a transient mapping gap. In
                // contrast, a standalone image is a replace decoration in
                // Obsidian 1.11.x and its raw IMG is recreated on every
                // decoration update. Query the direct widget root, but only
                // trust that position when it still identifies this image's
                // source. A stale adjacent position must fall through to the
                // source-key/unique-target paths below instead of clearing an
                // otherwise valid layout during widget replacement.
                if (positioned && (!directWidget
                    || this.descriptorMatchesImageSource(positioned.descriptor, src))) {
                    return { status: 'resolved', match: this.toImageLinkMatch(positioned, sourceIndex) };
                }
                if (!directWidget) return { status: 'pending' };
            }

            const sourceKey = img.getAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE);
            if (sourceKey) {
                const keyed = sourceIndex.descriptors.find(descriptor =>
                    getImageSourceKey(descriptor) === sourceKey
                );
                if (keyed) {
                    return {
                        status: 'resolved',
                        match: this.toImageLinkMatch({ descriptor: keyed, score: 4 }, sourceIndex)
                    };
                }
            }

            const isNetwork = isHttpUrl(src);
            const candidates = this.buildSourceCandidates(src, isNetwork);
            if (candidates.length === 0) return { status: 'absent' };

            const scored: ScoredDescriptor[] = [];
            let bestScore = 0;

            for (const descriptor of sourceIndex.descriptors) {
                const score = this.scoreLinkMatch(descriptor, candidates, isNetwork);
                if (score === 0) continue;

                if (score > bestScore) {
                    bestScore = score;
                    scored.length = 0;
                }
                if (score === bestScore) scored.push({ descriptor, score });
            }

            if (scored.length === 0) return { status: 'absent' };

            // Without a source position, repeated targets are ambiguous under
            // CodeMirror virtualization. Only a document-wide unique target is safe.
            return scored.length === 1
                ? { status: 'resolved', match: this.toImageLinkMatch(scored[0], sourceIndex) }
                : { status: 'pending' };
        } catch (error) {
            console.error('RefinedImageUtils: Error getting image link text:', error);
            return { status: 'pending' };
        }
    }

    public getImageSourceIndex(editor: Editor): ImageSourceIndex {
        const source = this.readEditorSource(editor);
        const cached = SHARED_SOURCE_INDEX_CACHE.get(editor);
        if (cached?.source === source) return cached;

        const lines = source.split('\n');
        const index: ImageSourceIndex = {
            source,
            descriptors: getImageSourceDescriptors(source),
            lineStarts: getLineStarts(lines)
        };
        SHARED_SOURCE_INDEX_CACHE.set(editor, index);
        return index;
    }

    private buildSourceCandidates(src: string, isNetwork: boolean): SourceCandidate[] {
        const candidates: SourceCandidate[] = [];
        const addCandidate = (value: string, allowBasename = true) => {
            const cleaned = (isNetwork ? value : value.split('?')[0]).trim();
            if (!cleaned) return;

            this.addNormalizedCandidate(candidates, cleaned);
            const decoded = this.safeDecodeURIComponent(cleaned);
            if (decoded !== cleaned) {
                this.addNormalizedCandidate(candidates, decoded);
            }

            if (!allowBasename) return;

            for (const variant of [cleaned, decoded]) {
                const basename = variant.replace(/\\/g, '/').split('/').pop();
                if (basename) {
                    this.addNormalizedCandidate(candidates, basename, false);
                    const decodedBasename = this.safeDecodeURIComponent(basename);
                    if (decodedBasename !== basename) {
                        this.addNormalizedCandidate(candidates, decodedBasename, false);
                    }
                }
            }
        };

        if (isNetwork) {
            addCandidate(src, false);
            return candidates;
        }

        addCandidate(src);

        if (src.startsWith('app://local/')) {
            addCandidate(src.substring('app://local/'.length));
        } else if (src.startsWith('app://')) {
            const withoutScheme = src.substring('app://'.length);
            const firstSlash = withoutScheme.indexOf('/');
            if (firstSlash >= 0) {
                addCandidate(withoutScheme.substring(firstSlash + 1));
            }
        }

        return candidates;
    }

    private addNormalizedCandidate(candidates: SourceCandidate[], value: string, hasPath?: boolean): void {
        const normalized = this.normalizeComparablePath(value);
        if (!normalized) return;

        const candidate: SourceCandidate = {
            value: normalized,
            hasPath: hasPath ?? normalized.includes('/')
        };

        if (!candidates.some((existing) => existing.value === candidate.value && existing.hasPath === candidate.hasPath)) {
            candidates.push(candidate);
        }
    }

    private scoreLinkMatch(link: ImageLink, candidates: SourceCandidate[], isNetwork: boolean): number {
        const linkPath = this.normalizeComparablePath(link.path);
        if (!linkPath) return 0;

        let bestScore = 0;
        for (const candidate of candidates) {
            if (candidate.value === linkPath) {
                bestScore = Math.max(bestScore, candidate.hasPath || isNetwork ? 3 : 1);
                continue;
            }

            if (!isNetwork && candidate.hasPath) {
                if (candidate.value.endsWith(`/${linkPath}`) || linkPath.endsWith(`/${candidate.value}`)) {
                    bestScore = Math.max(bestScore, 2);
                }
            }
        }

        if (!isNetwork) {
            const linkBasename = linkPath.split('/').pop();
            if (linkBasename && candidates.some((candidate) => !candidate.hasPath && candidate.value === linkBasename)) {
                bestScore = Math.max(bestScore, 1);
            }
        }

        return bestScore;
    }

    private readEditorSource(editor: Editor): string {
        const value = editor.getValue?.();
        if (typeof value === 'string') return value;

        if (typeof editor.lineCount !== 'function' || typeof editor.getLine !== 'function') {
            return '';
        }
        const lineCount = editor.lineCount();
        return Array.from({ length: lineCount }, (_, index) => editor.getLine(index)).join('\n');
    }

    private getEditorOffset(
        img: HTMLImageElement,
        editor: Editor,
        directWidget: HTMLElement | null
    ): number | null {
        const codeMirror = (editor as EditorWithCodeMirror).cm;
        if (!codeMirror?.posAtDOM) return null;

        // A standalone Live Preview image is a CodeMirror block decoration.
        // Ask CodeMirror about the replacement root itself (not its IMG
        // descendant), then validate the resulting descriptor in the caller.
        // This gives a newly created widget its exact source identity even
        // when the same remote URL occurs more than once in the note.
        const nodes: Node[] = directWidget ? [directWidget] : [img];
        if (!directWidget) {
            const embed = img.closest('.cm-embed-block, .cm-line');
            if (embed && embed !== img) nodes.push(embed);
        }

        for (const node of nodes) {
            try {
                const position = codeMirror.posAtDOM(node, 0);
                if (Number.isInteger(position) && position >= 0) return position;
            } catch {
                // Some CodeMirror widgets do not expose a position for descendants.
            }
        }
        return null;
    }

    private descriptorMatchesImageSource(descriptor: ImageSourceDescriptor, src: string): boolean {
        const isNetwork = isHttpUrl(src);
        const candidates = this.buildSourceCandidates(src, isNetwork);
        return candidates.length > 0
            && this.scoreLinkMatch(descriptor, candidates, isNetwork) > 0;
    }

    private selectDescriptorAtOffset(
        matches: ScoredDescriptor[],
        offset: number,
        sourceIndex: ImageSourceIndex
    ): ScoredDescriptor | null {
        const containing = matches.filter(({ descriptor }) =>
            offset >= descriptor.index && offset <= descriptor.end
        );
        if (containing.length === 1) return containing[0];
        if (containing.length > 1) return null;

        const line = getLineForOffset(sourceIndex.lineStarts, offset);
        const sameLine = matches.filter(match => match.descriptor.line === line);
        if (sameLine.length === 0) return null;

        let shortestDistance = Number.POSITIVE_INFINITY;
        let closest: ScoredDescriptor | null = null;
        let tied = false;
        for (const match of sameLine) {
            const distance = offset < match.descriptor.index
                ? match.descriptor.index - offset
                : offset - match.descriptor.end;
            if (distance < shortestDistance) {
                shortestDistance = distance;
                closest = match;
                tied = false;
            } else if (distance === shortestDistance) {
                tied = true;
            }
        }

        return tied ? null : closest;
    }

    private toImageLinkMatch(
        match: ScoredDescriptor,
        sourceIndex: ImageSourceIndex
    ): ImageLinkMatch {
        const { descriptor, score } = match;
        const line = getLineForOffset(sourceIndex.lineStarts, descriptor.index);
        const start = descriptor.index - sourceIndex.lineStarts[line];
        return {
            linkText: descriptor.source,
            line,
            start,
            end: start + descriptor.source.length,
            score,
            descriptor,
            sourceKey: getImageSourceKey(descriptor),
            layoutKey: getImageLayoutKey(descriptor)
        };
    }

    private normalizeComparablePath(value: string): string {
        const decoded = this.safeDecodeURIComponent(value);
        const normalized = normalizePath(decoded.replace(/\\/g, '/')).replace(/^\/+/, '');
        return normalized.toLowerCase();
    }

    private safeDecodeURIComponent(value: string): string {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }
}

function getDirectCodeMirrorBlockWidget(img: HTMLImageElement): HTMLElement | null {
    let widget: HTMLElement = img;
    while (widget.parentElement && !widget.parentElement.matches('.cm-content')) {
        widget = widget.parentElement;
    }
    return widget.parentElement?.matches('.cm-content') === true
        && !!widget.closest('.markdown-source-view')
        ? widget
        : null;
}

interface SourceCandidate {
    value: string;
    hasPath: boolean;
}

interface ScoredDescriptor {
    descriptor: ImageSourceDescriptor;
    score: number;
}

interface EditorWithCodeMirror extends Editor {
    cm?: {
        posAtDOM(node: Node, offset?: number): number;
    };
}

function getLineStarts(lines: string[]): number[] {
    const starts: number[] = [];
    let offset = 0;
    for (const line of lines) {
        starts.push(offset);
        offset += line.length + 1;
    }
    return starts;
}

function getLineForOffset(lineStarts: readonly number[], offset: number): number {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        const start = lineStarts[middle];
        const next = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;
        if (offset < start) {
            high = middle - 1;
        } else if (offset >= next) {
            low = middle + 1;
        } else {
            return middle;
        }
    }
    return Math.max(0, lineStarts.length - 1);
}
