import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createExampleCatalog } from '../../examples/shared/catalog';

function collectExamplePages(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const absolutePath = join(directory, entry.name);
        if (entry.isDirectory()) return collectExamplePages(absolutePath);
        if (!entry.name.endsWith('.html')) return [];
        return [relative('examples', absolutePath).split(sep).join('/')];
    });
}

describe('example catalog', () => {
    it('contains one typed entry for every runnable example page', () => {
        const paths = collectExamplePages('examples')
            .filter(path => path !== 'index.html' && path !== 'list.html')
            .sort();
        const catalog = createExampleCatalog(paths);
        expect(catalog.map(entry => entry.path).sort()).toEqual(paths);
        for (const entry of catalog) {
            expect(existsSync(join('examples', entry.sourcePath))).toBe(true);
            expect(entry.supportedBackends.length).toBeGreaterThan(0);
        }
    });
});
