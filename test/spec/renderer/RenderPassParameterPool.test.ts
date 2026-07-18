import { describe, expect, it } from 'vitest';
import { RenderPassParameterPool } from '../../../src/render/pipeline/RenderPassParameterPool';

describe('RenderPassParameterPool public surface', () => {
    it('does not expose ownership acquisition or constructor callbacks', () => {
        const pool = new RenderPassParameterPool(
            () => ({ value: 0 }),
            parameters => {
                parameters.value = 0;
            }
        );

        expect('acquire' in pool).toBe(false);
        expect('factory' in pool).toBe(false);
        expect('reset' in pool).toBe(false);
        expect(Object.keys(pool)).toEqual([]);
        expect(pool.capacity).toBe(0);
    });
});
