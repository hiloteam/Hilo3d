import { describe, expect, it, vi } from 'vitest';
import { NagaShaderTranslator } from '../../../src/renderer/shader/GlslToWgsl';

const naga = vi.hoisted(() => ({
    initialize: vi.fn<() => Promise<void>>()
}));

vi.mock('web-naga', () => ({ default: naga.initialize }));

describe('NagaShaderTranslator initialization', () => {
    it('shares a failed initialization and lets a later translator retry', async () => {
        const failure = new Error('temporary WASM initialization failure');
        naga.initialize.mockRejectedValueOnce(failure).mockResolvedValue(undefined);
        const first = new NagaShaderTranslator();
        const second = new NagaShaderTranslator();
        const firstInitialization = first.initialize();
        const secondInitialization = second.initialize();

        await expect(firstInitialization).rejects.toBe(failure);
        await expect(secondInitialization).rejects.toBe(failure);
        expect(naga.initialize).toHaveBeenCalledTimes(1);

        await expect(new NagaShaderTranslator().initialize()).resolves.toBeUndefined();
        expect(naga.initialize).toHaveBeenCalledTimes(2);
    });
});
