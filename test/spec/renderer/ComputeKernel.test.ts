import { describe, expect, it } from 'vitest';
import ComputeKernel from '../../../src/render/compute/ComputeKernel';
import ComputeShader from '../../../src/render/compute/ComputeShader';

function shader(): ComputeShader {
    return new ComputeShader({
        label: 'particles',
        source: '@compute @workgroup_size(64) fn main() {}',
        workgroupSize: [64],
        bindings: []
    });
}

describe('ComputeKernel', () => {
    it('snapshots sorted immutable constants and inherits the shader label', () => {
        const constants = { zCount: 4, enabled: true, 7: 2 };
        const kernel = new ComputeKernel({ shader: shader(), constants });

        constants.zCount = 8;
        expect(kernel.label).toBe('particles');
        expect(Object.keys(kernel.constants)).toEqual(['7', 'enabled', 'zCount']);
        expect(kernel.constants).toEqual({ 7: 2, enabled: true, zCount: 4 });
        expect(Object.isFrozen(kernel.constants)).toBe(true);
        expect(Object.isFrozen(kernel)).toBe(true);
    });

    it('rejects invalid shaders, labels, constant names, values, and containers', () => {
        expect(() => new ComputeKernel(null as never)).toThrow(/descriptor must be an object/u);
        expect(() => new ComputeKernel({ shader: {} as ComputeShader })).toThrow(
            /requires a ComputeShader/u
        );
        expect(() => new ComputeKernel({ shader: shader(), label: '' })).toThrow(/non-empty/u);
        expect(() => new ComputeKernel({ shader: shader(), constants: { 'bad-name': 1 } })).toThrow(
            /WGSL name or numeric pipeline constant ID/u
        );
        expect(() => new ComputeKernel({ shader: shader(), constants: { 65536: 1 } })).toThrow(
            /numeric pipeline constant ID/u
        );
        expect(() => new ComputeKernel({ shader: shader(), constants: { value: NaN } })).toThrow(
            /must be finite/u
        );
        expect(
            () =>
                new ComputeKernel({
                    shader: shader(),
                    constants: { value: 'one' as unknown as number }
                })
        ).toThrow(/finite number or boolean/u);
        expect(
            () =>
                new ComputeKernel({
                    shader: shader(),
                    constants: [] as unknown as Readonly<Record<string, number>>
                })
        ).toThrow(/must be an object/u);
    });
});
