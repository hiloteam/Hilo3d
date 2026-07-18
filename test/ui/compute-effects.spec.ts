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

interface LaneEvidence {
    readonly coloredPixels: number;
    readonly partialPixels: number;
    readonly distinctColors: number;
    readonly activeTiles: number;
    readonly hash: number;
}

interface ParticleEvidence extends LaneEvidence {
    readonly simulatedParticles: number;
}

interface ComputeEffectsResult {
    readonly backend: string;
    readonly forward: LaneEvidence & {
        readonly centerColor: readonly [number, number, number, number];
    };
    readonly gaussian: LaneEvidence;
    readonly particle: ParticleEvidence;
}

async function result(page: Page): Promise<ComputeEffectsResult> {
    await page.waitForFunction(() => window.__HILO3D_COMPUTE_EFFECTS_RESULT__ !== undefined);
    const value = await page.evaluate(() => window.__HILO3D_COMPUTE_EFFECTS_RESULT__);
    if (value === undefined) throw new Error('Compute effects example did not publish a result');
    return value;
}

test('executes public compute and GPU-driven effect data flows on real WebGPU', async ({
    page
}) => {
    test.setTimeout(120_000);
    await installRenderHealthProbe(page);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const pageFailure = new Promise<never>((_resolve, reject) => {
        page.on('pageerror', error => {
            reject(new Error(`Compute effects page failed: ${error.message}`, { cause: error }));
        });
    });
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto('/examples/compute_gpu_driven.html?backend=webgpu', { waitUntil: 'load' });
    const first = await Promise.race([result(page), pageFailure]);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(first.backend).toBe('webgpu');
    expect(first.forward.centerColor.slice(0, 3).some(channel => channel > 20)).toBe(true);
    expect(first.forward.coloredPixels).toBeGreaterThan(10_000);
    expect(first.forward.distinctColors).toBeGreaterThan(3);
    expect(first.forward.activeTiles).toBeGreaterThanOrEqual(3);
    expect(first.gaussian.coloredPixels).toBeGreaterThan(20_000);
    expect(first.gaussian.partialPixels).toBeGreaterThan(20_000);
    expect(first.gaussian.distinctColors).toBeGreaterThan(100);
    expect(first.particle.coloredPixels).toBeGreaterThan(15_000);
    expect(first.particle.partialPixels).toBeGreaterThan(15_000);
    expect(first.particle.distinctColors).toBeGreaterThan(1_000);
    expect(first.particle.activeTiles).toBe(4);
    expect(first.particle.simulatedParticles).toBe(1024);

    const firstHealth = await readRenderHealth(page);
    expect(
        firstHealth.reduce((sum, frame) => sum + (frame.snapshot.webgpuComputePasses ?? 0), 0)
    ).toBeGreaterThanOrEqual(7);
    const initialDispatches = firstHealth.reduce(
        (sum, frame) => sum + (frame.snapshot.webgpuDispatchCalls ?? 0),
        0
    );
    expect(initialDispatches).toBeGreaterThanOrEqual(7);
    expect(
        firstHealth.reduce((sum, frame) => sum + (frame.snapshot.webgpuIndirectDrawCalls ?? 0), 0)
    ).toBeGreaterThanOrEqual(2);
    const nativeDraws = firstHealth.reduce((sum, frame) => sum + frame.snapshot.webgpuDrawCalls, 0);
    const indirectDraws = firstHealth.reduce(
        (sum, frame) => sum + (frame.snapshot.webgpuIndirectDrawCalls ?? 0),
        0
    );
    expect(nativeDraws - indirectDraws).toBeGreaterThanOrEqual(6);

    await waitForStableAnimationFrames(page);
    await awaitTrackedGPUQueues(page);
    const animatedHealth = await readRenderHealth(page);
    expect(
        animatedHealth.reduce((sum, frame) => sum + (frame.snapshot.webgpuDispatchCalls ?? 0), 0)
    ).toBeGreaterThan(initialDispatches);
    expect(
        animatedHealth.reduce(
            (sum, frame) => sum + (frame.snapshot.webgpuIndirectDrawCalls ?? 0),
            0
        )
    ).toBeGreaterThan(indirectDraws);

    await assertStableInstrumentationHealth('webgpu', 'compute effects WebGPU health', {
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });

    await page.reload({ waitUntil: 'load' });
    const repeated = await Promise.race([result(page), pageFailure]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(repeated.particle.hash).toBe(first.particle.hash);
    expect(repeated.particle.coloredPixels).toBe(first.particle.coloredPixels);
});

test('keeps count, reorder, and indirect arguments GPU-only in the public example', () => {
    const source = readFileSync(
        fileURLToPath(new URL('../../examples/compute_gpu_driven.ts', import.meta.url)),
        'utf8'
    );

    expect(source).not.toMatch(/navigator\.gpu|GPUDevice|GPUBuffer|mapAsync|getExtension/u);
    expect(source.match(/new Hilo3d\.Mesh\b/gu)).toHaveLength(3);
    expect(source.match(/new Hilo3d\.PBRMaterial\b/gu)).toHaveLength(3);
    expect(source.match(/readColorAttachment\s*\(/gu)).toHaveLength(1);
    expect(source).toContain('context.createRendererList');
    expect(source).toContain('storageShaderVariant');
    expect(source).toContain("new Hilo3d.SceneRenderPass('Forward+ sampled depth prepass')");
    expect(source).toContain('readonly colorAttachments = EMPTY_COLOR_ATTACHMENTS');
    expect(source).toContain('var sceneDepth: texture_depth_2d');
    expect(source).toContain('textureLoad(sceneDepth');
    expect(source).toContain("sampleType: 'depth'");
    expect(source).toContain('this.cullLights.setTexture(0, outputDepth)');
    expect(source).toContain('gl_FragCoord.x');
    expect(source).toContain('Gaussian reorder stage A');
    expect(source).toContain('Gaussian reorder stage B');
    expect(source).toContain('Particle alive-list compaction and draw arguments');
    expect(source.match(/new Hilo3d\.GPUDrivenRenderPass\b/gu)).toHaveLength(2);
    expect(source.match(/readonly kind = 'draw-indirect'/gu)).toHaveLength(1);
    expect(source).toContain('const PARTICLE_COUNT = 1024');
    expect(source).toContain('HILO3D_GLYPHS');
    expect(source).toContain('fn valueNoise(');
    expect(source).toContain('fn fractalValueNoise(');
    expect(source).toContain('fn curlNoise(');
    expect(source).toContain('let breathingTarget = homePosition');
    expect(source).toContain('let vortex = tangent');
    expect(source).toContain('blendDst: Hilo3d.constants.ONE');
    expect(source).toContain('new Hilo3d.Ticker(60)');
    expect(source.match(/new Hilo3d\.RenderPassParameterPool/gu)).toHaveLength(3);
    expect(source).toContain('context.acquirePassParameters');
    expect(source).toContain(
        'Every subsequent position/velocity update comes from the compute pass'
    );
    expect(source).not.toContain("recovery: 'reinitialize'");
    expect(source).toMatch(
        /label: 'Deterministic Hilo3D curl-noise particle state'[\s\S]*?recovery: 'cpu-shadow'/u
    );
    expect(source).toContain('are not retained across WebGPU device loss');
});

declare global {
    interface Window {
        __HILO3D_COMPUTE_EFFECTS_RESULT__?: ComputeEffectsResult;
    }
}
