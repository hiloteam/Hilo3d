import { expect, test, type Page } from '@playwright/test';
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
