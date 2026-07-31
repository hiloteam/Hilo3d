import { describe, expect, it } from 'vitest';
import { extractSiteReferences } from '../../../scripts/site-link-references';

describe('extractSiteReferences', () => {
    it('keeps nested SVG fragment references inside a quoted data URL', () => {
        const reference =
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E" +
            "%3Cfilter id='n'/%3E%3Crect filter='url(%23n)'/%3E%3C/svg%3E";

        expect(
            extractSiteReferences('css', `.grain { background-image: url("${reference}"); }`)
        ).toEqual([reference]);
    });

    it('extracts quoted and unquoted local CSS references', () => {
        expect(
            extractSiteReferences(
                'css',
                [
                    '.icon { background: url("./icon.svg#mark"); }',
                    ".font { src: url('../fonts/font.woff2?#iefix'); }",
                    '.texture { background: url(images/grid.png); }'
                ].join('\n')
            )
        ).toEqual(['./icon.svg#mark', '../fonts/font.woff2?#iefix', 'images/grid.png']);
    });

    it('extracts HTML references and decodes ampersand entities', () => {
        expect(
            extractSiteReferences(
                'html',
                '<a href="./guide.html?lang=en&amp;mode=full"><img src="./cover.png"></a>'
            )
        ).toEqual(['./guide.html?lang=en&mode=full', './cover.png']);
    });
});
