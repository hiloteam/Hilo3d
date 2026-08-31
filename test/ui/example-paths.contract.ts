import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_CATALOG } from '../../examples/shared/catalog';

describe('ECS example catalog', () => {
    it('contains one typed entry for every runnable example page', () => {
        const paths = readdirSync('examples')
            .filter(path => path.endsWith('.html') && path !== 'index.html')
            .sort();
        expect(EXAMPLE_CATALOG.map(entry => entry.path).sort()).toEqual(paths);
        for (const entry of EXAMPLE_CATALOG) {
            expect(existsSync(join('examples', entry.path.replace(/\.html$/u, '.ts')))).toBe(true);
            expect(entry.supportedBackends).toEqual(['webgl2', 'webgpu']);
        }
    });
});
