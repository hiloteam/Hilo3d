import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function collectHtmlFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectHtmlFiles(path);
        return entry.name.endsWith('.html') ? [path] : [];
    });
}

export const examplePaths = collectHtmlFiles('examples')
    .map(path => relative('examples', path).split(sep).join('/'))
    .sort();
