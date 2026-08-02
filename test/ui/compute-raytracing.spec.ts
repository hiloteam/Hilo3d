import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    installRenderHealthProbe,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';

interface RayTracingEvidence {
    readonly backend: string;
    readonly sampleCount: number;
    readonly coloredPixels: number;
    readonly brightPixels: number;
    readonly distinctColors: number;
    readonly hash: number;
}

async function initialResult(page: Page): Promise<RayTracingEvidence> {
    await page.waitForFunction(() => window.__HILO3D_RAYTRACING_RESULT__ !== undefined);
    const value = await page.evaluate(() => window.__HILO3D_RAYTRACING_RESULT__);
    if (value === undefined) {
        throw new Error('Compute ray-tracing example did not publish initial evidence');
    }
    return value;
}

async function step(page: Page, frames: number): Promise<RayTracingEvidence> {
    return page.evaluate(async frameCount => {
        const api = window.__HILO3D_RAYTRACING_TEST_API__;
        if (api === undefined) throw new Error('Compute ray-tracing test API is unavailable');
        return api.step(frameCount);
    }, frames);
}

async function bindGroupCreationCount(page: Page): Promise<number> {
    const health = await readRenderHealth(page);
    return health.reduce(
        (total, frame) => total + (frame.snapshot.webgpuBindGroupsCreated ?? 0),
        0
    );
}

test('progressively path traces the Hilo3D crystal scene on WebGPU', async ({ page }) => {
    test.setTimeout(120_000);
    await installRenderHealthProbe(page);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto('/examples/compute_raytracing.html?backend=webgpu&test=1', {
        waitUntil: 'load'
    });
    const initial = await initialResult(page);
    const initialBindGroups = await bindGroupCreationCount(page);
    const converged = await step(page, 8);
    const convergedBindGroups = await bindGroupCreationCount(page);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(initial.backend).toBe('webgpu');
    expect(initial.sampleCount).toBe(2);
    expect(initial.coloredPixels).toBeGreaterThan(300_000);
    expect(initial.brightPixels).toBeGreaterThan(1_000);
    expect(initial.distinctColors).toBeGreaterThan(500);
    expect(converged.sampleCount).toBe(8);
    expect(converged.hash).not.toBe(initial.hash);
    expect(initialBindGroups).toBeGreaterThan(0);
    expect(convergedBindGroups).toBe(initialBindGroups);

    const canvas = page.locator('canvas');
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error('Compute ray-tracing canvas is unavailable');
    const centerX = bounds.x + bounds.width * 0.5;
    const centerY = bounds.y + bounds.height * 0.53;
    await page.mouse.move(centerX - 100, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 120, centerY - 35, { steps: 5 });
    await page.mouse.up();
    const orbited = await step(page, 8);
    expect(orbited.hash).not.toBe(converged.hash);

    const health = await readRenderHealth(page);
    expect(
        health.reduce((sum, frame) => sum + (frame.snapshot.webgpuComputePasses ?? 0), 0)
    ).toBeGreaterThanOrEqual(18);
    expect(
        health.reduce((sum, frame) => sum + (frame.snapshot.webgpuDispatchCalls ?? 0), 0)
    ).toBeGreaterThanOrEqual(18);
    expect(
        health.reduce((sum, frame) => sum + frame.snapshot.webgpuDrawCalls, 0)
    ).toBeGreaterThanOrEqual(18);

    await assertStableInstrumentationHealth('webgpu', 'compute ray-tracing WebGPU health', {
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });
});

test('keeps path tracing on the public compute and Render Graph APIs', () => {
    const source = readFileSync(
        fileURLToPath(new URL('../../examples/compute_raytracing.ts', import.meta.url)),
        'utf8'
    );

    expect(source).not.toMatch(/navigator\.gpu|GPUDevice|GPUBuffer|mapAsync|getExtension/u);
    expect(source).toContain('new Hilo3d.ComputeShader');
    expect(source).toContain('new Hilo3d.ComputeRenderPass');
    expect(source).toContain('new Hilo3d.StorageGraphicsShader');
    expect(source).toContain('new Hilo3d.GPUDrivenRenderPass');
    expect(source).toContain('context.graph.importStorageBuffer');
    expect(source).not.toContain('context.graph.createTexture');
    expect(source).not.toContain("kind: 'storage-texture'");
    expect(source).toContain('fn intersectText(');
    expect(source).toContain('fn textDistance(');
    expect(source).toContain('fn intersectSphere(');
    expect(source).toContain('fn intersectRoundedBox(');
    expect(source).toContain('fn sdRoundBox3(');
    expect(source).toContain('fn fresnelSchlick(');
    expect(source).toContain('fn waterNormal(');
    expect(source).toContain('fn sphereCaustic(');
    expect(source).toContain('fn textCaustic(');
    expect(source).toContain('fn integrateVolume(');
    expect(source).toContain('let spectralBand =');
    expect(source).toContain('let sunDisc =');
    expect(source).toContain('vec3 denoisedRadiance(');
    expect(source).toContain('fn tracePath(');
    expect(source).toContain('for (var bounce = 0u; bounce < 5u; bounce += 1u)');
    expect(source).toContain('accumulation[radianceIndex] =');
    expect(source).toContain("recovery: 'cpu-shadow'");
    expect(source).toContain('new Hilo3d.RenderPassParameterPool');
    expect(source).toContain("colorEncoding: 'srgb'");
});

declare global {
    interface Window {
        __HILO3D_RAYTRACING_RESULT__?: RayTracingEvidence;
        __HILO3D_RAYTRACING_TEST_API__?: {
            readonly step: (frames: number) => Promise<RayTracingEvidence>;
        };
    }
}
