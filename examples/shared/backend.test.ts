import { describe, expect, it } from 'vitest';
import { resolveExampleBackend } from './backend';

describe('example backend selection', () => {
    it('defaults missing or empty selections to WebGPU', () => {
        expect(resolveExampleBackend('https://example.test/examples/index.html')).toBe('webgpu');
        expect(resolveExampleBackend('https://example.test/examples/index.html?backend=')).toBe(
            'webgpu'
        );
    });

    it('preserves explicit portable backend selections', () => {
        expect(
            resolveExampleBackend('https://example.test/examples/index.html?backend=webgpu')
        ).toBe('webgpu');
        expect(
            resolveExampleBackend('https://example.test/examples/index.html?backend=webgl2')
        ).toBe('webgl2');
    });

    it('rejects unsupported backend selections', () => {
        expect(() =>
            resolveExampleBackend('https://example.test/examples/index.html?backend=webgl')
        ).toThrow('Unsupported example backend "webgl"');
    });
});
