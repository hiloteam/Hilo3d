import { describe, expect, it, vi } from 'vitest';
import {
    createCubismCoreSource,
    type CubismCoreUtils
} from '../../../addon-live2d/src/Live2DSource';

const utils: CubismCoreUtils = {
    hasBlendAdditiveBit: flags => (flags & 1) !== 0,
    hasBlendMultiplicativeBit: flags => (flags & 2) !== 0,
    hasIsDoubleSidedBit: flags => (flags & 4) !== 0,
    hasIsInvertedMaskBit: flags => (flags & 8) !== 0,
    hasIsVisibleBit: flags => (flags & 1) !== 0
};

function at<T>(values: ArrayLike<T>, index: number): T {
    const value = values[index];
    if (value === undefined) throw new Error(`Missing Live2D value at index ${String(index)}`);
    return value;
}

function model() {
    const orders = new Int32Array([2, 0, 1]);
    return {
        drawables: {
            count: 3,
            ids: ['body', 'eyes', 'highlight'],
            constantFlags: new Uint8Array([4, 8, 0]),
            dynamicFlags: new Uint8Array([1, 1, 0]),
            textureIndices: new Int32Array([0, 1, 0]),
            opacities: new Float32Array([1, 0.5, 0.25]),
            maskCounts: new Int32Array([0, 1, 1]),
            masks: [new Int32Array(), new Int32Array([0]), new Int32Array([0])],
            vertexCounts: new Int32Array([3, 3, 3]),
            vertexPositions: Array.from(
                { length: 3 },
                () => new Float32Array([-1, -1, 1, -1, 0, 1])
            ),
            vertexUvs: Array.from({ length: 3 }, () => new Float32Array([0, 0, 1, 0, 0.5, 1])),
            indexCounts: new Int32Array([3, 3, 3]),
            indices: Array.from({ length: 3 }, () => new Uint16Array([0, 1, 2])),
            multiplyColors: new Float32Array([1, 1, 1, 1, 0.5, 0.5, 0.5, 1, 1, 0, 0, 1]),
            screenColors: new Float32Array(12),
            blendModes: new Int32Array([0, 1, 2])
        },
        offscreens: { count: 0 },
        getRenderOrders: (): Int32Array => orders,
        update: vi.fn(),
        release: vi.fn()
    };
}

describe('Cubism Core source adapter', () => {
    it('preserves Core buffers, masks, render order and supported packed blend modes', () => {
        const core = model();
        const source = createCubismCoreSource(core, utils);
        expect(source.drawables.map(drawable => drawable.blendMode)).toEqual([
            'normal',
            'additive',
            'multiply'
        ]);
        expect(source.drawables[0]).toMatchObject({
            id: 'body',
            textureIndex: 0,
            renderOrder: 2,
            visible: true,
            doubleSided: true
        });
        expect(source.drawables[1]).toMatchObject({ opacity: 0.5, masks: [0], invertedMask: true });
        expect(at(source.drawables, 2).visible).toBe(false);
        expect(at(source.drawables, 0).positions).toBe(core.drawables.vertexPositions[0]);
        expect(at(source.drawables, 0).uvs).toBe(core.drawables.vertexUvs[0]);
        expect(at(source.drawables, 0).indices).toBe(core.drawables.indices[0]);
        expect(at(source.drawables, 1).multiplyColor.buffer).toBe(
            core.drawables.multiplyColors.buffer
        );
    });

    it('refreshes state even when Framework has reset change flags, without owning Core', () => {
        const core = model();
        const source = createCubismCoreSource(core, utils);
        const first = at(source.drawables, 0);
        const color = first.multiplyColor;
        at(core.drawables.vertexPositions, 0)[0] = 0.75;
        core.drawables.opacities[0] = 0.25;
        core.drawables.multiplyColors[0] = 0.5;
        core.drawables.screenColors[1] = 0.75;
        core.getRenderOrders()[0] = 9;
        core.drawables.dynamicFlags[0] = 1;
        core.drawables.dynamicFlags[1] = 0;
        source.sync();
        expect(source.drawables[0]).toBe(first);
        expect(first.multiplyColor).toBe(color);
        expect(first.positions[0]).toBe(0.75);
        expect(first.opacity).toBe(0.25);
        expect(first.renderOrder).toBe(9);
        expect(first.multiplyColor[0]).toBe(0.5);
        expect(first.screenColor[1]).toBe(0.75);
        expect(first.visible).toBe(true);
        expect(at(source.drawables, 1).visible).toBe(false);
        expect(core.update).not.toHaveBeenCalled();
        expect(core.release).not.toHaveBeenCalled();
    });

    it('supports older Core render orders and blend flags', () => {
        const core = model();
        const { blendModes, ...drawables } = core.drawables;
        expect(blendModes.length).toBe(3);
        drawables.constantFlags.set([0, 1, 2]);
        const source = createCubismCoreSource(
            { drawables: { ...drawables, renderOrders: core.getRenderOrders() } },
            utils
        );
        expect(source.drawables.map(drawable => drawable.blendMode)).toEqual([
            'normal',
            'additive',
            'multiply'
        ]);
    });

    it('rejects unsupported advanced blend and offscreen composition explicitly', () => {
        const core = model();
        core.drawables.blendModes[1] = 3;
        expect(() => createCubismCoreSource(core, utils)).toThrow(
            'unsupported Cubism 5.3 blend mode 3'
        );
        core.drawables.blendModes[1] = 256;
        expect(() => createCubismCoreSource(core, utils)).toThrow(
            'unsupported Cubism 5.3 blend mode 256'
        );
        core.drawables.blendModes[1] = 1;
        core.offscreens.count = 1;
        expect(() => createCubismCoreSource(core, utils)).toThrow('grouped offscreen composition');
    });

    it('accepts the oversized blend buffer exposed by Core 5.3 without reading trailing capacity', () => {
        const core = model();
        core.drawables.blendModes = new Int32Array([0, 1, 2, 256, 256, 256]);
        const source = createCubismCoreSource(core, utils);
        source.sync();
        expect(source.drawables.map(drawable => drawable.blendMode)).toEqual([
            'normal',
            'additive',
            'multiply'
        ]);
        core.drawables.blendModes = new Int32Array(2);
        expect(() => {
            source.sync();
        }).toThrow('blend modes buffer is shorter');
    });

    it('rejects malformed buffers, duplicate IDs, invalid indices and invalid mask references', () => {
        const truncated = model();
        truncated.drawables.vertexPositions[0] = new Float32Array(2);
        expect(() => createCubismCoreSource(truncated, utils)).toThrow('positions length');
        const duplicate = model();
        duplicate.drawables.ids[1] = 'body';
        expect(() => createCubismCoreSource(duplicate, utils)).toThrow('duplicate drawable ID');
        const invalidIndex = model();
        at(invalidIndex.drawables.indices, 0)[0] = 3;
        expect(() => createCubismCoreSource(invalidIndex, utils)).toThrow('invalid vertex index');
        const invalidMask = model();
        at(invalidMask.drawables.masks, 1)[0] = 3;
        expect(() => createCubismCoreSource(invalidMask, utils)).toThrow('invalid mask reference');
    });

    it('rejects invalid live updates and changed topology before publishing frame scalars', () => {
        const core = model();
        const source = createCubismCoreSource(core, utils);
        core.drawables.opacities[0] = 0.25;
        at(core.drawables.vertexPositions, 2)[0] = Number.NaN;
        expect(() => {
            source.sync();
        }).toThrow('non-finite');
        expect(at(source.drawables, 0).opacity).toBe(1);
        at(core.drawables.vertexPositions, 2)[0] = 0;
        at(core.drawables.masks, 2)[0] = 1;
        expect(() => {
            source.sync();
        }).toThrow('mask topology changed');
        at(core.drawables.masks, 2)[0] = 0;
        core.drawables.opacities[1] = 2;
        expect(() => {
            source.sync();
        }).toThrow('opacity must be in [0, 1]');
    });

    it('refreshes color views when Core changes buffers or moves a view within one buffer', () => {
        const core = model();
        const source = createCubismCoreSource(core, utils);
        const colors = new Float32Array(16);
        colors.fill(0.25);
        core.drawables.multiplyColors = colors.subarray(0, 12);
        source.sync();
        expect(at(source.drawables, 0).multiplyColor[0]).toBe(0.25);
        colors[4] = 0.75;
        core.drawables.multiplyColors = colors.subarray(4, 16);
        source.sync();
        expect(at(source.drawables, 0).multiplyColor[0]).toBe(0.75);
    });

    it('rejects texture, blend and culling policy changes after construction', () => {
        const core = model();
        const source = createCubismCoreSource(core, utils);
        core.drawables.textureIndices[0] = 1;
        expect(() => {
            source.sync();
        }).toThrow('fixed material policy changed');
        core.drawables.textureIndices[0] = 0;
        core.drawables.blendModes[0] = 1;
        expect(() => {
            source.sync();
        }).toThrow('fixed material policy changed');
        core.drawables.blendModes[0] = 0;
        core.drawables.constantFlags[0] = 0;
        expect(() => {
            source.sync();
        }).toThrow('fixed material policy changed');
    });

    it('clamps Core Float32 endpoint rounding while rejecting material opacity errors', () => {
        const core = model();
        core.drawables.opacities[0] = 1.0000001192092896;
        core.drawables.opacities[1] = -1.1920928955078125e-7;
        const source = createCubismCoreSource(core, utils);
        expect(at(source.drawables, 0).opacity).toBe(1);
        expect(at(source.drawables, 1).opacity).toBe(0);
        // The official Haru 5-r.5 fixture starts with this interpolation overshoot.
        core.drawables.opacities[0] = 1.0000499486923218;
        core.drawables.opacities[1] = -0.0000499486923218;
        source.sync();
        expect(at(source.drawables, 0).opacity).toBe(1);
        expect(at(source.drawables, 1).opacity).toBe(0);
        core.drawables.opacities[0] = 1.0002;
        expect(() => {
            source.sync();
        }).toThrow('opacity must be in [0, 1]');
        core.drawables.opacities[0] = -0.0002;
        expect(() => {
            source.sync();
        }).toThrow('opacity must be in [0, 1]');
        core.drawables.opacities[0] = Number.NaN;
        expect(() => {
            source.sync();
        }).toThrow('opacity must be in [0, 1]');
    });

    it('accepts equivalent replacement UV/index buffers but rejects changes to their content', () => {
        const core = model();
        const source = createCubismCoreSource(core, utils);
        core.drawables.vertexUvs[0] = at(core.drawables.vertexUvs, 0).slice();
        core.drawables.indices[0] = at(core.drawables.indices, 0).slice();
        source.sync();
        expect(at(source.drawables, 0).uvs).toBe(core.drawables.vertexUvs[0]);
        expect(at(source.drawables, 0).indices).toBe(core.drawables.indices[0]);
        at(core.drawables.vertexUvs, 0)[0] = 0.5;
        expect(() => {
            source.sync();
        }).toThrow('UV topology changed');
        at(core.drawables.vertexUvs, 0)[0] = 0;
        at(core.drawables.indices, 0)[0] = 1;
        expect(() => {
            source.sync();
        }).toThrow('index topology changed');
    });
});
