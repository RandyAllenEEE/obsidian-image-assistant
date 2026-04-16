import { App, TFile, TFolder } from "obsidian";
import type ImageConverterPlugin from "../../main";
import { MultiRefItem } from "./types";

/**
 * Shared utility for computing MultiRefItem[] across batch uploaders.
 *
 * Consolidates the reference pre-scan logic that was previously duplicated in:
 * - VaultBatchUploader
 * - FolderBatchUploader
 * - NoteBatchUploader
 *
 * Respects the `codeBlockImageLinkIndexing` setting via VaultReferenceManager internally.
 */
export async function computeMultiRefItems(
    files: TFile[],
    plugin: ImageConverterPlugin,
    currentNotePath?: string
): Promise<MultiRefItem[]> {
    const results: MultiRefItem[] = [];

    for (const file of files) {
        const refs = await plugin.vaultReferenceManager.getFilesReferencingImage(file.path);
        if (refs.length === 0) continue;

        // Count references in current note vs other notes
        let currentNoteRefs = 0;
        let otherNoteRefs = 0;

        for (const ref of refs) {
            if (currentNotePath && ref.file.path === currentNotePath) {
                currentNoteRefs++;
            } else {
                otherNoteRefs++;
            }
        }

        // Only include items that have cross-references (other notes)
        if (otherNoteRefs > 0) {
            results.push({
                name: file.name,
                vaultReferences: refs.length,
                currentNoteReferences: currentNoteRefs,
                otherNotesReferences: otherNoteRefs
            });
        }
    }

    return results;
}

/**
 * Build the set of file paths within a given scope.
 * Used to filter VaultReferenceManager results to the intended scope.
 */
export function buildAllowedPathSet(
    scope: "note" | "folder" | "vault",
    target: TFile | TFolder | null,
    app: any
): Set<string> {
    const pathSet = new Set<string>();

    if (scope === "note" && target instanceof TFile) {
        pathSet.add(target.path);
    } else if (scope === "folder" && target instanceof TFolder) {
        const collect = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFile) {
                    pathSet.add(child.path);
                } else if (child instanceof TFolder) {
                    collect(child);
                }
            }
        };
        collect(target);
    } else {
        // vault scope
        for (const f of app.vault.getMarkdownFiles()) {
            pathSet.add(f.path);
        }
    }

    return pathSet;
}