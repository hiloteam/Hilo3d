import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    installRenderHealthProbe,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';

interface EclipseShrineEvidence {
    readonly backend: string;
    readonly particleCount: number;
    readonly activeParticleCount: number;
    readonly indirectLayers: number;
    readonly drawCount: number;
}

test('renders and interacts with the WebGPU eclipse installation', async ({ page }) => {
    test.setTimeout(120_000);
    await installRenderHealthProbe(page);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto('/examples/compute_eclipse_shrine.html?backend=webgpu&test=1', {
        waitUntil: 'load'
    });
    await page.waitForFunction(() => document.body.dataset['eclipseShrineReady'] === 'true');
    await page.waitForFunction(() => window.__HILO3D_ECLIPSE_RESULT__ !== undefined);
    const evidence = await page.evaluate(() => window.__HILO3D_ECLIPSE_RESULT__);
    if (evidence === undefined) throw new Error('Eclipse Shrine did not publish frame evidence');

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(evidence.backend).toBe('webgpu');
    expect(evidence.particleCount).toBe(65_536);
    expect(evidence.activeParticleCount).toBe(4_096);
    expect(evidence.indirectLayers).toBe(3);
    expect(evidence.drawCount).toBeGreaterThan(0);
    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('#failure')).toBeHidden();

    const noctis = page.getByRole('button', { name: 'Noctis', exact: true });
    await noctis.click();
    await expect(noctis).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Aurelia', exact: true })).toHaveAttribute(
        'aria-pressed',
        'false'
    );

    const canvas = page.locator('canvas');
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error('Eclipse Shrine canvas is unavailable');
    const centerX = bounds.x + bounds.width * 0.5;
    const centerY = bounds.y + bounds.height * 0.52;
    await page.mouse.move(centerX - 90, centerY + 30);
    await page.mouse.down();
    await page.mouse.move(centerX + 120, centerY - 45, { steps: 6 });
    await page.mouse.up();
    await waitForStableAnimationFrames(page);

    const health = await readRenderHealth(page);
    expect(
        health.reduce((sum, frame) => sum + (frame.snapshot.webgpuComputePasses ?? 0), 0)
    ).toBeGreaterThan(0);
    expect(
        health.reduce((sum, frame) => sum + (frame.snapshot.webgpuDispatchCalls ?? 0), 0)
    ).toBeGreaterThan(0);
    expect(
        health.reduce((sum, frame) => sum + (frame.snapshot.webgpuIndirectDrawCalls ?? 0), 0)
    ).toBeGreaterThanOrEqual(3);

    await assertStableInstrumentationHealth('webgpu', 'Eclipse Shrine WebGPU health', {
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });
});

test('keeps Eclipse Shrine on public compute, storage, and Render Graph APIs', () => {
    const source = readFileSync(
        fileURLToPath(new URL('../../examples/compute_eclipse_shrine.ts', import.meta.url)),
        'utf8'
    );

    expect(source).not.toMatch(/navigator\.gpu|GPUDevice|GPUBuffer|mapAsync|getExtension/u);
    expect(source).toContain('const PARTICLE_COUNT = 65_536');
    expect(source).toContain('const ACTIVE_PARTICLE_COUNT = IS_TEST_MODE ? 4_096 : PARTICLE_COUNT');
    expect(source).toContain('new Hilo3d.ComputeShader');
    expect(source).toContain('new Hilo3d.ComputeRenderPass');
    expect(source.match(/new Hilo3d\.GPUDrivenRenderPass\b/gu)).toHaveLength(3);
    expect(source).toContain('new Hilo3d.StorageGraphicsShader');
    expect(source).toContain('implements Hilo3d.ForwardRenderPipelineFeature');
    expect(source).toContain('new Hilo3d.PostProcessRenderPipelineFactory');
    expect(source).toContain('context.pipeline.graph.importStorageBuffer');
    expect(source).toContain("recovery: 'cpu-shadow'");
    expect(source).toContain("readonly injectionPoint = 'before-transparent'");
    expect(source).toContain('bloom: {');
    expect(source).toContain('colorUber: {');
    expect(source).toContain('this.#targetPitch + deltaY * 0.0032');
});

declare global {
    interface Window {
        __HILO3D_ECLIPSE_RESULT__?: EclipseShrineEvidence;
    }
}
