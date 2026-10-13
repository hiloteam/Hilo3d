import { describe, expect, it } from 'vitest';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import BasicMaterial from '../../../src/material/BasicMaterial';
import {
    LINES,
    LINE_STRIP,
    LINE_LOOP,
    POINTS,
    TRIANGLES,
    TRIANGLE_STRIP,
    TRIANGLE_FAN
} from '../../../src/constants/webgl';
import {
    WEIGHTED_TRANSPARENCY_LAYOUT,
    weightedFragmentBound,
    writeWeightedNormalization
} from '../../../src/render/pipeline/internal/weightedTransparencyNumerics';
import { WEIGHTED_BLENDED_TRANSPARENCY_REQUIREMENTS } from '../../../src/render/pipeline/WeightedBlendedTransparency';
import { getUniformBlockBinding } from '../../../src/render/ubo/UniformBlockBindings';
import { getWebGPUUniformBlockBinding } from '../../../src/render/shader/WebGPUBindingLayout';
import {
    createRenderPipelineCapabilities,
    validateRenderPipelineRequirements,
    validateRenderPipelineCapabilitySuperset
} from '../../../src/render/pipeline/RenderPipelineCapabilities';
import { FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

describe('weighted transparency numeric contracts', () => {
    it('owns one fixed 16-byte dyadic normalization ABI with a 32768 accumulation headroom proof', () => {
        expect(WEIGHTED_TRANSPARENCY_LAYOUT.byteLength).toBe(16);
        expect(WEIGHTED_TRANSPARENCY_LAYOUT.fields.u_weightedTransparency.offset).toBe(0);
        expect(getUniformBlockBinding('WeightedTransparencyBlock')).toBe(12);
        expect(getWebGPUUniformBlockBinding('WeightedTransparencyBlock')).toEqual({
            group: 0,
            binding: 4
        });
        const values = new Float32Array(4);
        for (const count of [1, 2, 3, 140, 4096, 16385, 1_048_576]) {
            writeWeightedNormalization(count, values);
            const limit = values[0] ?? 0;
            const middleScale = values[1] ?? 0;
            const highScale = values[2] ?? 0;
            expect(Number.isInteger(Math.log2(limit))).toBe(true);
            expect(Number.isInteger(Math.log2(middleScale))).toBe(true);
            expect(Number.isInteger(Math.log2(highScale))).toBe(true);
            expect(values[3]).toBe(128);
            // A rounded FP16 addition grows by at most twice its addend. Every bin addend is <= S.
            expect(count * limit * 2).toBeLessThanOrEqual(32768);
            for (const raw of [-65504 * 128, -0.00001, 0, 0.00001, 128, 1000 * 128, 65504 * 128]) {
                const low = Math.max(-limit, Math.min(limit, raw));
                const middle = Math.max(
                    -limit / middleScale,
                    Math.min(limit / middleScale, raw - low)
                );
                const high = (raw - low - middle) * highScale;
                expect(Math.abs(middle * middleScale)).toBeLessThanOrEqual(limit);
                expect(Math.abs(high)).toBeLessThanOrEqual(limit);
                expect(low + middle + high / highScale).toBeCloseTo(raw, 6);
                if (Math.abs(raw) <= limit) expect(low).toBe(raw);
            }
        }
    });

    it.each([
        [POINTS, 6],
        [LINES, 3],
        [LINE_STRIP, 5],
        [LINE_LOOP, 6],
        [TRIANGLES, 2],
        [TRIANGLE_STRIP, 4],
        [TRIANGLE_FAN, 4]
    ] as const)(
        'bounds primitive mode %s, indexed counts and direct instances',
        (mode, primitives) => {
            const geometry = new Geometry({ mode });
            geometry.vertices = new GeometryData(new Float32Array(18), 3);
            geometry.indices = new GeometryData(new Uint16Array([0, 1, 2, 3, 4, 5]), 1);
            const mesh = new Mesh({
                geometry,
                material: new BasicMaterial({
                    lightType: 'NONE',
                    compositing: { mode: 'weighted-blended' }
                }),
                instanceCount: 3,
                frustumTest: false
            });
            const scene = new Node().addChild(mesh);
            const camera = new OrthographicCamera();
            expect(weightedFragmentBound({ scene, camera }, 100)).toBe(primitives * 3);
            expect(() => weightedFragmentBound({ scene, camera }, primitives * 3 - 1)).toThrow(
                /maxFragmentCount/u
            );
        }
    );

    it('rejects missing MRT or aggregate attachment-byte capacity before runtime creation and recovery', () => {
        const backend = new FakeWebGPURHIBackend();
        const source = backend.createDevice().capabilities;
        const baseline = createRenderPipelineCapabilities(source);
        for (const [name, value] of [
            ['maxColorAttachments', 2],
            ['maxColorAttachmentBytesPerSample', 16]
        ] as const) {
            const device = {
                ...source,
                limits: { ...source.limits, [name]: value },
                getTextureFormatCapabilities: (
                    format: Parameters<typeof source.getTextureFormatCapabilities>[0]
                ) => source.getTextureFormatCapabilities(format)
            };
            const capabilities = createRenderPipelineCapabilities(device);
            expect(() => {
                validateRenderPipelineRequirements(
                    WEIGHTED_BLENDED_TRANSPARENCY_REQUIREMENTS,
                    capabilities,
                    device
                );
            }).toThrow(name);
            expect(() => {
                validateRenderPipelineCapabilitySuperset(baseline, capabilities);
            }).toThrow(/reduces render pipeline/u);
        }
        backend.destroy();
    });
});
