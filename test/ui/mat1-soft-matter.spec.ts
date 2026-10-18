import { writeFile } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type { TestFrameControl } from '../../examples/shared/test-frame-control';
import type { ExampleBackend } from './example-paths';
import { installPageFailureMonitor } from './page-failure-monitor';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    installRenderHealthProbe,
    nativeRenderProgress,
    nativeRenderProgressAdvanced,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';
import { captureStableFrame } from './stable-capture';

type SurfaceFeature = 'sheen' | 'thin' | 'sss';
interface SoftMatterAPI {
    readonly ready: boolean;
    readonly disposed: boolean;
    readonly retained: boolean;
    readonly frame: number;
    cameraPosition(): readonly number[];
    setFeature(feature: SurfaceFeature, enabled: boolean): void;
    setView(view: 'gallery' | 'velvet' | 'petal' | 'wax'): void;
    settle(options?: Readonly<{ keepPaused?: boolean }>): Promise<void>;
    resume(): void;
    dispose(): Promise<void>;
}
type SoftMatterWindow = Window & {
    __HILO_SOFT_MATTER__?: SoftMatterAPI;
    __HILO3D_TEST_CAPTURE__?: TestFrameControl;
};
interface ModelResponseGate {
    readonly received: boolean;
    readonly byteLength: number;
    release(): void;
}
type GatedSoftMatterWindow = SoftMatterWindow & {
    __HILO_SOFT_MATTER_MODEL_GATE__?: ModelResponseGate;
};

interface PixelDifference {
    readonly changedRatio: number;
    readonly meanRGB: number;
}
interface Region {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

// The fixed gallery view places velvet left, wax centrally and amber petals right. Restrict
// evidence to each sculpture so a global exposure change cannot stand in for a material response.
const FEATURE_REGIONS: Readonly<Record<SurfaceFeature, Region>> = {
    sheen: { left: 0.1, right: 0.4, top: 0.2, bottom: 0.8 },
    sss: { left: 0.38, right: 0.67, top: 0.2, bottom: 0.8 },
    thin: { left: 0.66, right: 0.93, top: 0.2, bottom: 0.8 }
};
const SCENE_CAPTURE_STYLE = `
body * { visibility: hidden !important; }
canvas[data-hilo3d-backend] { visibility: visible !important; }
`;

function pixelDifference(first: Buffer, second: Buffer, region: Region): PixelDifference {
    const a = PNG.sync.read(first);
    const b = PNG.sync.read(second);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    const left = Math.floor(a.width * region.left);
    const right = Math.ceil(a.width * region.right);
    const top = Math.floor(a.height * region.top);
    const bottom = Math.ceil(a.height * region.bottom);
    let changed = 0;
    let sum = 0;
    for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
            const offset = (y * a.width + x) * 4;
            const red = Math.abs((a.data[offset] ?? 0) - (b.data[offset] ?? 0));
            const green = Math.abs((a.data[offset + 1] ?? 0) - (b.data[offset + 1] ?? 0));
            const blue = Math.abs((a.data[offset + 2] ?? 0) - (b.data[offset + 2] ?? 0));
            sum += red + green + blue;
            if (Math.max(red, green, blue) > 4) changed++;
        }
    }
    const pixels = (right - left) * (bottom - top);
    return { changedRatio: changed / pixels, meanRGB: sum / (pixels * 3) };
}

async function attachImage(testInfo: TestInfo, name: string, body: Buffer): Promise<void> {
    const path = testInfo.outputPath(`${name}.png`);
    await writeFile(path, body);
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function captureScene(page: Page, backend: ExampleBackend): Promise<Buffer> {
    await page.evaluate(async () => {
        const current = window as SoftMatterWindow;
        const api = current.__HILO_SOFT_MATTER__;
        const capture = current.__HILO3D_TEST_CAPTURE__;
        if (!api || !capture) throw new Error('Soft Matter capture requires a ready test=1 page');
        await capture.pause();
        // settle() uses actual scene submissions and returns at the same eight-phase TAA boundary.
        await api.settle({ keepPaused: true });
        await capture.pause();
        if (api.frame % 8 !== 0) throw new Error('Soft Matter comparisons require TAA phase zero');
    });
    return captureStableFrame(page, backend, { style: SCENE_CAPTURE_STYLE });
}

async function waitForLiveFrames(page: Page, backend: ExampleBackend): Promise<void> {
    const before = nativeRenderProgress(await readRenderHealth(page), backend);
    await page.evaluate(async () => {
        const current = window as SoftMatterWindow;
        const capture = current.__HILO3D_TEST_CAPTURE__;
        const api = current.__HILO_SOFT_MATTER__;
        if (!capture || !api) throw new Error('Soft Matter live frame controls unavailable');
        api.resume();
        await capture.waitForFrames(2);
    });
    await awaitTrackedGPUQueues(page);
    expect(
        nativeRenderProgressAdvanced(
            before,
            nativeRenderProgress(await readRenderHealth(page), backend),
            backend
        )
    ).toBe(true);
}

async function cameraPosition(page: Page): Promise<readonly number[]> {
    return page.evaluate(() => {
        const api = (window as SoftMatterWindow).__HILO_SOFT_MATTER__;
        if (!api) throw new Error('Soft Matter camera controls unavailable');
        return api.cameraPosition();
    });
}

async function assertRenderHealth(page: Page, backend: ExampleBackend): Promise<void> {
    await assertStableInstrumentationHealth(backend, `Soft Matter ${backend}`, {
        readRenderHealth: () => readRenderHealth(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page)
    });
}

async function requirePhysicalAdapter(
    page: Page,
    backend: ExampleBackend,
    production: boolean
): Promise<void> {
    if (!production || backend !== 'webgpu') return;
    await page.addInitScript(() => {
        if (location.href === 'about:blank') return;
        const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
        navigator.gpu.requestAdapter = async options => {
            const adapter = await requestAdapter({ ...options, forceFallbackAdapter: false });
            if (adapter?.info.isFallbackAdapter !== false)
                throw new Error('Physical Soft Matter acceptance needs a non-fallback adapter');
            return adapter;
        };
    });
}

/** Fully receive the real GLB, preserving its original Response until initialization is cancelled. */
async function holdModelResponse(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const originalFetch = window.fetch.bind(window);
        let releaseResponse: (() => void) | undefined;
        const pending = new Promise<void>(resolve => {
            releaseResponse = resolve;
        });
        let received = false;
        let byteLength = 0;
        (window as GatedSoftMatterWindow).__HILO_SOFT_MATTER_MODEL_GATE__ = {
            get received(): boolean {
                return received;
            },
            get byteLength(): number {
                return byteLength;
            },
            release(): void {
                window.fetch = originalFetch;
                releaseResponse?.();
            }
        };
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const response = await originalFetch(input, init);
            if (
                new URL(response.url).pathname !==
                '/examples/assets/mat1-soft-matter/soft-matter.glb'
            )
                return response;
            if (!response.ok) return response;
            // Draining a clone completes the real transport without replacing the loader's bytes,
            // status, URL or headers. Only delivery to the application waits for the gate.
            const bytes = await response.clone().arrayBuffer();
            byteLength = bytes.byteLength;
            received = true;
            await pending;
            return response;
        };
    });
}

// Preserve compositor captures and traces without competing with software rendering for video.
test.use({ video: 'off' });

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`Soft Matter shows all three material responses and survives interaction and lifecycle @${backend}`, async ({
        page
    }, testInfo) => {
        test.setTimeout(240_000);
        const production = testInfo.project.name === 'chromium-native-webgpu';
        const viewport = production ? { width: 1440, height: 900 } : { width: 960, height: 600 };
        await page.setViewportSize(viewport);
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        await requirePhysicalAdapter(page, backend, production);
        try {
            const query = new URLSearchParams({
                backend,
                test: '1',
                quality: production ? 'production' : 'portable'
            });
            await page.goto(`/examples/mat1_soft_matter.html?${query.toString()}`);
            await page.waitForFunction(
                () =>
                    (window as SoftMatterWindow).__HILO_SOFT_MATTER__?.ready === true ||
                    document.body.dataset['failure'] === 'true',
                undefined,
                { timeout: 120_000 }
            );
            await expect(page.locator('body')).toHaveAttribute('data-failure', 'false');
            const canvas = page.locator('canvas[data-hilo3d-backend]');
            await expect(canvas).toHaveAttribute('data-hilo3d-backend', backend);
            await waitForLiveFrames(page, backend);
            await attachImage(
                testInfo,
                'soft-matter-gallery',
                await captureStableFrame(page, backend)
            );

            const differences: {
                feature: SurfaceFeature;
                disabled: PixelDifference;
                restored: PixelDifference;
            }[] = [];
            let enabled = await captureScene(page, backend);
            for (const feature of ['sheen', 'thin', 'sss'] as const) {
                const button = page.locator(`[data-feature="${feature}"]`);
                await expect(button).toHaveAttribute('aria-pressed', 'true');
                await button.click();
                await expect(button).toHaveAttribute('aria-pressed', 'false');
                const disabled = await captureScene(page, backend);
                const delta = pixelDifference(enabled, disabled, FEATURE_REGIONS[feature]);
                await attachImage(testInfo, `soft-matter-${feature}-enabled`, enabled);
                await attachImage(testInfo, `soft-matter-${feature}-disabled`, disabled);
                // Require a visible surface area, beyond edge jitter or isolated highlight pixels.
                expect(delta.changedRatio, `${feature} changed sculpture area`).toBeGreaterThan(
                    0.05
                );
                expect(delta.meanRGB, `${feature} mean RGB response`).toBeGreaterThan(1);
                await button.click();
                await expect(button).toHaveAttribute('aria-pressed', 'true');
                const restored = await captureScene(page, backend);
                const restoreDelta = pixelDifference(enabled, restored, FEATURE_REGIONS[feature]);
                expect(restoreDelta.meanRGB, `${feature} restored response`).toBeLessThan(
                    delta.meanRGB * 0.5
                );
                differences.push({ feature, disabled: delta, restored: restoreDelta });
                // Every feature is enabled again, with the same gallery view and TAA phase.
                // This freshly rendered restoration is also the next feature's valid baseline.
                enabled = restored;
            }
            await testInfo.attach('soft-matter-material-differences', {
                body: Buffer.from(JSON.stringify(differences, null, 2)),
                contentType: 'application/json'
            });
            await waitForLiveFrames(page, backend);

            await page.locator('#compare').click();
            await expect(page.locator('#compare')).toHaveAttribute('aria-pressed', 'true');
            for (const feature of ['sheen', 'thin', 'sss'] as const)
                await expect(page.locator(`[data-feature="${feature}"]`)).toHaveAttribute(
                    'aria-pressed',
                    'false'
                );
            await waitForLiveFrames(page, backend);
            await page.locator('#reset').click();
            await expect(page.locator('#compare')).toHaveAttribute('aria-pressed', 'false');
            for (const feature of ['sheen', 'thin', 'sss'] as const)
                await expect(page.locator(`[data-feature="${feature}"]`)).toHaveAttribute(
                    'aria-pressed',
                    'true'
                );
            await waitForLiveFrames(page, backend);

            const beforeOrbit = await cameraPosition(page);
            await page.mouse.move(viewport.width * 0.5, viewport.height * 0.46);
            await page.mouse.down();
            await page.mouse.move(viewport.width * 0.58, viewport.height * 0.42, { steps: 8 });
            await page.mouse.up();
            await waitForLiveFrames(page, backend);
            const afterOrbit = await cameraPosition(page);
            expect(afterOrbit).not.toEqual(beforeOrbit);
            await page.mouse.wheel(0, 120);
            await waitForLiveFrames(page, backend);
            expect(await cameraPosition(page)).not.toEqual(afterOrbit);
            for (const view of ['velvet', 'petal', 'wax', 'gallery'] as const) {
                const previous = await cameraPosition(page);
                await page.locator(`[data-view="${view}"]`).click();
                await waitForLiveFrames(page, backend);
                expect(await cameraPosition(page)).not.toEqual(previous);
            }
            const beforeResize = await canvas.evaluate(element => {
                if (!(element instanceof HTMLCanvasElement))
                    throw new Error('Missing scene canvas');
                return [element.width, element.height];
            });
            await page.setViewportSize({
                width: viewport.width - 160,
                height: viewport.height + 40
            });
            await waitForLiveFrames(page, backend);
            const afterResize = await canvas.evaluate(element => {
                if (!(element instanceof HTMLCanvasElement))
                    throw new Error('Missing scene canvas');
                return [element.width, element.height];
            });
            expect(afterResize).not.toEqual(beforeResize);
            expect(afterResize[0]).toBeGreaterThan(0);
            expect(afterResize[1]).toBeGreaterThan(0);
            await attachImage(testInfo, 'soft-matter-resized', await captureScene(page, backend));
            await waitForLiveFrames(page, backend);

            await page.evaluate(() => {
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
            });
            await awaitTrackedGPUQueues(page);
            const retained = await page.evaluate(() => {
                const api = (window as SoftMatterWindow).__HILO_SOFT_MATTER__;
                if (!api) throw new Error('Missing retained Soft Matter runtime');
                return { retained: api.retained, disposed: api.disposed, frame: api.frame };
            });
            expect(retained.retained).toBe(true);
            expect(retained.disposed).toBe(false);
            // Cover the shared capture control's pending 50ms backpressure continuation.
            await page.waitForTimeout(150);
            expect(
                await page.evaluate(() => (window as SoftMatterWindow).__HILO_SOFT_MATTER__?.frame)
            ).toBe(retained.frame);
            await page.evaluate(() => {
                window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            });
            await waitForLiveFrames(page, backend);
            expect(
                await page.evaluate(
                    () => (window as SoftMatterWindow).__HILO_SOFT_MATTER__?.retained
                )
            ).toBe(false);
            await assertRenderHealth(page, backend);

            await page.evaluate(() => {
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
            });
            await page.waitForFunction(
                () => (window as SoftMatterWindow).__HILO_SOFT_MATTER__?.disposed === true
            );
            await page.evaluate(async () => {
                await (window as SoftMatterWindow).__HILO_SOFT_MATTER__?.dispose();
            });
            await assertRenderHealth(page, backend);
            const finalFrame = await page.evaluate(
                () => (window as SoftMatterWindow).__HILO_SOFT_MATTER__?.frame
            );
            await page.waitForTimeout(150);
            expect(
                await page.evaluate(() => (window as SoftMatterWindow).__HILO_SOFT_MATTER__?.frame)
            ).toBe(finalFrame);
            failures.assertEmpty(`Soft Matter ${backend}, including post-teardown observation`);
        } finally {
            if (!page.isClosed()) {
                await page.evaluate(async () => {
                    await (window as SoftMatterWindow).__HILO_SOFT_MATTER__?.dispose();
                });
            }
            await failures.dispose();
        }
    });

    test(`Soft Matter cancels initialization before a late model response @${backend}`, async ({
        page
    }, testInfo) => {
        test.setTimeout(60_000);
        await page.setViewportSize({ width: 960, height: 600 });
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        await requirePhysicalAdapter(
            page,
            backend,
            testInfo.project.name === 'chromium-native-webgpu'
        );
        await holdModelResponse(page);
        try {
            await page.goto(`/examples/mat1_soft_matter.html?backend=${backend}&test=1`);
            await page.waitForFunction(
                () =>
                    (window as GatedSoftMatterWindow).__HILO_SOFT_MATTER_MODEL_GATE__?.received ===
                        true || document.body.dataset['failure'] === 'true'
            );
            await expect(page.locator('body')).toHaveAttribute('data-failure', 'false');
            const loading = await page.evaluate(() => {
                const current = window as GatedSoftMatterWindow;
                const api = current.__HILO_SOFT_MATTER__;
                const gate = current.__HILO_SOFT_MATTER_MODEL_GATE__;
                if (!api || !gate) throw new Error('Soft Matter loading response gate unavailable');
                return {
                    ready: api.ready,
                    disposed: api.disposed,
                    frame: api.frame,
                    received: gate.received,
                    byteLength: gate.byteLength
                };
            });
            expect(loading).toMatchObject({
                ready: false,
                disposed: false,
                frame: 0,
                received: true
            });
            expect(loading.byteLength).toBeGreaterThan(1000);
            const beforeCancellation = nativeRenderProgress(await readRenderHealth(page), backend);
            expect(beforeCancellation.drawCalls).toBe(0);
            await page.evaluate(() => {
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
            });
            await expect(page.locator('body')).toHaveAttribute('data-disposed', 'true');
            await page.evaluate(async () => {
                const current = window as GatedSoftMatterWindow;
                current.__HILO_SOFT_MATTER_MODEL_GATE__?.release();
                await current.__HILO_SOFT_MATTER__?.dispose();
            });
            const disposedState = await page.evaluate(() => {
                const current = window as SoftMatterWindow;
                const api = current.__HILO_SOFT_MATTER__;
                if (!api) throw new Error('Soft Matter lost its disposal evidence');
                return {
                    ready: api.ready,
                    disposed: api.disposed,
                    frame: api.frame,
                    capturePresent: current.__HILO3D_TEST_CAPTURE__ !== undefined
                };
            });
            expect(disposedState).toEqual({
                ready: false,
                disposed: true,
                frame: 0,
                capturePresent: false
            });
            await page.evaluate(() => {
                window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            });
            await page.waitForTimeout(150);
            await assertRenderHealth(page, backend);
            expect(nativeRenderProgress(await readRenderHealth(page), backend)).toEqual(
                beforeCancellation
            );
            expect(
                await page.evaluate(() => (window as SoftMatterWindow).__HILO_SOFT_MATTER__?.frame)
            ).toBe(0);
            await expect(page.locator('body')).toHaveAttribute('data-ready', 'false');
            failures.assertEmpty(`Soft Matter ${backend} initialization cancellation`);
        } finally {
            if (!page.isClosed()) {
                await page.evaluate(async () => {
                    const current = window as GatedSoftMatterWindow;
                    current.__HILO_SOFT_MATTER_MODEL_GATE__?.release();
                    await current.__HILO_SOFT_MATTER__?.dispose();
                });
            }
            await failures.dispose();
        }
    });
}
