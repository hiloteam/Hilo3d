import {
    ShadowAtlasPlanner,
    type ShadowAtlasPlan,
    type ShadowAtlasRequests
} from '../../../src/render/renderer/ShadowAtlasPlanner';
import type { RHICapabilities } from '../../../src/render/rhi/core';
import { describe, expect, it } from 'vitest';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from '../rhi/v2/FakeRHIBackend';

interface TestOwner {
    readonly name: string;
}

function request(owner: TestOwner, width = 64, height = width) {
    return { owner, width, height };
}

function snapshotPlan(plan: Readonly<ShadowAtlasPlan<TestOwner>>) {
    return {
        sliceCount: plan.sliceCount,
        width: plan.width,
        height: plan.height,
        tileWidth: plan.tileWidth,
        tileHeight: plan.tileHeight,
        columns: plan.columns,
        rows: plan.rows,
        capacity: plan.capacity,
        format: plan.format,
        slices: plan.slices.map(slice => ({
            owner: slice.owner.name,
            kind: slice.kind,
            face: slice.face,
            sliceIndex: slice.sliceIndex,
            physicalIndex: slice.physicalIndex,
            viewport: { ...slice.viewport },
            uvRect: { ...slice.uvRect }
        }))
    };
}

function withMaximumDimension(
    capabilities: RHICapabilities,
    maxTextureDimension2D: number
): RHICapabilities {
    return {
        features: capabilities.features,
        limits: Object.freeze({ ...capabilities.limits, maxTextureDimension2D }),
        getTextureFormatCapabilities(format) {
            return capabilities.getTextureFormatCapabilities(format);
        }
    };
}

function withoutRenderableDepth(capabilities: RHICapabilities): RHICapabilities {
    return {
        features: capabilities.features,
        limits: capabilities.limits,
        getTextureFormatCapabilities(format) {
            const supported = capabilities.getTextureFormatCapabilities(format);
            if (format !== 'depth24plus') return supported;
            return Object.freeze({
                ...supported,
                renderable: false,
                sampleCounts: Object.freeze([])
            });
        }
    };
}

describe('ShadowAtlasPlanner', () => {
    it('deterministically expands directional, spot, and point requests into eight slices', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const directional = { name: 'directional' };
        const spot = { name: 'spot' };
        const point = { name: 'point' };
        const planner = new ShadowAtlasPlanner<TestOwner>();
        const plan = planner.build(
            {
                directional: [request(directional, 64, 32)],
                spot: [request(spot, 128, 64)],
                point: [request(point, 32, 32)]
            },
            device.capabilities
        );

        expect(plan).toMatchObject({
            sliceCount: 8,
            width: 384,
            height: 192,
            tileWidth: 128,
            tileHeight: 64,
            columns: 3,
            rows: 3,
            capacity: 9,
            format: 'depth24plus'
        });
        expect(plan.slices.map(slice => slice.kind)).toEqual([
            'directional',
            'spot',
            'point',
            'point',
            'point',
            'point',
            'point',
            'point'
        ]);
        expect(plan.slices.map(slice => slice.face)).toEqual([null, null, 0, 1, 2, 3, 4, 5]);
        expect(plan.slices.map(slice => slice.sliceIndex)).toEqual([0, 8, 16, 17, 18, 19, 20, 21]);
        expect(plan.slices.map(slice => slice.physicalIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(plan.slices.map(slice => slice.viewport)).toEqual([
            { x: 0, y: 0, width: 128, height: 64, minDepth: 0, maxDepth: 1 },
            { x: 128, y: 0, width: 128, height: 64, minDepth: 0, maxDepth: 1 },
            { x: 256, y: 0, width: 128, height: 64, minDepth: 0, maxDepth: 1 },
            { x: 0, y: 64, width: 128, height: 64, minDepth: 0, maxDepth: 1 },
            { x: 128, y: 64, width: 128, height: 64, minDepth: 0, maxDepth: 1 },
            { x: 256, y: 64, width: 128, height: 64, minDepth: 0, maxDepth: 1 },
            { x: 0, y: 128, width: 128, height: 64, minDepth: 0, maxDepth: 1 },
            { x: 128, y: 128, width: 128, height: 64, minDepth: 0, maxDepth: 1 }
        ]);
        expect(plan.slices[0]?.uvRect).toEqual({ x: 0, y: 0, width: 1 / 3, height: 1 / 3 });
        expect(plan.slices[7]?.uvRect).toEqual({
            x: 1 / 3,
            y: 2 / 3,
            width: 1 / 3,
            height: 1 / 3
        });
        planner.destroy();
        backend.destroy();
    });

    it('reuses plan and high-water slice identities while pruning removed owners', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const directional = { name: 'directional' };
        const spot = { name: 'spot' };
        const point = { name: 'point' };
        const replacementPoint = { name: 'replacement-point' };
        const planner = new ShadowAtlasPlanner<TestOwner>();
        const requests: ShadowAtlasRequests<TestOwner> = {
            directional: [request(directional)],
            spot: [request(spot)],
            point: [request(point)]
        };

        const first = planner.build(requests, device.capabilities);
        const sliceArray = first.slices;
        const sliceIdentities = [...first.slices];
        const viewportIdentities = first.slices.map(slice => slice.viewport);
        const second = planner.build(requests, device.capabilities);
        expect(second).toBe(first);
        expect(second.slices).toBe(sliceArray);
        for (let index = 0; index < second.slices.length; index += 1) {
            expect(second.slices[index]).toBe(sliceIdentities[index]);
            expect(second.slices[index]?.viewport).toBe(viewportIdentities[index]);
        }

        const reduced = planner.build(
            { directional: [], spot: [request(spot)], point: [] },
            device.capabilities
        );
        expect(reduced).toBe(first);
        expect(reduced.slices).toBe(sliceArray);
        expect(reduced.slices).toHaveLength(1);
        expect(reduced.slices[0]).toBe(sliceIdentities[0]);
        expect(reduced.slices[0]?.owner).toBe(spot);
        expect(planner.hasOwner(directional)).toBe(false);
        expect(planner.hasOwner(point)).toBe(false);
        expect(planner.hasOwner(spot)).toBe(true);
        expect(planner.diagnostics()).toEqual({
            activeOwnerCount: 1,
            activeSliceCount: 1,
            storageCapacity: 8
        });

        planner.build(
            { directional: [], spot: [request(spot)], point: [request(replacementPoint)] },
            device.capabilities
        );
        expect(planner.hasOwner(point)).toBe(false);
        expect(planner.hasOwner(replacementPoint)).toBe(true);
        expect(planner.diagnostics().storageCapacity).toBe(8);
        expect(
            first.slices.every(slice => slice.owner !== directional && slice.owner !== point)
        ).toBe(true);
        planner.destroy();
        expect(() => planner.build(requests, device.capabilities)).toThrow('destroyed');
        backend.destroy();
    });

    it('produces identical capability-dependent fields on WebGL2 and WebGPU', () => {
        const webgl = new FakeWebGLRHIBackend();
        const webgpu = new FakeWebGPURHIBackend();
        const webglDevice = webgl.createDevice();
        const webgpuDevice = webgpu.createDevice();
        const directional = { name: 'directional' };
        const spot = { name: 'spot' };
        const point = { name: 'point' };
        const requests: ShadowAtlasRequests<TestOwner> = {
            directional: [request(directional, 96, 64)],
            spot: [request(spot, 48, 32)],
            point: [request(point, 64, 64)]
        };
        const webglPlan = new ShadowAtlasPlanner<TestOwner>().build(
            requests,
            webglDevice.capabilities
        );
        const webgpuPlan = new ShadowAtlasPlanner<TestOwner>().build(
            requests,
            webgpuDevice.capabilities
        );

        expect(snapshotPlan(webgpuPlan)).toEqual(snapshotPlan(webglPlan));
        webgl.destroy();
        webgpu.destroy();
    });

    it('enforces maxSlices, dimensions, format capabilities, owner uniqueness, and ABI limits', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const directional = { name: 'directional' };
        const secondDirectional = { name: 'directional-2' };
        const spot = { name: 'spot' };
        const point = { name: 'point' };
        const capped = new ShadowAtlasPlanner<TestOwner>({ maxSlices: 8 });
        const validRequests: ShadowAtlasRequests<TestOwner> = {
            directional: [request(directional, 16)],
            spot: [request(spot, 16)],
            point: [request(point, 16)]
        };
        const valid = capped.build(validRequests, device.capabilities);
        expect(valid.sliceCount).toBe(8);

        expect(() =>
            capped.build(
                {
                    directional: [request(directional), request(secondDirectional)],
                    spot: [request(spot)],
                    point: [request(point)]
                },
                device.capabilities
            )
        ).toThrow('exceeding maxSlices 8');
        expect(snapshotPlan(valid)).toMatchObject({ sliceCount: 8, width: 48, height: 48 });

        expect(() =>
            new ShadowAtlasPlanner<TestOwner>().build(
                {
                    directional: [request(directional, 33), request(secondDirectional, 33)],
                    spot: [],
                    point: []
                },
                withMaximumDimension(device.capabilities, 64)
            )
        ).toThrow('exceeds maxTextureDimension2D 64');
        expect(() =>
            new ShadowAtlasPlanner<TestOwner>({ format: 'rgba8unorm' }).build(
                validRequests,
                device.capabilities
            )
        ).toThrow('must be a depth format');
        expect(() =>
            new ShadowAtlasPlanner<TestOwner>().build(
                validRequests,
                withoutRenderableDepth(device.capabilities)
            )
        ).toThrow('not renderable');
        expect(() =>
            new ShadowAtlasPlanner<TestOwner>().build(
                {
                    directional: [request(directional, 0, 16)],
                    spot: [],
                    point: []
                },
                device.capabilities
            )
        ).toThrow('must be a positive safe integer');
        expect(() =>
            new ShadowAtlasPlanner<TestOwner>().build(
                {
                    directional: [request(directional)],
                    spot: [request(directional)],
                    point: []
                },
                device.capabilities
            )
        ).toThrow('only once');
        expect(() =>
            new ShadowAtlasPlanner<TestOwner>().build(
                {
                    directional: Array.from({ length: 9 }, (_, index) =>
                        request({ name: `directional-${String(index)}` })
                    ),
                    spot: [],
                    point: []
                },
                device.capabilities
            )
        ).toThrow('Directional shadow count 9');
        expect(() => new ShadowAtlasPlanner({ maxSlices: 113 })).toThrow('ABI capacity');
        backend.destroy();
    });

    it('returns a reusable empty plan and removes every previous owner', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const owner = { name: 'directional' };
        const planner = new ShadowAtlasPlanner<TestOwner>();
        const populated = planner.build(
            { directional: [request(owner)], spot: [], point: [] },
            device.capabilities
        );
        const empty = planner.build({ directional: [], spot: [], point: [] }, device.capabilities);

        expect(empty).toBe(populated);
        expect(empty).toMatchObject({
            sliceCount: 0,
            width: 0,
            height: 0,
            tileWidth: 0,
            tileHeight: 0,
            columns: 0,
            rows: 0,
            capacity: 0
        });
        expect(empty.slices).toHaveLength(0);
        expect(planner.hasOwner(owner)).toBe(false);
        expect(planner.diagnostics()).toEqual({
            activeOwnerCount: 0,
            activeSliceCount: 0,
            storageCapacity: 1
        });
        backend.destroy();
    });
});
