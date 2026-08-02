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

interface ParticleEvidence {
    readonly backend: string;
    readonly particleCount: number;
    readonly coloredPixels: number;
    readonly luminousPixels: number;
    readonly luminousCenterX: number;
    readonly luminousCenterY: number;
    readonly distinctColors: number;
    readonly activeTiles: number;
    readonly wordSampleCoverage: number;
    readonly mirroredWordSampleCoverage: number;
    readonly ambientLuminousPixels: number;
    readonly hash: number;
    readonly interactionRevision: number;
    readonly pointerX: number;
    readonly pointerY: number;
    readonly pointerRingEnergy: number;
    readonly mirroredPointerRingEnergy: number;
}

async function initialResult(page: Page): Promise<ParticleEvidence> {
    await page.waitForFunction(() => window.__HILO3D_PARTICLE_RESULT__ !== undefined);
    const value = await page.evaluate(() => window.__HILO3D_PARTICLE_RESULT__);
    if (value === undefined) throw new Error('Particle example did not publish initial evidence');
    return value;
}

async function step(page: Page, frames: number): Promise<ParticleEvidence> {
    return page.evaluate(async frameCount => {
        const api = window.__HILO3D_PARTICLE_TEST_API__;
        if (api === undefined) throw new Error('Particle example test API is unavailable');
        return api.step(frameCount);
    }, frames);
}

test('runs interactive Hilo3D noise, meteor-wake, and collision particles on WebGPU', async ({
    page
}) => {
    test.setTimeout(120_000);
    await installRenderHealthProbe(page);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto('/examples/compute_particles.html?backend=webgpu&test=1', {
        waitUntil: 'load'
    });
    const initial = await initialResult(page);
    const baseline = await step(page, 8);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(initial.backend).toBe('webgpu');
    expect(initial.particleCount).toBe(65_536);
    expect(initial.coloredPixels).toBeGreaterThan(40_000);
    expect(initial.luminousPixels).toBeGreaterThan(1_000);
    expect(initial.luminousCenterX).toBeGreaterThan(300);
    expect(initial.luminousCenterX).toBeLessThan(980);
    expect(initial.luminousCenterY).toBeGreaterThan(190);
    expect(initial.luminousCenterY).toBeLessThan(530);
    expect(initial.distinctColors).toBeGreaterThan(500);
    expect(initial.activeTiles).toBeGreaterThan(80);
    expect(initial.wordSampleCoverage).toBeGreaterThan(0.75);
    expect(initial.wordSampleCoverage).toBeGreaterThan(initial.mirroredWordSampleCoverage * 1.25);
    expect(initial.ambientLuminousPixels).toBeGreaterThan(100);
    expect(baseline.hash).not.toBe(initial.hash);

    await page.reload({ waitUntil: 'load' });
    await initialResult(page);
    const canvas = page.locator('canvas');
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error('Particle canvas is unavailable');
    const centerX = bounds.x + bounds.width * 0.54;
    const centerY = bounds.y + bounds.height * 0.52;
    await page.mouse.move(centerX, bounds.y + bounds.height * 0.2);
    const upperPointer = await step(page, 1);
    expect(upperPointer.pointerY).toBeGreaterThan(0.4);
    expect(upperPointer.pointerRingEnergy).toBeGreaterThan(20);
    expect(upperPointer.pointerRingEnergy).toBeGreaterThan(
        upperPointer.mirroredPointerRingEnergy * 1.2
    );
    await page.mouse.move(centerX, bounds.y + bounds.height * 0.8);
    const lowerPointer = await step(page, 1);
    expect(lowerPointer.pointerY).toBeLessThan(-0.4);
    await page.mouse.move(centerX - 180, centerY - 90);
    await page.mouse.down();
    await page.mouse.move(centerX + 120, centerY + 60, { steps: 5 });
    const shockwave = await step(page, 8);
    await page.mouse.up();
    expect(shockwave.interactionRevision).toBeGreaterThan(0);
    expect(shockwave.hash).not.toBe(baseline.hash);

    await page.reload({ waitUntil: 'load' });
    await initialResult(page);
    await page.mouse.move(centerX - 140, centerY + 70);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(centerX + 160, centerY - 110, { steps: 6 });
    const vortex = await step(page, 8);
    await page.mouse.up({ button: 'right' });
    expect(vortex.interactionRevision).toBeGreaterThan(0);
    expect(vortex.hash).not.toBe(baseline.hash);
    expect(vortex.hash).not.toBe(shockwave.hash);

    const health = await readRenderHealth(page);
    expect(
        health.reduce((sum, frame) => sum + (frame.snapshot.webgpuComputePasses ?? 0), 0)
    ).toBeGreaterThanOrEqual(9);
    expect(
        health.reduce((sum, frame) => sum + (frame.snapshot.webgpuDispatchCalls ?? 0), 0)
    ).toBeGreaterThanOrEqual(9);
    expect(
        health.reduce((sum, frame) => sum + (frame.snapshot.webgpuIndirectDrawCalls ?? 0), 0)
    ).toBeGreaterThanOrEqual(27);

    await assertStableInstrumentationHealth('webgpu', 'interactive particle WebGPU health', {
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });
});

test('keeps the interactive particle simulation and rendering on public GPU APIs', () => {
    const source = readFileSync(
        fileURLToPath(new URL('../../examples/compute_particles.ts', import.meta.url)),
        'utf8'
    );

    expect(source).not.toMatch(/navigator\.gpu|GPUDevice|GPUBuffer|mapAsync|getExtension/u);
    expect(source).toContain('const WORD_PARTICLE_COUNT = 4096');
    expect(source).toContain('const AMBIENT_PARTICLE_COUNT = 61440');
    expect(source).toContain('const PARTICLE_COUNT = WORD_PARTICLE_COUNT + AMBIENT_PARTICLE_COUNT');
    expect(source).toContain('HILO3D_GLYPHS');
    expect(source).toContain('fn valueNoise3(');
    expect(source).toContain('fn fractalNoise3(');
    expect(source).toContain('fn curlNoise(');
    expect(source).toContain('fn collideCircle(');
    expect(source).toContain('fn meteorState(');
    expect(source).toContain('fn meteorWake(');
    expect(source).toContain('return (value >>> 0) / 0x1_0000_0000');
    expect(source).toContain('let meteorAState = meteorState(');
    expect(source).toContain('interaction.pointer.w > 0.5');
    expect(source).toContain('interaction.pointer.w < -0.5');
    expect(source).toContain('let horizontalLimit = select(1.08, 0.965, isWordParticle)');
    expect(source).toContain('let verticalLimit = select(1.08, 0.91, isWordParticle)');
    expect(source).toContain('drawArguments[0] = ${String(WORD_PARTICLE_COUNT * 6)}u');
    expect(source).toContain('drawArguments[4] = ${String(AMBIENT_PARTICLE_COUNT * 6)}u');
    expect(source.match(/new Hilo3d\.GPUDrivenRenderPass\b/gu)).toHaveLength(3);
    expect(source).toContain("name: 'Cyber dune and deep-field particle layer'");
    expect(source).toContain('float auroraCurtain(');
    expect(source).toContain('float midgroundHillY =');
    expect(source).toContain('float scanCycle = mod(u_time.x, 10.0)');
    expect(source).toContain('this.ambient.configure(particles, argumentsBuffer, outputColor, 16)');
    expect(source).toContain('const y = 1 - ((event.clientY - bounds.top) / bounds.height) * 2');
    expect(source).toContain('vec2 point = (uv * 2.0 - 1.0) * vec2(u_time.z, 1.0)');
    expect(source).toContain("readonly kind = 'draw-indirect'");
    expect(source).toContain('new Hilo3d.RenderPassParameterPool');
    expect(source).toContain('context.graph.importStorageBuffer');
    expect(source).toContain("recovery: 'cpu-shadow'");
    expect(source).toContain('blend: Hilo3d.MaterialBlendPreset.STRAIGHT_ALPHA_ADDITIVE');
    expect(source).toContain("colorEncoding: 'srgb'");
});

declare global {
    interface Window {
        __HILO3D_PARTICLE_RESULT__?: ParticleEvidence;
        __HILO3D_PARTICLE_TEST_API__?: {
            readonly step: (frames: number) => Promise<ParticleEvidence>;
        };
    }
}
