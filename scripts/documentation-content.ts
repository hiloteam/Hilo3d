export interface MarkdownReference {
    readonly url: string;
    readonly start: number;
    readonly length: number;
}

/** Keep offsets stable so publication can rewrite destinations without changing prose or code. */
export function withoutFencedCode(contents: string): string {
    let fence: string | undefined;
    return contents
        .split('\n')
        .map(line => {
            const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
            if (fence !== undefined) {
                if (marker?.startsWith(fence)) fence = undefined;
                return ' '.repeat(line.length);
            }
            if (marker !== undefined) {
                fence = marker;
                return ' '.repeat(line.length);
            }
            return line;
        })
        .join('\n');
}

/** Inline/image and reference-definition links; code examples are deliberately excluded. */
export function markdownReferences(contents: string): MarkdownReference[] {
    const visible = withoutFencedCode(contents).replace(/`[^`\n]*`/gu, match =>
        ' '.repeat(match.length)
    );
    const pattern =
        /!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)|^\s*\[[^\]\n]+\]:\s*(<[^>\n]+>|[^\s]+)/gmu;
    const references: MarkdownReference[] = [];
    for (const match of visible.matchAll(pattern)) {
        const raw = match[1] ?? match[2];
        if (raw === undefined) continue;
        const angled = raw.startsWith('<');
        references.push({
            url: angled ? raw.slice(1, -1) : raw,
            start: match.index + match[0].lastIndexOf(raw) + (angled ? 1 : 0),
            length: raw.length - (angled ? 2 : 0)
        });
    }
    return references;
}

/** GitHub-style ATX heading anchors, including duplicate suffixes and explicit HTML IDs. */
export function markdownAnchors(contents: string): ReadonlySet<string> {
    const visible = withoutFencedCode(contents);
    const anchors = new Set<string>();
    for (const match of visible.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gmu)) {
        const title = (match[1] ?? '')
            .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
            .replace(/<[^>]+>/gu, '');
        const base = title
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
            .replaceAll(' ', '-');
        let anchor = base;
        let suffix = 0;
        while (anchors.has(anchor)) anchor = `${base}-${String(++suffix)}`;
        anchors.add(anchor);
    }
    for (const match of visible.matchAll(/\b(?:id|name)=["']([^"']+)["']/gu)) {
        if (match[1] !== undefined) anchors.add(match[1]);
    }
    return anchors;
}

export function isExternalReference(reference: string): boolean {
    return /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(reference);
}

/** A clean matching tag is release source, not proof of npm publication. */
export function documentationChannel(
    releaseTag: string | null,
    modified: boolean
): 'release-source' | 'development' {
    return releaseTag !== null && !modified ? 'release-source' : 'development';
}
