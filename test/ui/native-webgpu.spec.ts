import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { installPageFailureMonitor } from './page-failure-monitor';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    installRenderHealthProbe,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';

interface NativeAdapterObservation {
    readonly requestedForceFallbackAdapter: boolean | null;
    readonly effectiveForceFallbackAdapter: false;
    readonly isFallbackAdapter: boolean | null;
    readonly fingerprint: string;
}

interface NativeAdapterAudit {
    readonly observations: NativeAdapterObservation[];
    failure: string | null;
}

interface NativeComputeEffectsResult {
    readonly backend: string;
    readonly forward: Readonly<{
        coloredPixels: number;
        distinctColors: number;
        activeTiles: number;
    }>;
    readonly gaussian: Readonly<{ coloredPixels: number; distinctColors: number }>;
    readonly particle: Readonly<{
        coloredPixels: number;
        distinctColors: number;
        activeTiles: number;
        hash: number;
        simulatedParticles: number;
    }>;
}

interface SponzaVisualAngle {
    readonly label: string;
    readonly frames: readonly Buffer[];
}

interface SponzaCameraStep {
    readonly label: string;
    readonly x: number;
    readonly y: number;
    readonly nextView?: boolean;
}

const SPONZA_CAMERA_DRAGS: readonly SponzaCameraStep[] = Object.freeze([
    { label: 'hero', x: 0, y: 0 },
    { label: 'right-12', x: 12, y: 4 },
    { label: 'left-12', x: -24, y: 5 },
    { label: 'raised-right', x: 18, y: -10 },
    { label: 'corridor', nextView: true, x: 0, y: 0 },
    { label: 'corridor-left', x: -14, y: 3 }
]);

function differingPixelRatio(referencePng: Buffer, candidatePng: Buffer): number {
    const reference = PNG.sync.read(referencePng);
    const candidate = PNG.sync.read(candidatePng);
    expect(candidate.width).toBe(reference.width);
    expect(candidate.height).toBe(reference.height);
    let differentPixels = 0;
    const pixelCount = reference.width * reference.height;
    for (let offset = 0; offset < reference.data.length; offset += 4) {
        const redDelta = Math.abs((reference.data[offset] ?? 0) - (candidate.data[offset] ?? 0));
        const greenDelta = Math.abs(
            (reference.data[offset + 1] ?? 0) - (candidate.data[offset + 1] ?? 0)
        );
        const blueDelta = Math.abs(
            (reference.data[offset + 2] ?? 0) - (candidate.data[offset + 2] ?? 0)
        );
        if (Math.max(redDelta, greenDelta, blueDelta) > 4) differentPixels++;
    }
    return differentPixels / pixelCount;
}

async function captureSponzaAngles(
    page: Page,
    hiZEnabled: boolean,
    cullingEnabled: boolean,
    framesPerAngle: number
): Promise<readonly SponzaVisualAngle[]> {
    await page.goto(
        `/examples/clustered_forward_plus_sponza.html?backend=webgpu&hiZ=${String(hiZEnabled)}&culling=${String(cullingEnabled)}&tour=false&motion=false`,
        { waitUntil: 'load' }
    );
    const body = page.locator('body');
    await expect(body).toHaveAttribute('data-forward-plus-ready', 'true', { timeout: 60_000 });
    await expect(body).toHaveAttribute('data-hi-z-enabled', String(hiZEnabled));
    await expect(body).toHaveAttribute('data-culling-enabled', String(cullingEnabled));
    await expect(body).toHaveAttribute('data-hi-z-valid', String(hiZEnabled), {
        timeout: 15_000
    });
    const canvas = page.locator('canvas');
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error('Sponza canvas does not expose browser bounds');
    const startX = bounds.x + bounds.width * 0.62;
    const startY = bounds.y + bounds.height * 0.5;
    const angles: SponzaVisualAngle[] = [];
    for (const drag of SPONZA_CAMERA_DRAGS) {
        if (drag.nextView === true) {
            await page.locator('#viewButton').click();
            await page.waitForTimeout(1_350);
            await expect(body).toHaveAttribute('data-hi-z-valid', String(hiZEnabled), {
                timeout: 15_000
            });
        }
        if (drag.x !== 0 || drag.y !== 0) {
            await page.mouse.move(startX, startY);
            await page.mouse.down();
            await page.mouse.move(startX + drag.x, startY + drag.y, { steps: 4 });
            await page.mouse.up();
            await page.waitForTimeout(1_350);
            await expect(body).toHaveAttribute('data-hi-z-valid', String(hiZEnabled), {
                timeout: 15_000
            });
        }
        const frames: Buffer[] = [];
        for (let frameIndex = 0; frameIndex < framesPerAngle; frameIndex += 1) {
            await waitForStableAnimationFrames(page);
            frames.push(await canvas.screenshot({ animations: 'disabled' }));
        }
        angles.push({ label: drag.label, frames: Object.freeze(frames) });
    }
    return Object.freeze(angles);
}

declare global {
    interface Window {
        __HILO3D_NATIVE_WEBGPU_AUDIT__?: NativeAdapterAudit;
    }
}

async function installNativeAdapterGate(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const audit: NativeAdapterAudit = { observations: [], failure: null };
        Object.defineProperty(window, '__HILO3D_NATIVE_WEBGPU_AUDIT__', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: audit
        });

        const errorMessage = (error: unknown): string => {
            if (error instanceof Error) return error.message;
            const message =
                typeof error === 'object' && error !== null
                    ? (Reflect.get(error, 'message') as unknown)
                    : undefined;
            return typeof message === 'string' && message.length > 0 ? message : String(error);
        };
        const gpu: unknown = Reflect.get(navigator, 'gpu');
        if (typeof gpu !== 'object' || gpu === null) {
            audit.failure = 'navigator.gpu is unavailable';
            return;
        }
        const requestAdapter: unknown = Reflect.get(gpu, 'requestAdapter');
        if (typeof requestAdapter !== 'function') {
            audit.failure = 'navigator.gpu.requestAdapter is unavailable';
            return;
        }
        const nativeRequestAdapter = (
            options: GPURequestAdapterOptions
        ): Promise<GPUAdapter | null> =>
            Reflect.apply(requestAdapter, gpu, [options]) as Promise<GPUAdapter | null>;
        try {
            Object.defineProperty(gpu, 'requestAdapter', {
                configurable: true,
                writable: true,
                async value(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null> {
                    try {
                        const adapter = await nativeRequestAdapter({
                            ...options,
                            forceFallbackAdapter: false
                        });
                        if (!adapter) {
                            throw new Error('No native WebGPU adapter is available');
                        }
                        const info: unknown = Reflect.get(adapter, 'info');
                        const readInfo = (name: string): string => {
                            if (typeof info !== 'object' || info === null) return '';
                            const value: unknown = Reflect.get(info, name);
                            return typeof value === 'string' ? value : '';
                        };
                        const fallbackValue =
                            typeof info === 'object' && info !== null
                                ? (Reflect.get(info, 'isFallbackAdapter') as unknown)
                                : undefined;
                        const observation: NativeAdapterObservation = {
                            requestedForceFallbackAdapter: options?.forceFallbackAdapter ?? null,
                            effectiveForceFallbackAdapter: false,
                            isFallbackAdapter:
                                typeof fallbackValue === 'boolean' ? fallbackValue : null,
                            fingerprint: [
                                readInfo('vendor'),
                                readInfo('architecture'),
                                readInfo('device'),
                                readInfo('description')
                            ]
                                .filter(Boolean)
                                .join(' ')
                        };
                        audit.observations.push(observation);
                        if (observation.isFallbackAdapter !== false) {
                            throw new Error(
                                'Native WebGPU gate requires adapter.info.isFallbackAdapter === false'
                            );
                        }
                        if (
                            /swiftshader|llvmpipe|lavapipe|software rasterizer|microsoft basic render/iu.test(
                                observation.fingerprint
                            )
                        ) {
                            throw new Error(
                                `Native WebGPU gate rejected software adapter: ${observation.fingerprint}`
                            );
                        }
                        return adapter;
                    } catch (error: unknown) {
                        audit.failure = errorMessage(error);
                        throw error;
                    }
                }
            });
        } catch (error: unknown) {
            audit.failure = `Unable to instrument GPU.requestAdapter: ${errorMessage(error)}`;
        }
    });
}

test('runs the production WebGPU fixture on a non-fallback native adapter', async ({ page }) => {
    test.setTimeout(120_000);
    await installNativeAdapterGate(page);
    await installRenderHealthProbe(page);
    const failures = await installPageFailureMonitor(page);
    let pageErrorHandler: ((error: Error) => void) | undefined;
    const pageError = new Promise<never>((_resolve, reject) => {
        pageErrorHandler = error => {
            reject(new Error(`Native WebGPU page failed: ${error.message}`, { cause: error }));
        };
        page.on('pageerror', pageErrorHandler);
    });
    try {
        await Promise.race([
            (async () => {
                await page.goto('/test/ui/fixtures/webgpu.html', { waitUntil: 'load' });
                await page.waitForFunction(() => {
                    const audit = window.__HILO3D_NATIVE_WEBGPU_AUDIT__;
                    return (
                        audit !== undefined &&
                        (audit.failure !== null || window.__HILO3D_WEBGPU_RESULT__ !== undefined)
                    );
                });
            })(),
            pageError
        ]);

        const audit = await page.evaluate(() => window.__HILO3D_NATIVE_WEBGPU_AUDIT__);
        expect(audit?.failure).toBeNull();
        expect(audit?.observations.length).toBeGreaterThan(0);
        expect(
            audit?.observations.map(observation => observation.effectiveForceFallbackAdapter)
        ).toEqual(audit?.observations.map(() => false));
        expect(
            audit?.observations.every(
                observation =>
                    observation.requestedForceFallbackAdapter !== true &&
                    observation.isFallbackAdapter === false
            )
        ).toBe(true);

        const result = await page.evaluate(() => window.__HILO3D_WEBGPU_RESULT__);
        expect(result).toMatchObject({
            backend: 'webgpu',
            rhiExtensionBackend: 'webgpu',
            rhiSurfaceState: 'configured',
            recoveryState: 'ready',
            recoveryReadbackMatches: true,
            extendedGpuSubmissionCompleted: true,
            offscreenStencilStableAcrossFrames: true
        });
        expect(result?.drawCount).toBeGreaterThan(0);
        expect(result?.readbackHasContent).toBe(true);

        await assertStableInstrumentationHealth('webgpu', 'native WebGPU final health', {
            waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
            awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
            readRenderHealth: () => readRenderHealth(page)
        });
        failures.assertEmpty('native WebGPU browser failures');
    } finally {
        if (pageErrorHandler) page.off('pageerror', pageErrorHandler);
        await failures.dispose();
    }
});

test('runs public compute and GPU-driven effects on a non-fallback native adapter', async ({
    page
}) => {
    test.setTimeout(120_000);
    await installNativeAdapterGate(page);
    await installRenderHealthProbe(page);
    const failures = await installPageFailureMonitor(page);
    let pageErrorHandler: ((error: Error) => void) | undefined;
    const pageError = new Promise<never>((_resolve, reject) => {
        pageErrorHandler = error => {
            reject(
                new Error(`Native compute effects page failed: ${error.message}`, { cause: error })
            );
        };
        page.on('pageerror', pageErrorHandler);
    });
    try {
        await Promise.race([
            (async () => {
                await page.goto('/examples/compute_gpu_driven.html?backend=webgpu', {
                    waitUntil: 'load'
                });
                await page.waitForFunction(() => {
                    const audit = window.__HILO3D_NATIVE_WEBGPU_AUDIT__;
                    return (
                        audit !== undefined &&
                        (audit.failure !== null ||
                            Reflect.get(window, '__HILO3D_COMPUTE_EFFECTS_RESULT__') !== undefined)
                    );
                });
            })(),
            pageError
        ]);

        const audit = await page.evaluate(() => window.__HILO3D_NATIVE_WEBGPU_AUDIT__);
        expect(audit?.failure).toBeNull();
        expect(audit?.observations.length).toBeGreaterThan(0);
        expect(
            audit?.observations.every(
                observation =>
                    observation.requestedForceFallbackAdapter !== true &&
                    observation.isFallbackAdapter === false
            )
        ).toBe(true);

        const result = (await page.evaluate(() =>
            Reflect.get(window, '__HILO3D_COMPUTE_EFFECTS_RESULT__')
        )) as NativeComputeEffectsResult;
        expect(result.backend).toBe('webgpu');
        expect(result.forward.coloredPixels).toBeGreaterThan(10_000);
        expect(result.forward.distinctColors).toBeGreaterThan(3);
        expect(result.forward.activeTiles).toBeGreaterThanOrEqual(3);
        expect(result.gaussian.coloredPixels).toBeGreaterThan(20_000);
        expect(result.gaussian.distinctColors).toBeGreaterThan(100);
        expect(result.particle.coloredPixels).toBeGreaterThan(15_000);
        expect(result.particle.distinctColors).toBeGreaterThan(1_000);
        expect(result.particle.activeTiles).toBe(4);
        expect(result.particle.hash).toBeGreaterThan(0);
        expect(result.particle.simulatedParticles).toBe(1024);

        const health = await readRenderHealth(page);
        expect(
            health.reduce((sum, frame) => sum + (frame.snapshot.webgpuDispatchCalls ?? 0), 0)
        ).toBeGreaterThanOrEqual(7);
        expect(
            health.reduce((sum, frame) => sum + (frame.snapshot.webgpuIndirectDrawCalls ?? 0), 0)
        ).toBeGreaterThanOrEqual(2);
        const nativeDraws = health.reduce((sum, frame) => sum + frame.snapshot.webgpuDrawCalls, 0);
        const indirectDraws = health.reduce(
            (sum, frame) => sum + (frame.snapshot.webgpuIndirectDrawCalls ?? 0),
            0
        );
        expect(nativeDraws - indirectDraws).toBeGreaterThanOrEqual(6);

        await assertStableInstrumentationHealth('webgpu', 'native compute effects health', {
            waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
            awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
            readRenderHealth: () => readRenderHealth(page)
        });
        failures.assertEmpty('native compute effects browser failures');
    } finally {
        if (pageErrorHandler) page.off('pageerror', pageErrorHandler);
        await failures.dispose();
    }
});

test('Sponza Forward+ exposes stable camera and lighting controls @webgpu', async ({ page }) => {
    test.setTimeout(120_000);
    await installNativeAdapterGate(page);
    await installRenderHealthProbe(page);
    const failures = await installPageFailureMonitor(page);
    try {
        await page.goto('/examples/clustered_forward_plus_sponza.html?backend=webgpu', {
            waitUntil: 'load'
        });
        const body = page.locator('body');
        await expect(body).toHaveAttribute('data-forward-plus-ready', 'true', {
            timeout: 60_000
        });
        await expect(body).toHaveAttribute('data-asset', 'khronos-sponza');
        await expect(body).toHaveAttribute('data-excluded-meshes', '14');
        await expect(body).toHaveAttribute('data-diagnostics-ready', 'true');
        await expect(body).toHaveAttribute('data-hi-z-valid', 'false');
        await expect(page.locator('#backendLabel')).toContainText('WEBGPU');
        await expect(page.locator('#fallbackObjectCount')).toHaveText('0');
        await expect(page.locator('#overflowCount')).toHaveText('0');

        const audit = await page.evaluate(() => window.__HILO3D_NATIVE_WEBGPU_AUDIT__);
        expect(audit?.failure).toBeNull();
        expect(audit?.observations.length).toBeGreaterThan(0);
        expect(
            audit?.observations.every(
                observation =>
                    observation.requestedForceFallbackAdapter !== true &&
                    observation.isFallbackAdapter === false
            )
        ).toBe(true);

        const tourToggle = page.locator('#tourToggle');
        await expect(tourToggle).toHaveAttribute('aria-pressed', 'true');
        await tourToggle.click();
        await expect(body).toHaveAttribute('data-camera-tour', 'false');
        await expect(body).toHaveAttribute('data-hi-z-valid', 'true', { timeout: 15_000 });

        await page.locator('#lightControl').evaluate(element => {
            if (!(element instanceof HTMLInputElement)) {
                throw new Error('Expected #lightControl to be an input element');
            }
            element.value = '96';
            element.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await expect(body).toHaveAttribute('data-active-lights', '96');
        await expect(page.locator('#lightOutput')).toHaveText('96 / 192');

        const motionToggle = page.locator('#motionToggle');
        await expect(motionToggle).toHaveAttribute('aria-pressed', 'true');
        await motionToggle.click();
        await expect(motionToggle).toHaveAttribute('aria-pressed', 'false');

        await assertStableInstrumentationHealth('webgpu', 'Sponza Forward+ native health', {
            waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
            awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
            readRenderHealth: () => readRenderHealth(page)
        });
        failures.assertEmpty('Sponza Forward+ native browser failures');
    } finally {
        await failures.dispose();
    }
});

test('Sponza GPU culling remains visually identical across small camera turns @webgpu', async ({
    page
}) => {
    test.setTimeout(180_000);
    await installNativeAdapterGate(page);
    const failures = await installPageFailureMonitor(page);
    try {
        const withGPUCulling = await captureSponzaAngles(page, true, true, 4);
        const withoutGPUCulling = await captureSponzaAngles(page, false, false, 1);
        expect(withGPUCulling).toHaveLength(withoutGPUCulling.length);
        for (let angleIndex = 0; angleIndex < withGPUCulling.length; angleIndex += 1) {
            const testedAngle = withGPUCulling[angleIndex];
            const referenceAngle = withoutGPUCulling[angleIndex];
            expect(testedAngle?.label).toBe(referenceAngle?.label);
            const reference = referenceAngle?.frames[0];
            if (testedAngle === undefined || reference === undefined) {
                throw new Error(`Missing Sponza visual angle ${String(angleIndex)}`);
            }
            for (const frame of testedAngle.frames) {
                const ratio = differingPixelRatio(reference, frame);
                expect(
                    ratio,
                    `${testedAngle.label} GPU-culled frame differs from the unculled reference`
                ).toBeLessThan(0.002);
            }
        }
        failures.assertEmpty('Sponza GPU-culling camera-turn browser failures');
    } finally {
        await failures.dispose();
    }
});
