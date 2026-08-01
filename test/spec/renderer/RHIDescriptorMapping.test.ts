import { describe, expect, it } from 'vitest';
import GeometryData from '../../../src/geometry/GeometryData';
import Material from '../../../src/material/Material';
import {
    ALWAYS,
    BACK,
    CCW,
    CW,
    DST_ALPHA,
    EQUAL,
    FRONT,
    FRONT_AND_BACK,
    FUNC_REVERSE_SUBTRACT,
    FUNC_SUBTRACT,
    GEQUAL,
    GREATER,
    INCR_WRAP,
    KEEP,
    LEQUAL,
    LESS,
    LINES,
    LINE_LOOP,
    LINE_STRIP,
    NEVER,
    NOTEQUAL,
    ONE,
    ONE_MINUS_DST_ALPHA,
    POINTS,
    REPLACE,
    TRIANGLES,
    TRIANGLE_FAN,
    TRIANGLE_STRIP,
    UNSIGNED_INT,
    ZERO
} from '../../../src/constants/webgl';
import type { RHITextureFormat, RHITextureFormatCapabilities } from '../../../src/render/rhi/core';
import {
    createRHIMeshDrawPipelineState,
    mapRHIBlendFactor,
    mapRHIBlendOperation,
    mapRHICompareFunction,
    mapRHICullMode,
    mapRHIDefaultBlendState,
    mapRHIDepthStencilState,
    mapRHIFloat32PositionLayout,
    mapRHIFrontFace,
    mapRHIIndexFormat,
    mapRHIMeshDrawDynamicState,
    mapRHIMultisampleState,
    mapRHIPrimitiveTopology,
    mapRHIStencilOperation,
    validateRHIMeshDrawColorTargets,
    validateRHIMeshDepthOnlyTarget,
    validateRHIMeshDrawTarget,
    type RHIMeshDrawTargetCapabilities
} from '../../../src/render/renderer/RHIDescriptorMapping';

function formatCapabilities(
    format: RHITextureFormat,
    options: {
        readonly sampleCounts?: readonly number[];
        readonly renderable?: boolean;
        readonly blendable?: boolean;
    } = {}
): RHITextureFormatCapabilities {
    const isDepth = format.startsWith('depth');
    return Object.freeze({
        sampled: true,
        filterable: !isDepth,
        renderable: options.renderable ?? true,
        blendable: options.blendable ?? !isDepth,
        storage: false,
        sampleCounts: Object.freeze([...(options.sampleCounts ?? [1, 4])])
    });
}

function targetCapabilities(
    options: {
        readonly colorSampleCounts?: readonly number[];
        readonly colorRenderable?: boolean;
        readonly colorBlendable?: boolean;
    } = {}
): RHIMeshDrawTargetCapabilities {
    return {
        getTextureFormatCapabilities(format: RHITextureFormat): RHITextureFormatCapabilities {
            if (format.startsWith('depth')) return formatCapabilities(format);
            return formatCapabilities(format, {
                ...(options.colorSampleCounts === undefined
                    ? {}
                    : { sampleCounts: options.colorSampleCounts }),
                ...(options.colorRenderable === undefined
                    ? {}
                    : { renderable: options.colorRenderable }),
                ...(options.colorBlendable === undefined
                    ? {}
                    : { blendable: options.colorBlendable })
            });
        }
    };
}

describe('RHIDescriptorMapping geometry', () => {
    it.each([
        [1, 'float32'],
        [2, 'float32x2'],
        [3, 'float32x3'],
        [4, 'float32x4']
    ] as const)('maps a tightly packed Float32 position size %i', (size, format) => {
        const position = new GeometryData(new Float32Array(size * 2), size);
        const layout = mapRHIFloat32PositionLayout(position, 3);

        expect(layout).toEqual({
            arrayStride: size * Float32Array.BYTES_PER_ELEMENT,
            stepMode: 'vertex',
            attributes: [{ format, offset: 0, shaderLocation: 3 }]
        });
        expect(Object.isFrozen(layout)).toBe(true);
        expect(Object.isFrozen(layout.attributes)).toBe(true);
        expect(Object.isFrozen(layout.attributes[0])).toBe(true);
    });

    it('preserves a valid interleaved Float32 stride and offset', () => {
        const position = new GeometryData(new Float32Array(10), 3, {
            stride: 20,
            offset: 4
        });

        expect(mapRHIFloat32PositionLayout(position, 0)).toEqual({
            arrayStride: 20,
            stepMode: 'vertex',
            attributes: [{ format: 'float32x3', offset: 4, shaderLocation: 0 }]
        });
    });

    it('reuses an exact position layout and replaces it only when layout fields change', () => {
        const position = new GeometryData(new Float32Array(9), 3);
        const first = mapRHIFloat32PositionLayout(position, 0);

        expect(mapRHIFloat32PositionLayout(position, 0)).toBe(first);
        expect(mapRHIFloat32PositionLayout(position, 1)).not.toBe(first);

        position.stride = 12;
        const replacement = mapRHIFloat32PositionLayout(position, 0);
        expect(replacement).not.toBe(first);
        expect(mapRHIFloat32PositionLayout(position, 0)).toBe(replacement);
    });

    it('rejects non-Float32, normalized, matrix, and malformed position streams', () => {
        expect(() =>
            mapRHIFloat32PositionLayout(new GeometryData(new Uint16Array([0, 1, 2]), 3))
        ).toThrow(/requires Float32/);

        const mismatchedType = new GeometryData(new Float32Array([0, 1, 2]), 3);
        mismatchedType.type = UNSIGNED_INT;
        expect(() => mapRHIFloat32PositionLayout(mismatchedType)).toThrow(/requires Float32/);

        const normalized = new GeometryData(new Float32Array([0, 1, 2]), 3, {
            normalized: true
        });
        expect(() => mapRHIFloat32PositionLayout(normalized)).toThrow(/must not be normalized/);

        expect(() =>
            mapRHIFloat32PositionLayout(new GeometryData(new Float32Array(18), 9))
        ).toThrow(/scalar through vec4/);
        expect(() =>
            mapRHIFloat32PositionLayout(new GeometryData(new Float32Array(6), 3, { stride: 16 }))
        ).toThrow(/whole number of complete vertices/);
        expect(() => mapRHIFloat32PositionLayout(new GeometryData(new Float32Array(0), 3))).toThrow(
            /whole number of complete vertices/
        );
    });

    it('maps only contiguous Uint16 and Uint32 indices', () => {
        expect(mapRHIIndexFormat(new GeometryData(new Uint16Array([0, 1, 2]), 1))).toBe('uint16');
        expect(mapRHIIndexFormat(new GeometryData(new Uint32Array([0, 1, 2]), 1))).toBe('uint32');
    });

    it('rejects Uint8, non-integer, empty, interleaved, and mismatched index data', () => {
        expect(() => mapRHIIndexFormat(new GeometryData(new Uint8Array([0, 1, 2]), 1))).toThrow(
            /must be widened/
        );
        expect(() => mapRHIIndexFormat(new GeometryData(new Float32Array([0, 1, 2]), 1))).toThrow(
            /Uint16Array or Uint32Array/
        );
        expect(() => mapRHIIndexFormat(new GeometryData(new Uint16Array(0), 1))).toThrow(
            /at least one index/
        );
        expect(() =>
            mapRHIIndexFormat(new GeometryData(new Uint16Array([0, 1, 2, 3]), 1, { stride: 2 }))
        ).toThrow(/contiguous/);

        const mismatchedType = new GeometryData(new Uint16Array([0, 1, 2]), 1);
        mismatchedType.type = UNSIGNED_INT;
        expect(() => mapRHIIndexFormat(mismatchedType)).toThrow(/UNSIGNED_SHORT/);
    });

    it('maps every portable primitive and requires loop/fan normalization', () => {
        expect(mapRHIPrimitiveTopology(POINTS)).toBe('point-list');
        expect(mapRHIPrimitiveTopology(LINES)).toBe('line-list');
        expect(mapRHIPrimitiveTopology(LINE_STRIP)).toBe('line-strip');
        expect(mapRHIPrimitiveTopology(TRIANGLES)).toBe('triangle-list');
        expect(mapRHIPrimitiveTopology(TRIANGLE_STRIP)).toBe('triangle-strip');
        expect(() => mapRHIPrimitiveTopology(LINE_LOOP)).toThrow(/must be normalized/);
        expect(() => mapRHIPrimitiveTopology(TRIANGLE_FAN)).toThrow(/must be normalized/);
        expect(() => mapRHIPrimitiveTopology(0x7fffffff)).toThrow(/Unsupported primitive/);
    });
});

describe('RHIDescriptorMapping material state', () => {
    it('maps front face and culling without backend-native types', () => {
        expect(mapRHIFrontFace(CCW)).toBe('ccw');
        expect(mapRHIFrontFace(CW)).toBe('cw');
        expect(() => mapRHIFrontFace(-1)).toThrow(/Unsupported front-face/);

        expect(mapRHICullMode(true, FRONT)).toBe('front');
        expect(mapRHICullMode(true, BACK)).toBe('back');
        expect(mapRHICullMode(false, BACK)).toBe('none');
        expect(mapRHICullMode(true, FRONT_AND_BACK)).toBe('none');
        expect(() => mapRHICullMode(true, -1)).toThrow(/Unsupported cull-face/);
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
    ] as const)('maps depth compare %i', (value, expected) => {
        expect(mapRHICompareFunction(value)).toBe(expected);
    });

    it('maps depth, stencil, and validated per-draw dynamic state', () => {
        expect(mapRHIDepthStencilState(new Material(), 'depth24plus')).toEqual({
            format: 'depth24plus',
            depthCompare: 'less-equal',
            depthWriteEnabled: true
        });
        expect(mapRHIDepthStencilState(new Material(), 'depth24plus', 'reversed')).toEqual({
            format: 'depth24plus',
            depthCompare: 'greater-equal',
            depthWriteEnabled: true
        });
        expect(
            mapRHIDepthStencilState(
                new Material({ depthTest: false, depthMask: true }),
                'depth24plus'
            )
        ).toEqual({
            format: 'depth24plus',
            depthCompare: 'always',
            depthWriteEnabled: false
        });
        expect(mapRHIDepthStencilState(new Material({ depthTest: false }), null)).toBeUndefined();
        expect(() => mapRHIDepthStencilState(new Material(), null)).toThrow(
            /depth\/stencil attachment/
        );
        expect(
            mapRHIMeshDrawDynamicState(
                new Material({ depthRange: [0.1, 0.9], stencilTest: true, stencilFuncRef: 17 })
            )
        ).toEqual({ minDepth: 0.1, maxDepth: 0.9, stencilReference: 17, usesStencil: true });
        expect(() => mapRHIMeshDrawDynamicState(new Material({ depthRange: [0.9, 0.1] }))).toThrow(
            /depthRange/
        );

        const stencil = new Material({
            stencilTest: true,
            stencilFunc: EQUAL,
            stencilFuncMask: 0x0f,
            stencilMask: 0xf0,
            stencilOpFail: KEEP,
            stencilOpZFail: INCR_WRAP,
            stencilOpZPass: REPLACE
        });
        expect(mapRHIDepthStencilState(stencil, 'depth24plus-stencil8')).toEqual({
            format: 'depth24plus-stencil8',
            depthCompare: 'less-equal',
            depthWriteEnabled: true,
            stencilFront: {
                compare: 'equal',
                failOp: 'keep',
                depthFailOp: 'increment-wrap',
                passOp: 'replace'
            },
            stencilBack: {
                compare: 'equal',
                failOp: 'keep',
                depthFailOp: 'increment-wrap',
                passOp: 'replace'
            },
            stencilReadMask: 0x0f,
            stencilWriteMask: 0xf0
        });
        expect(() => mapRHIDepthStencilState(stencil, 'depth24plus')).toThrow(/stencil format/);
        expect(mapRHIStencilOperation(REPLACE)).toBe('replace');
        expect(() => mapRHIStencilOperation(-1)).toThrow(/Unsupported stencil operation/);
        expect(mapRHIDepthStencilState(new Material({ depthTest: false }), 'stencil8')).toEqual({
            format: 'stencil8',
            depthCompare: 'always',
            depthWriteEnabled: false,
            stencilReadMask: 0xffffffff,
            stencilWriteMask: 0
        });
        expect(() => mapRHICompareFunction(-1)).toThrow(/Unsupported depth comparison/);
    });

    it('maps disabled, canonical alpha, and custom portable blend modes', () => {
        expect(mapRHIDefaultBlendState(new Material())).toBeUndefined();
        expect(mapRHIDefaultBlendState(new Material({ transparent: true }))).toEqual({
            color: {
                operation: 'add',
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha'
            },
            alpha: {
                operation: 'add',
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha'
            }
        });
        expect(
            mapRHIDefaultBlendState(new Material({ premultiplyAlpha: false, transparent: true }))
        ).toEqual({
            color: {
                operation: 'add',
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha'
            },
            alpha: {
                operation: 'add',
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha'
            }
        });

        const customBlend = new Material({ blend: true });
        customBlend.blendSrc = DST_ALPHA;
        customBlend.blendDst = ONE_MINUS_DST_ALPHA;
        customBlend.blendEquation = FUNC_SUBTRACT;
        customBlend.blendSrcAlpha = ONE;
        customBlend.blendDstAlpha = ZERO;
        customBlend.blendEquationAlpha = FUNC_REVERSE_SUBTRACT;
        expect(mapRHIDefaultBlendState(customBlend)).toEqual({
            color: {
                operation: 'subtract',
                srcFactor: 'dst-alpha',
                dstFactor: 'one-minus-dst-alpha'
            },
            alpha: {
                operation: 'reverse-subtract',
                srcFactor: 'one',
                dstFactor: 'zero'
            }
        });
        expect(mapRHIBlendFactor(DST_ALPHA)).toBe('dst-alpha');
        expect(mapRHIBlendOperation(FUNC_SUBTRACT)).toBe('subtract');
        expect(() => mapRHIBlendFactor(-1)).toThrow(/Unsupported blend factor/);
        expect(() => mapRHIBlendOperation(-1)).toThrow(/Unsupported blend equation/);
    });

    it('validates the first-slice multisample state', () => {
        expect(mapRHIMultisampleState(1, false)).toEqual({
            count: 1,
            mask: 0xffffffff,
            alphaToCoverageEnabled: false
        });
        expect(mapRHIMultisampleState(4, false)).toEqual({
            count: 4,
            mask: 0xffffffff,
            alphaToCoverageEnabled: false
        });
        expect(() => mapRHIMultisampleState(2, false)).toThrow(/sample counts 1 and 4/);
        expect(mapRHIMultisampleState(4, true)).toEqual({
            count: 4,
            mask: 0xffffffff,
            alphaToCoverageEnabled: true
        });
        expect(() => mapRHIMultisampleState(1, true)).toThrow(/requires multisampling/);
    });
});

describe('RHIDescriptorMapping target and composed state', () => {
    it('validates attachment zero across color/MRT targets and format sample support', () => {
        const capabilities = targetCapabilities();
        expect(
            validateRHIMeshDrawTarget(
                {
                    colorFormats: ['rgba8unorm'],
                    depthStencilFormat: 'depth24plus',
                    sampleCount: 4
                },
                capabilities
            )
        ).toBe('rgba8unorm');
        expect(validateRHIMeshDrawTarget({ colorFormats: ['bgra8unorm'], sampleCount: 1 })).toBe(
            'bgra8unorm'
        );

        expect(() => validateRHIMeshDrawTarget({ colorFormats: [], sampleCount: 1 })).toThrow(
            /at least one color target/
        );
        expect(() => validateRHIMeshDrawTarget({ colorFormats: [null], sampleCount: 1 })).toThrow(
            /at least one bound color target/
        );
        expect(
            validateRHIMeshDrawTarget({
                colorFormats: ['rgba8unorm', 'bgra8unorm'],
                sampleCount: 1
            })
        ).toBe('rgba8unorm');
        expect(() =>
            validateRHIMeshDrawTarget({
                colorFormats: [null, 'bgra8unorm'],
                sampleCount: 1
            })
        ).toThrow(/target zero is not bound/);
        expect(() =>
            validateRHIMeshDrawTarget({ colorFormats: ['depth24plus'], sampleCount: 1 })
        ).toThrow(/depth\/stencil format/);
        expect(() =>
            validateRHIMeshDrawTarget({
                colorFormats: ['rgba8unorm'],
                depthStencilFormat: 'stencil8',
                sampleCount: 1
            })
        ).toThrow(/has no depth aspect/);
        expect(() =>
            validateRHIMeshDrawTarget({ colorFormats: ['rgba8unorm'], sampleCount: 2 })
        ).toThrow(/sample counts 1 and 4/);
        expect(() =>
            validateRHIMeshDrawTarget(
                { colorFormats: ['rgba8unorm'], sampleCount: 4 },
                targetCapabilities({ colorSampleCounts: [1] })
            )
        ).toThrow(/does not support sample count 4/);
        expect(() =>
            validateRHIMeshDrawTarget(
                { colorFormats: ['rgba8unorm'], sampleCount: 1 },
                targetCapabilities({ colorRenderable: false })
            )
        ).toThrow(/is not renderable/);
    });

    it('creates one immutable backend-neutral opaque pipeline-state descriptor', () => {
        const state = createRHIMeshDrawPipelineState(new Material(), TRIANGLES, {
            colorFormats: ['rgba8unorm'],
            depthStencilFormat: 'depth24plus',
            sampleCount: 1
        });

        expect(state).toEqual({
            primitive: {
                topology: 'triangle-list',
                frontFace: 'ccw',
                cullMode: 'back'
            },
            colorTargets: [{ format: 'rgba8unorm', writeMask: 0xf }],
            depthStencil: {
                format: 'depth24plus',
                depthCompare: 'less-equal',
                depthWriteEnabled: true
            },
            multisample: {
                count: 1,
                mask: 0xffffffff,
                alphaToCoverageEnabled: false
            }
        });
        expect(Object.isFrozen(state)).toBe(true);
        expect(Object.isFrozen(state.primitive)).toBe(true);
        expect(Object.isFrozen(state.colorTargets)).toBe(true);
        expect(Object.isFrozen(state.depthStencil)).toBe(true);
        expect(Object.isFrozen(state.multisample)).toBe(true);
    });

    it('maps continuous and sparse ShaderMaterial MRT targets with shared render state', () => {
        const target = {
            colorFormats: ['rgba8unorm', 'rgba16float'] as const,
            depthStencilFormat: 'depth24plus' as const,
            sampleCount: 4
        };
        expect(validateRHIMeshDrawColorTargets(target, targetCapabilities())).toEqual([
            'rgba8unorm',
            'rgba16float'
        ]);
        const state = createRHIMeshDrawPipelineState(
            new Material(),
            TRIANGLES,
            target,
            targetCapabilities()
        );
        expect(state.colorTargets).toEqual([
            { format: 'rgba8unorm', writeMask: 0xf },
            { format: 'rgba16float', writeMask: 0xf }
        ]);
        expect(state.multisample.count).toBe(4);
        expect(
            validateRHIMeshDrawColorTargets(
                {
                    colorFormats: ['rgba8unorm', null, 'bgra8unorm'],
                    depthStencilFormat: 'depth24plus',
                    sampleCount: 1
                },
                targetCapabilities()
            )
        ).toEqual(['rgba8unorm', null, 'bgra8unorm']);
        expect(
            createRHIMeshDrawPipelineState(
                new Material(),
                TRIANGLES,
                {
                    colorFormats: ['rgba8unorm', null, 'bgra8unorm'],
                    depthStencilFormat: 'depth24plus',
                    sampleCount: 1
                },
                targetCapabilities()
            ).colorTargets
        ).toEqual([
            { format: 'rgba8unorm', writeMask: 0xf },
            null,
            { format: 'bgra8unorm', writeMask: 0xf }
        ]);
    });

    it('disables writes for bound MRT attachments without a reflected fragment output', () => {
        const state = createRHIMeshDrawPipelineState(
            new Material(),
            TRIANGLES,
            {
                colorFormats: ['rgba8unorm', 'rgba16float'],
                depthStencilFormat: 'depth24plus',
                sampleCount: 1
            },
            targetCapabilities(),
            'color',
            undefined,
            [{ location: 0 }]
        );

        expect(state.colorTargets).toEqual([
            { format: 'rgba8unorm', writeMask: 0xf },
            { format: 'rgba16float', writeMask: 0 }
        ]);
        expect(Object.isFrozen(state.colorTargets[1])).toBe(true);
    });

    it('validates and creates a forced-write depth-only shadow pipeline state', () => {
        const target = {
            colorFormats: [] as const,
            depthStencilFormat: 'depth24plus' as const,
            sampleCount: 1
        };
        expect(validateRHIMeshDepthOnlyTarget(target, targetCapabilities())).toBe('depth24plus');
        const state = createRHIMeshDrawPipelineState(
            new Material({ depthTest: false, depthMask: false, transparent: true }),
            TRIANGLES,
            target,
            targetCapabilities(),
            'depth-only'
        );

        expect(state).toMatchObject({
            colorTargets: [],
            depthStencil: {
                format: 'depth24plus',
                depthCompare: 'less-equal',
                depthWriteEnabled: true
            },
            multisample: { count: 1 }
        });
        expect(() =>
            validateRHIMeshDepthOnlyTarget(
                { colorFormats: ['rgba8unorm'], depthStencilFormat: 'depth24plus', sampleCount: 1 },
                targetCapabilities()
            )
        ).toThrow(/must not declare color targets/);
        expect(() => validateRHIMeshDepthOnlyTarget({ colorFormats: [], sampleCount: 1 })).toThrow(
            /requires a depth target/
        );
        expect(() =>
            validateRHIMeshDepthOnlyTarget({
                colorFormats: [],
                depthStencilFormat: 'stencil8',
                sampleCount: 1
            })
        ).toThrow(/has no depth aspect/);
    });

    it('creates default transparent state and rejects excluded material features', () => {
        const transparent = createRHIMeshDrawPipelineState(
            new Material({ transparent: true }),
            TRIANGLES,
            {
                colorFormats: ['rgba8unorm'],
                depthStencilFormat: 'depth24plus',
                sampleCount: 1
            }
        );
        expect(transparent.colorTargets[0]?.blend).toEqual({
            color: {
                operation: 'add',
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha'
            },
            alpha: {
                operation: 'add',
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha'
            }
        });
        expect(transparent.depthStencil?.depthWriteEnabled).toBe(false);

        const target = {
            colorFormats: ['rgba8unorm'] as const,
            depthStencilFormat: 'depth24plus' as const,
            sampleCount: 1
        };
        expect(
            createRHIMeshDrawPipelineState(new Material({ wireframe: true }), LINES, target)
                .primitive.topology
        ).toBe('line-list');
        expect(() =>
            createRHIMeshDrawPipelineState(new Material({ wireframe: true }), TRIANGLES, target)
        ).toThrow(/converted to a line list/);
        expect(
            createRHIMeshDrawPipelineState(
                new Material(),
                TRIANGLE_STRIP,
                target,
                undefined,
                'color',
                'uint16'
            ).primitive
        ).toMatchObject({ topology: 'triangle-strip', stripIndexFormat: 'uint16' });
        expect(() =>
            createRHIMeshDrawPipelineState(
                new Material(),
                TRIANGLES,
                target,
                undefined,
                'color',
                'uint16'
            )
        ).toThrow(/stripIndexFormat/);
        expect(() =>
            createRHIMeshDrawPipelineState(new Material({ stencilTest: true }), TRIANGLES, target)
        ).toThrow(/stencil format/);
        expect(
            createRHIMeshDrawPipelineState(
                new Material({ sampleAlphaToCoverage: true }),
                TRIANGLES,
                { ...target, sampleCount: 4 }
            ).multisample.alphaToCoverageEnabled
        ).toBe(true);
        expect(() =>
            createRHIMeshDrawPipelineState(
                new Material({ transparent: true }),
                TRIANGLES,
                target,
                targetCapabilities({ colorBlendable: false })
            )
        ).toThrow(/does not support blending/);
    });
});
