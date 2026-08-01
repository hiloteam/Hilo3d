import { describe, expect, it } from 'vitest';
import { normalizeRenderTargetParameters } from '../../../src/render/RenderTarget';

describe('RenderTarget depth convention', () => {
    it('derives clear and comparison defaults from reversed-Z', () => {
        const normalized = normalizeRenderTargetParameters({
            width: 16,
            height: 8,
            depthStencilAttachment: { sampled: true, depthMode: 'reversed' }
        });
        expect(normalized.depthStencilAttachment).toMatchObject({
            depthMode: 'reversed',
            depthClearValue: 0,
            compare: 'greater-equal'
        });
    });

    it('retains standard depth defaults for compatibility', () => {
        const normalized = normalizeRenderTargetParameters({ width: 4, height: 4 });
        expect(normalized.depthStencilAttachment).toMatchObject({
            depthMode: 'standard',
            depthClearValue: 1,
            compare: 'less-equal'
        });
    });
});
