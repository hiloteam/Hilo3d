import { describe, it } from 'vitest';
import { verifyStableTransparentComposition } from '../../fixtures/stable-transparent-composition';

describe.each(['sorted', 'weighted'] as const)('composed %s transparency', mode => {
    describe('stable surface composition on webgl2', () => {
        it.each(['standard', 'reversed'] as const)(
            'retains the previous camera opaque depth across %s temporal views',
            depthMode => verifyStableTransparentComposition('webgl2', mode, depthMode),
            30_000
        );
    });
});
