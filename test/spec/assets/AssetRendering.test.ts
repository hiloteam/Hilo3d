import { expect, it } from 'vitest';
import { renderAssets } from '../../../addon-assets/test/fixtures/render-assets';

for (const backend of ['webgl2', 'webgpu'] as const) {
    it(`renders worker-decoded KTX2 and restores residency through ${backend}`, async () => {
        const result = await renderAssets(backend, '/test/asset/ktx2/etc1s.ktx2');
        expect(result.stableIdentity).toBe(true);
        expect(result.after).toEqual(result.before);
        expect(new Set(result.before).size).toBeGreaterThan(16);
        expect(result.before.filter((_, index) => index % 4 !== 3).some(value => value > 40)).toBe(
            true
        );
    }, 15000);
}
