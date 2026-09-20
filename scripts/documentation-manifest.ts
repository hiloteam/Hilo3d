import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** One source inventory shared by validation and Markdown publication. */
export const documentationRoots = ['documentation', 'skills/hilo3d-game'] as const;
export const documentationEntryFiles = [
    'README.md',
    'README_ZH.md',
    'CHANGELOG.md',
    'AGENTS.md',
    '.github/CONTRIBUTING.md',
    'llms.txt',
    'etc/hilo3d.api.md'
] as const;
export const recipeDocuments = [
    'documentation/GETTING_STARTED.md',
    'documentation/RECIPES.md'
] as const;
export const recipeDirectory = 'test/types/recipes';

export async function collectMarkdownFiles(root: string): Promise<string[]> {
    const files: string[] = [...documentationEntryFiles];
    async function visit(directory: string): Promise<void> {
        for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
            const path = `${directory}/${entry.name}`;
            if (entry.isDirectory()) await visit(path);
            else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
        }
    }
    for (const directory of documentationRoots) await visit(directory);
    return files.sort();
}
