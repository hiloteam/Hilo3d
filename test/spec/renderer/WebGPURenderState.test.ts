import { describe, expect, it } from 'vitest';
import Material from '../../../src/material/Material';
import {
    ALWAYS,
    BACK,
    CCW,
    CONSTANT_ALPHA,
    CONSTANT_COLOR,
    CW,
    DECR,
    DECR_WRAP,
    DST_ALPHA,
    DST_COLOR,
    EQUAL,
    FRONT,
    FRONT_AND_BACK,
    FUNC_ADD,
    FUNC_REVERSE_SUBTRACT,
    FUNC_SUBTRACT,
    GEQUAL,
    GREATER,
    INCR,
    INCR_WRAP,
    INVERT,
    KEEP,
    LEQUAL,
    LESS,
    LINES,
    LINE_LOOP,
    LINE_STRIP,
    NEVER,
    NOTEQUAL,
    ONE,
    ONE_MINUS_CONSTANT_ALPHA,
    ONE_MINUS_CONSTANT_COLOR,
    ONE_MINUS_DST_ALPHA,
    ONE_MINUS_DST_COLOR,
    ONE_MINUS_SRC_ALPHA,
    ONE_MINUS_SRC_COLOR,
    POINTS,
    REPLACE,
    SRC_ALPHA,
    SRC_ALPHA_SATURATE,
    SRC_COLOR,
    TRIANGLES,
    TRIANGLE_FAN,
    TRIANGLE_STRIP,
    ZERO
} from '../../../src/constants/webgl';
import { MAX, MIN } from '../../../src/constants/webgl2';
import {
    createWebGPURenderState,
    mapWebGPUBlendFactor,
    mapWebGPUBlendOperation,
    mapWebGPUCompareFunction,
    mapWebGPUPrimitiveTopology,
    mapWebGPUStencilOperation,
    resolveWebGPUFragmentColorFormats,
    resolveWebGPUColorWriteMask,
    WEBGPU_COLOR_WRITE
} from '../../../src/renderer/webgpu/WebGPURenderState';

describe('WebGPURenderState', () => {
    it('maps sparse fragment locations without binding unwritten pass attachments', () => {
        const formats = resolveWebGPUFragmentColorFormats(
            [
                { name: 'albedo', type: 'vec4', location: 0 },
                { name: 'emissive', type: 'vec4', location: 2 }
            ],
            ['rgba8unorm', 'rgba16float', 'rgba32float', 'rgba8unorm-srgb']
        );

        expect(formats).toEqual(['rgba8unorm', null, 'rgba32float', null]);
        expect(Object.isFrozen(formats)).toBe(true);
        expect(
            createWebGPURenderState(new Material({ depthTest: false }), TRIANGLES, {
                colorFormats: formats
            }).colorTargets
        ).toEqual([
            { format: 'rgba8unorm', writeMask: WEBGPU_COLOR_WRITE.ALL },
            null,
            { format: 'rgba32float', writeMask: WEBGPU_COLOR_WRITE.ALL },
            null
        ]);
        expect(
            resolveWebGPUFragmentColorFormats(
                [{ name: 'normal', type: 'vec4', location: 1 }],
                ['rgba8unorm', 'rgba16float', 'rgba32float']
            )
        ).toEqual([null, 'rgba16float', null]);
        expect(resolveWebGPUFragmentColorFormats([], ['rgba8unorm', 'rgba16float'])).toEqual([
            null,
            null
        ]);
    });

    it('rejects duplicate, invalid and unattached fragment output locations', () => {
        expect(() =>
            resolveWebGPUFragmentColorFormats(
                [
                    { name: 'first', type: 'vec4', location: 0 },
                    { name: 'second', type: 'vec4', location: 0 }
                ],
                ['rgba8unorm']
            )
        ).toThrow(/declared more than once/);
        expect(() =>
            resolveWebGPUFragmentColorFormats(
                [{ name: 'negative', type: 'vec4', location: -1 }],
                ['rgba8unorm']
            )
        ).toThrow(/non-negative safe integer/);
        expect(() =>
            resolveWebGPUFragmentColorFormats(
                [{ name: 'missing', type: 'vec4', location: 2 }],
                ['rgba8unorm', 'rgba16float']
            )
        ).toThrow(/has no color attachment/);
    });

    it('maps the default material to explicit immutable WebGPU state', () => {
        const state = createWebGPURenderState(new Material(), TRIANGLES, {
            colorFormats: ['bgra8unorm'],
            depthStencilFormat: 'depth24plus'
        });

        expect(state.primitive).toEqual({
            topology: 'triangle-list',
            frontFace: 'ccw',
            cullMode: 'back'
        });
        expect(state.colorTargets).toEqual([
            { format: 'bgra8unorm', writeMask: WEBGPU_COLOR_WRITE.ALL }
        ]);
        expect(state.depthStencil).toEqual({
            format: 'depth24plus',
            depthCompare: 'less-equal',
            depthWriteEnabled: true
        });
        expect(state.multisample).toEqual({
            count: 1,
            mask: 0xffffffff,
            alphaToCoverageEnabled: false
        });
        expect(state.dynamic).toEqual({ depthRange: [0, 1], stencilReference: 0 });
        expect(state.usesStencil).toBe(false);
        expect(Object.isFrozen(state)).toBe(true);
        expect(Object.isFrozen(state.primitive)).toBe(true);
        expect(Object.isFrozen(state.colorTargets)).toBe(true);
    });

    it('maps blend, cull, stencil, color masks, strips, and multisampling', () => {
        const material = new Material({
            frontFace: CW,
            cullFace: true,
            cullFaceType: FRONT,
            depthFunc: GREATER,
            depthMask: false,
            depthRange: [0.2, 0.8],
            blend: true,
            blendSrc: SRC_ALPHA,
            blendDst: ONE_MINUS_SRC_ALPHA,
            blendSrcAlpha: ONE,
            blendDstAlpha: ONE_MINUS_DST_ALPHA,
            blendEquation: FUNC_REVERSE_SUBTRACT,
            blendEquationAlpha: FUNC_SUBTRACT,
            stencilTest: true,
            stencilMask: 0x0f,
            stencilFunc: EQUAL,
            stencilFuncRef: 7,
            stencilFuncMask: 0xf0,
            stencilOpFail: REPLACE,
            stencilOpZFail: INCR_WRAP,
            stencilOpZPass: DECR,
            sampleAlphaToCoverage: true
        });
        const state = createWebGPURenderState(material, TRIANGLE_STRIP, {
            colorFormats: ['rgba8unorm', null],
            colorMasks: [[true, false, true, false], 0],
            depthStencilFormat: 'depth24plus-stencil8',
            sampleCount: 4,
            stripIndexFormat: 'uint16'
        });

        expect(state.primitive).toEqual({
            topology: 'triangle-strip',
            frontFace: 'cw',
            cullMode: 'front',
            stripIndexFormat: 'uint16'
        });
        expect(state.colorTargets).toEqual([
            {
                format: 'rgba8unorm',
                writeMask: WEBGPU_COLOR_WRITE.RED | WEBGPU_COLOR_WRITE.BLUE,
                blend: {
                    color: {
                        srcFactor: 'src-alpha',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'reverse-subtract'
                    },
                    alpha: {
                        srcFactor: 'one',
                        dstFactor: 'one-minus-dst-alpha',
                        operation: 'subtract'
                    }
                }
            },
            null
        ]);
        expect(state.depthStencil).toEqual({
            format: 'depth24plus-stencil8',
            depthCompare: 'greater',
            depthWriteEnabled: false,
            stencilFront: {
                compare: 'equal',
                failOp: 'replace',
                depthFailOp: 'increment-wrap',
                passOp: 'decrement-clamp'
            },
            stencilBack: {
                compare: 'equal',
                failOp: 'replace',
                depthFailOp: 'increment-wrap',
                passOp: 'decrement-clamp'
            },
            stencilReadMask: 0xf0,
            stencilWriteMask: 0x0f
        });
        expect(state.multisample).toMatchObject({ count: 4, alphaToCoverageEnabled: true });
        expect(state.dynamic).toEqual({ depthRange: [0.2, 0.8], stencilReference: 7 });
        expect(state.usesStencil).toBe(true);
    });

    it.each([
        [POINTS, 'point-list'],
        [LINES, 'line-list'],
        [LINE_STRIP, 'line-strip'],
        [TRIANGLES, 'triangle-list'],
        [TRIANGLE_STRIP, 'triangle-strip']
    ] as const)('maps draw mode %s to %s', (mode, topology) => {
        expect(mapWebGPUPrimitiveTopology(mode)).toBe(topology);
    });

    it('applies an index format to both indexed strip topologies', () => {
        const material = new Material();
        for (const mode of [LINE_STRIP, TRIANGLE_STRIP]) {
            expect(
                createWebGPURenderState(material, mode, {
                    colorFormats: ['bgra8unorm'],
                    depthStencilFormat: 'depth24plus',
                    stripIndexFormat: 'uint16'
                }).primitive
            ).toMatchObject({ stripIndexFormat: 'uint16' });
        }
    });

    it.each([
        [NEVER, 'never'],
        [LESS, 'less'],
        [EQUAL, 'equal'],
        [LEQUAL, 'less-equal'],
        [GREATER, 'greater'],
        [NOTEQUAL, 'not-equal'],
        [GEQUAL, 'greater-equal'],
        [ALWAYS, 'always']
    ] as const)('maps comparison %s to %s', (value, expected) => {
        expect(mapWebGPUCompareFunction(value)).toBe(expected);
    });

    it.each([
        [KEEP, 'keep'],
        [ZERO, 'zero'],
        [REPLACE, 'replace'],
        [INCR, 'increment-clamp'],
        [INCR_WRAP, 'increment-wrap'],
        [DECR, 'decrement-clamp'],
        [DECR_WRAP, 'decrement-wrap'],
        [INVERT, 'invert']
    ] as const)('maps stencil operation %s to %s', (value, expected) => {
        expect(mapWebGPUStencilOperation(value)).toBe(expected);
    });

    it.each([
        [ZERO, 'zero'],
        [ONE, 'one'],
        [SRC_COLOR, 'src'],
        [ONE_MINUS_SRC_COLOR, 'one-minus-src'],
        [SRC_ALPHA, 'src-alpha'],
        [ONE_MINUS_SRC_ALPHA, 'one-minus-src-alpha'],
        [DST_ALPHA, 'dst-alpha'],
        [ONE_MINUS_DST_ALPHA, 'one-minus-dst-alpha'],
        [DST_COLOR, 'dst'],
        [ONE_MINUS_DST_COLOR, 'one-minus-dst'],
        [SRC_ALPHA_SATURATE, 'src-alpha-saturated'],
        [CONSTANT_COLOR, 'constant'],
        [CONSTANT_ALPHA, 'constant'],
        [ONE_MINUS_CONSTANT_COLOR, 'one-minus-constant'],
        [ONE_MINUS_CONSTANT_ALPHA, 'one-minus-constant']
    ] as const)('maps blend factor %s to %s', (value, expected) => {
        expect(mapWebGPUBlendFactor(value)).toBe(expected);
    });

    it.each([
        [FUNC_ADD, 'add'],
        [FUNC_SUBTRACT, 'subtract'],
        [FUNC_REVERSE_SUBTRACT, 'reverse-subtract'],
        [MIN, 'min'],
        [MAX, 'max']
    ] as const)('maps blend operation %s to %s', (value, expected) => {
        expect(mapWebGPUBlendOperation(value)).toBe(expected);
    });

    it('keeps dynamic state out of the immutable cache key', () => {
        const first = new Material({ depthRange: [0, 1], stencilTest: true, stencilFuncRef: 1 });
        const second = new Material({
            depthRange: [0.25, 0.75],
            stencilTest: true,
            stencilFuncRef: 99
        });
        const options = {
            colorFormats: ['rgba8unorm'] as const,
            depthStencilFormat: 'depth24plus-stencil8' as const
        };

        const firstState = createWebGPURenderState(first, TRIANGLES, options);
        const secondState = createWebGPURenderState(second, TRIANGLES, options);
        expect(firstState.cacheKey).toBe(secondState.cacheKey);
        expect(firstState.dynamic).not.toEqual(secondState.dynamic);
    });

    it('rejects unsupported or inconsistent state instead of silently degrading it', () => {
        expect(() => mapWebGPUPrimitiveTopology(LINE_LOOP)).toThrow(/explicit line list/);
        expect(() => mapWebGPUPrimitiveTopology(TRIANGLE_FAN)).toThrow(/explicit triangle list/);
        expect(() => mapWebGPUPrimitiveTopology(123456)).toThrow(/Unsupported/);
        expect(() => createWebGPURenderState(new Material({ wireframe: true }), TRIANGLES)).toThrow(
            /converted to LINES/
        );
        expect(() => createWebGPURenderState(new Material(), TRIANGLES)).toThrow(
            /depthStencilFormat/
        );
        expect(() =>
            createWebGPURenderState(new Material({ stencilTest: true }), TRIANGLES, {
                depthStencilFormat: 'depth24plus'
            })
        ).toThrow(/stencil aspect/);
        expect(() =>
            createWebGPURenderState(new Material({ depthTest: false }), TRIANGLES, {
                colorFormats: ['rgba8unorm'],
                colorMasks: []
            })
        ).toThrow(/length/);
        expect(() =>
            createWebGPURenderState(
                new Material({ depthTest: false, sampleAlphaToCoverage: true }),
                TRIANGLES,
                { colorFormats: ['rgba8unorm'] }
            )
        ).toThrow(/multisampling/);
        expect(() => resolveWebGPUColorWriteMask(0x10)).toThrow(/unknown flag/);
    });

    it('disables culling and depth/stencil writes when their tests are disabled', () => {
        const material = new Material({
            frontFace: CCW,
            cullFace: true,
            cullFaceType: FRONT_AND_BACK,
            depthTest: false,
            stencilTest: false
        });
        const state = createWebGPURenderState(material, LINES, {
            depthStencilFormat: 'depth24plus-stencil8'
        });

        expect(state.primitive.cullMode).toBe('none');
        expect(state.depthStencil).toMatchObject({
            depthCompare: 'always',
            depthWriteEnabled: false,
            stencilReadMask: 0xffffffff,
            stencilWriteMask: 0,
            stencilFront: {
                compare: 'always',
                failOp: 'keep',
                depthFailOp: 'keep',
                passOp: 'keep'
            }
        });
        expect(BACK).not.toBe(FRONT_AND_BACK);
    });

    it('honors canvas depth and stencil availability independently', () => {
        const stencilOnly = createWebGPURenderState(
            new Material({ stencilTest: true, stencilFunc: EQUAL, stencilFuncRef: 5 }),
            TRIANGLES,
            {
                depthStencilFormat: 'depth24plus-stencil8',
                depthTestEnabled: false,
                stencilTestEnabled: true
            }
        );

        expect(stencilOnly.depthStencil).toMatchObject({
            depthCompare: 'always',
            depthWriteEnabled: false,
            stencilFront: { compare: 'equal' }
        });
        expect(stencilOnly.dynamic.stencilReference).toBe(5);
        expect(stencilOnly.usesStencil).toBe(true);

        const colorOnly = createWebGPURenderState(new Material(), TRIANGLES, {
            colorFormats: ['rgba8unorm'],
            depthTestEnabled: false,
            stencilTestEnabled: false
        });
        expect(colorOnly.depthStencil).toBeUndefined();
        expect(colorOnly.usesStencil).toBe(false);
    });
});
