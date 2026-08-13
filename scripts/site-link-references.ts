const htmlReferencePattern = /\b(?:href|src|poster)=["']([^"']+)["']/g;
const cssReferencePattern = /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^"')]+))\s*\)/g;

export type SiteFileType = 'css' | 'gltf' | 'html';

function collectGltfUris(value: unknown, references: string[]): void {
    if (Array.isArray(value)) {
        for (const item of value) collectGltfUris(item, references);
        return;
    }
    if (typeof value !== 'object' || value === null) return;

    for (const [key, item] of Object.entries(value)) {
        if (key === 'uri' && typeof item === 'string') references.push(item);
        else collectGltfUris(item, references);
    }
}

/** Extract link-like references without interpreting nested syntax inside quoted CSS URLs. */
export function extractSiteReferences(fileType: SiteFileType, contents: string): string[] {
    if (fileType === 'gltf') {
        const references: string[] = [];
        collectGltfUris(JSON.parse(contents) as unknown, references);
        return references;
    }

    const matches =
        fileType === 'html'
            ? [...contents.matchAll(htmlReferencePattern)].map(match => match[1] ?? '')
            : [...contents.matchAll(cssReferencePattern)].map(
                  match => match[1] ?? match[2] ?? match[3] ?? ''
              );

    return matches.map(reference => reference.replaceAll('&amp;', '&').trim());
}
