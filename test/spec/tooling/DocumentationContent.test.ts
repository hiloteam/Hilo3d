import { describe, expect, it } from 'vitest';
import {
    documentationChannel,
    markdownAnchors,
    markdownReferences
} from '../../../scripts/documentation-content';

describe('documentation content', () => {
    it('reads inline, image and reference destinations without treating examples as navigation', () => {
        const source = [
            '[Guide](./guide.md#setup)',
            '![Cover](<./cover image.png>)',
            '[details]: ../details.md "Details"',
            '`[sample](missing.md)`',
            '```ts',
            'const sample = "[example](missing-too.md)";',
            '```',
            '~~~markdown',
            '[example](also-missing.md)',
            '~~~'
        ].join('\n');
        const links = markdownReferences(source);
        expect(links.map(link => link.url)).toEqual([
            './guide.md#setup',
            './cover image.png',
            '../details.md'
        ]);
        for (const link of links)
            expect(source.slice(link.start, link.start + link.length)).toBe(link.url);
    });

    it('preserves labels while rewriting repeated relative destinations', () => {
        let source = '[guide.md](guide.md) and [other](guide.md#part)';
        for (const link of markdownReferences(source).reverse()) {
            source = `${source.slice(0, link.start)}docs/${link.url}${source.slice(link.start + link.length)}`;
        }
        expect(source).toBe('[guide.md](docs/guide.md) and [other](docs/guide.md#part)');
    });

    it('recognizes Unicode, duplicate headings and explicit IDs, excluding fenced headings', () => {
        expect([
            ...markdownAnchors(
                '# Hello `API`\n## 中文：入口\n## Hello API\n<a id="custom"></a>\n```\n# Hidden\n```'
            )
        ]).toEqual(['hello-api', '中文入口', 'hello-api-1', 'custom']);
    });

    it('never promotes an untagged or modified checkout to release source', () => {
        expect(documentationChannel(null, false)).toBe('development');
        expect(documentationChannel('2.0.0-alpha.8', true)).toBe('development');
        expect(documentationChannel('2.0.0-alpha.8', false)).toBe('release-source');
    });
});
