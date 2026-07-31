const htmlReferencePattern = /\b(?:href|src|poster)=["']([^"']+)["']/g;
const cssReferencePattern = /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^"')]+))\s*\)/g;

export type SiteFileType = 'css' | 'html';

/** Extract link-like references without interpreting nested syntax inside quoted CSS URLs. */
export function extractSiteReferences(fileType: SiteFileType, contents: string): string[] {
    const matches =
        fileType === 'html'
            ? [...contents.matchAll(htmlReferencePattern)].map(match => match[1] ?? '')
            : [...contents.matchAll(cssReferencePattern)].map(
                  match => match[1] ?? match[2] ?? match[3] ?? ''
              );

    return matches.map(reference => reference.replaceAll('&amp;', '&').trim());
}
