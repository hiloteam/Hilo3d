import { describe, expect, it } from 'vitest';
import ComputeSampler from '../../../src/render/compute/ComputeSampler';

describe('ComputeSampler', () => {
    it('normalizes and freezes a portable sampler descriptor', () => {
        const sampler = new ComputeSampler({
            label: 'linear repeat',
            addressModeU: 'repeat',
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            maxAnisotropy: 4
        });

        expect(sampler).toMatchObject({
            label: 'linear repeat',
            addressModeU: 'repeat',
            addressModeV: 'clamp-to-edge',
            magFilter: 'linear',
            lodMinClamp: 0,
            lodMaxClamp: 32,
            maxAnisotropy: 4
        });
        expect(Object.isFrozen(sampler)).toBe(true);
    });

    it('rejects invalid descriptors before an RHI sampler is created', () => {
        expect(() => new ComputeSampler([] as never)).toThrow(/must be an object/u);
        expect(() => new ComputeSampler({ addressModeU: 'border' as never })).toThrow(
            /unsupported/u
        );
        expect(() => new ComputeSampler({ lodMinClamp: 2, lodMaxClamp: 1 })).toThrow(/min <= max/u);
        expect(() => new ComputeSampler({ maxAnisotropy: 2 })).toThrow(/linear filtering/u);
    });
});
