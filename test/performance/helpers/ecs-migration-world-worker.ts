import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import World from '../../../src/ecs/World';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import { MeshRenderer } from '../../../src/scene/components/Rendering';
import { getTransformStore, LocalTransform } from '../../../src/scene/components/Transform';
import {
    createRenderExtractionSystem,
    RENDER_WORLD
} from '../../../src/scene/systems/RenderExtractionSystem';
import { createTransformSystem } from '../../../src/scene/systems/TransformSystem';

interface Manifest {
    readonly staticEntityCount: number;
    readonly dynamicEntityCount: number;
    readonly warmupFrames: number;
    readonly sampleFrames: number;
}

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, 'benchmarks/ecs/manifest.json'), 'utf8')
) as Manifest;
const totalCount = manifest.staticEntityCount + manifest.dynamicEntityCount;
const world = await World.create({
    initialCapacity: totalCount,
    systems: [createTransformSystem(), createRenderExtractionSystem()]
});
const geometry = new BoxGeometry();
const material = new BasicMaterial();
const dynamicIndices = new Uint32Array(manifest.dynamicEntityCount);
for (let index = 0; index < totalCount; index++) {
    const entity = world.createEntity();
    const entityIndex = world.entityIndex(entity);
    if (index >= manifest.staticEntityCount) {
        dynamicIndices[index - manifest.staticEntityCount] = entityIndex;
    }
    world.add(entity, LocalTransform, {
        position: [index % 1000, 0, Math.floor(index / 1000)]
    });
    world.add(entity, MeshRenderer, { geometry, material, frustumTest: false });
}
world.update(0);
const transforms = getTransformStore(world);
const renderWorld = world.getResource(RENDER_WORLD);
let frame = 0;
function update(): void {
    const offset = frame++ % 2;
    for (let index = 0; index < dynamicIndices.length; index++) {
        transforms.setPosition(
            dynamicIndices[index] ?? 0,
            index % 1000,
            offset,
            Math.floor(index / 1000)
        );
    }
    world.update(1000 / 60);
}
for (let index = 0; index < manifest.warmupFrames; index++) update();
const samples = new Array<number>(manifest.sampleFrames);
for (let index = 0; index < samples.length; index++) {
    const started = performance.now();
    update();
    samples[index] = performance.now() - started;
}
samples.sort((left, right) => left - right);
const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
const diagnostics = renderWorld.getDiagnostics();
interface AllocationNode {
    readonly callFrame: { readonly functionName: string; readonly url: string };
    readonly selfSize: number;
    readonly children?: readonly AllocationNode[];
}
const inspector = new Session();
inspector.connect();
const post = (method: string, parameters?: object): Promise<Record<string, unknown>> =>
    new Promise((resolvePost, rejectPost) => {
        inspector.post(method, parameters, (error, result) => {
            if (error) rejectPost(error);
            else resolvePost((result ?? {}) as Record<string, unknown>);
        });
    });
const coreAllocationBytes = (profile: { readonly head: AllocationNode }): number => {
    let bytes = 0;
    const pending: { readonly node: AllocationNode; readonly core: boolean }[] = [
        { node: profile.head, core: false }
    ];
    while (pending.length > 0) {
        const current = pending.pop();
        if (!current) break;
        const callFrame = current.node.callFrame;
        const core =
            current.core ||
            (callFrame.functionName === 'updateWorldMatrices' &&
                callFrame.url.includes('/src/scene/components/Transform.ts')) ||
            (callFrame.functionName === 'execute' &&
                callFrame.url.includes('/src/scene/systems/RenderExtractionSystem.ts'));
        if (core) bytes += current.node.selfSize;
        for (const child of current.node.children ?? []) pending.push({ node: child, core });
    }
    return bytes;
};
const profileCoreFrame = async (run: () => void): Promise<number> => {
    await post('HeapProfiler.startSampling', {
        samplingInterval: 1,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true
    });
    run();
    const response = await post('HeapProfiler.stopSampling');
    return coreAllocationBytes(response['profile'] as { readonly head: AllocationNode });
};
await post('HeapProfiler.enable');
const conditionProfiler = async (run: () => void, label: string): Promise<void> => {
    let consecutiveZeroProfiles = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
        const bytes = await profileCoreFrame(run);
        consecutiveZeroProfiles = bytes === 0 ? consecutiveZeroProfiles + 1 : 0;
        if (consecutiveZeroProfiles === 3) return;
    }
    throw new Error(`${label} allocation profile did not reach steady state.`);
};
// Starting the allocation profiler changes V8 tiering state. Reach three consecutive empty static
// and dynamic profiles before measuring so delayed profiler/JIT setup is not mistaken for
// steady-state scene allocation. Recurring allocations can never satisfy this condition.
await conditionProfiler(() => {
    world.update(0);
}, 'Static core');
await conditionProfiler(update, 'Dynamic core');
const staticCoreAllocations: number[] = [];
const dynamicCoreAllocations: number[] = [];
for (let index = 0; index < 3; index++) {
    staticCoreAllocations.push(
        await profileCoreFrame(() => {
            world.update(0);
        })
    );
    dynamicCoreAllocations.push(await profileCoreFrame(update));
}
await post('HeapProfiler.disable');
inspector.disconnect();
process.stdout.write(
    `${JSON.stringify({
        p95,
        renderObjectCount: renderWorld.length,
        transformUpdateCount: diagnostics.transformUpdateCount,
        boundsUpdateCount: diagnostics.boundsUpdateCount,
        maximumStaticCoreAllocationBytes: Math.max(...staticCoreAllocations),
        maximumDynamicCoreAllocationBytes: Math.max(...dynamicCoreAllocations)
    })}\n`
);
world.destroy();
