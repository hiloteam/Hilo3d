import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { ExampleBackend } from './example-paths';
import { installPageFailureMonitor } from './page-failure-monitor';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    installRenderHealthProbe,
    nativeRenderProgress,
    nativeRenderProgressAdvanced,
    readRenderHealth,
    waitForStableAnimationFrames,
    type NativeRenderProgress
} from './render-health';

const backends = ['webgl2', 'webgpu'] as const;

interface PixelDifference {
    readonly changedPixelCount: number;
    readonly darkenedPixelCount: number;
    readonly meanChannelDelta: number;
    readonly pixelCount: number;
}

function compareCanvasPixels(enabledPng: Buffer, disabledPng: Buffer): PixelDifference {
    const enabled = PNG.sync.read(enabledPng);
    const disabled = PNG.sync.read(disabledPng);
    expect([enabled.width, enabled.height]).toEqual([disabled.width, disabled.height]);
    let changedPixelCount = 0;
    let darkenedPixelCount = 0;
    let channelDelta = 0;
    const pixelCount = enabled.width * enabled.height;
    for (let offset = 0; offset < enabled.data.length; offset += 4) {
        const enabledLuminance =
            (enabled.data[offset] ?? 0) * 0.2126 +
            (enabled.data[offset + 1] ?? 0) * 0.7152 +
            (enabled.data[offset + 2] ?? 0) * 0.0722;
        const disabledLuminance =
            (disabled.data[offset] ?? 0) * 0.2126 +
            (disabled.data[offset + 1] ?? 0) * 0.7152 +
            (disabled.data[offset + 2] ?? 0) * 0.0722;
        const difference = Math.abs(enabledLuminance - disabledLuminance);
        channelDelta += difference;
        if (difference >= 2) changedPixelCount++;
        if (disabledLuminance - enabledLuminance >= 2) darkenedPixelCount++;
    }
    return {
        changedPixelCount,
        darkenedPixelCount,
        meanChannelDelta: channelDelta / pixelCount,
        pixelCount
    };
}

async function currentProgress(page: Page, backend: ExampleBackend): Promise<NativeRenderProgress> {
    return nativeRenderProgress(await readRenderHealth(page), backend);
}

async function expectActionProgress(
    page: Page,
    backend: ExampleBackend,
    before: NativeRenderProgress,
    context: string
): Promise<void> {
    await expect
        .poll(
            async () =>
                nativeRenderProgressAdvanced(before, await currentProgress(page, backend), backend),
            { message: context, timeout: 15_000 }
        )
        .toBe(true);
}

async function assertFinalGraphicsHealth(
    page: Page,
    backend: ExampleBackend,
    context: string
): Promise<void> {
    await assertStableInstrumentationHealth(backend, context, {
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });
}

for (const backend of backends) {
    test(`GTAO produces stable non-black contact visibility on ${backend} @${backend}`, async ({
        page
    }) => {
        test.setTimeout(60_000);
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            const canvasSelector = `canvas[data-hilo3d-backend="${backend}"]`;
            await page.goto(
                `/examples/ground_truth_ambient_occlusion.html?backend=${backend}&test=1&gtao=true`,
                { waitUntil: 'networkidle' }
            );
            await expect(page.locator('body')).toHaveAttribute('data-gtao-phase', 'ready');
            const enabledCanvas = page.locator(canvasSelector);
            await expect(enabledCanvas).toBeVisible();
            await waitForStableAnimationFrames(page);
            await awaitTrackedGPUQueues(page);
            const enabled = await enabledCanvas.screenshot({ type: 'png' });
            await assertFinalGraphicsHealth(page, backend, `GTAO enabled health on ${backend}`);

            await page.goto('about:blank');
            await page.waitForTimeout(500);
            await page.goto(
                `/examples/ground_truth_ambient_occlusion.html?backend=${backend}&test=1&gtao=false`,
                { waitUntil: 'networkidle' }
            );
            await expect(page.locator('body')).toHaveAttribute('data-gtao-phase', 'ready');
            const disabledCanvas = page.locator(canvasSelector);
            await expect(disabledCanvas).toBeVisible();
            await waitForStableAnimationFrames(page);
            await awaitTrackedGPUQueues(page);
            const disabled = await disabledCanvas.screenshot({ type: 'png' });
            await assertFinalGraphicsHealth(page, backend, `GTAO disabled health on ${backend}`);

            const difference = compareCanvasPixels(enabled, disabled);
            expect(difference.changedPixelCount).toBeGreaterThan(difference.pixelCount * 0.01);
            expect(difference.darkenedPixelCount).toBeGreaterThan(difference.pixelCount * 0.004);
            expect(difference.meanChannelDelta).toBeGreaterThan(0.2);

            await page.goto('about:blank');
            failures.assertEmpty(`GTAO browser failures on ${backend}`);
        } finally {
            await failures.dispose();
        }
    });

    test(`fullscreen render-target copy preserves row orientation on ${backend} @${backend}`, async ({
        page
    }) => {
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(`/test/ui/fixtures/fullscreen-orientation.html?backend=${backend}`, {
                waitUntil: 'networkidle'
            });
            await expect(page.locator('body')).toHaveAttribute(
                'data-fullscreen-orientation-complete',
                'true'
            );
            const result = await page.evaluate(
                () => window.__HILO3D_FULLSCREEN_ORIENTATION_RESULT__
            );
            expect(result?.backend).toBe(backend);
            expect(result?.source).toEqual(result?.copied);
            expect(result?.source.slice(0, 16)).toEqual([
                0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255
            ]);
            expect(result?.source.slice(-16)).toEqual([
                255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255
            ]);
            expect(result?.managed2D.slice(0, 16)).toEqual([
                255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255
            ]);
            expect(result?.managed2D.slice(-16)).toEqual([
                0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 0, 255, 255, 255, 0, 255
            ]);
            expect(result?.managedCube.slice(0, 16)).toEqual([
                255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255
            ]);
            expect(result?.managedCube.slice(-16)).toEqual([
                0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255
            ]);
            await assertFinalGraphicsHealth(
                page,
                backend,
                `fullscreen orientation graphics errors on ${backend}`
            );

            await page.goto('about:blank');
            failures.assertEmpty(`fullscreen orientation failures on ${backend}`);
        } finally {
            await failures.dispose();
        }
    });

    test(`shadow atlas preserves projected row orientation on ${backend} @${backend}`, async ({
        page
    }) => {
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(`/test/ui/fixtures/shadow-orientation.html?backend=${backend}`, {
                waitUntil: 'networkidle'
            });
            await expect(page.locator('body')).toHaveAttribute(
                'data-shadow-orientation-complete',
                'true'
            );
            const result = await page.evaluate(() => {
                const diagnostics = window.__HILO3D_SHADOW_ORIENTATION_RESULT__;
                if (!diagnostics) throw new Error('Shadow orientation diagnostics are unavailable');
                return {
                    backend: diagnostics.backend,
                    cascadeCount: diagnostics.cascadeCount,
                    shadowAtlasSize: diagnostics.shadowAtlasSize,
                    summary: diagnostics.summaries.find(entry => entry.threshold === 80)
                };
            });

            expect(result.backend).toBe(backend);
            expect(result.cascadeCount).toBe(4);
            expect(result.shadowAtlasSize).toEqual([1536, 1024]);
            expect(result.summary?.count).toBeGreaterThan(250);
            expect(result.summary?.centroid?.[0]).toBeGreaterThan(30);
            expect(result.summary?.centroid?.[0]).toBeLessThan(45);
            expect(result.summary?.centroid?.[1]).toBeGreaterThan(38);
            expect(result.summary?.centroid?.[1]).toBeLessThan(48);
            expect(result.summary?.bounds?.[0]).toBeLessThan(20);
            expect(result.summary?.bounds?.[2]).toBeGreaterThan(65);
            await assertFinalGraphicsHealth(
                page,
                backend,
                `shadow atlas orientation graphics errors on ${backend}`
            );

            await page.goto('about:blank');
            failures.assertEmpty(`shadow atlas orientation failures on ${backend}`);
        } finally {
            await failures.dispose();
        }
    });

    test(`life-game ping-pong accepts public texture updates through ${backend} @${backend}`, async ({
        page
    }) => {
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(`/examples/lifegame.html?backend=${backend}`, {
                waitUntil: 'networkidle'
            });
            const canvas = page.locator(`canvas[data-hilo3d-backend="${backend}"]`);
            await expect(canvas).toBeVisible();
            const before = await currentProgress(page, backend);

            await canvas.click({ position: { x: 24, y: 24 } });
            await page.waitForFunction(
                () => window.__HILO3D_LIFE_GAME_INTERACTION_RESULT__?.sequence === 1
            );
            const result = await page.evaluate(
                () => window.__HILO3D_LIFE_GAME_INTERACTION_RESULT__
            );
            expect(result).toMatchObject({ backend, sequence: 1 });
            expect(result?.beforeHash).not.toBe(result?.afterHash);
            expect(result?.changedPixelCount).toBeGreaterThan(0);
            expect(result?.injectedPixelCount).toBeGreaterThan(0);
            await expectActionProgress(
                page,
                backend,
                before,
                `life-game click must issue a new native ${backend} draw${backend === 'webgpu' ? ' and queue submission' : ''}`
            );
            await assertFinalGraphicsHealth(
                page,
                backend,
                `life-game interaction graphics errors on ${backend}`
            );

            await page.goto('about:blank');
            failures.assertEmpty(`life-game interaction failures on ${backend}`);
        } finally {
            await failures.dispose();
        }
    });

    test(`post-process kernel can change while rendering through ${backend} @${backend}`, async ({
        page
    }) => {
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(`/examples/post_process.html?backend=${backend}`, {
                waitUntil: 'networkidle'
            });
            const canvas = page.locator(`canvas[data-hilo3d-backend="${backend}"]`);
            const kernel = page.locator('#kernelSelect');
            await expect(canvas).toBeVisible();
            const before = await currentProgress(page, backend);

            await kernel.selectOption('gaussianBlur');
            await page.waitForFunction(
                () => window.__HILO3D_POST_PROCESS_INTERACTION_RESULT__?.sequence === 1
            );
            const result = await page.evaluate(
                () => window.__HILO3D_POST_PROCESS_INTERACTION_RESULT__
            );
            expect(result).toMatchObject({
                backend,
                sequence: 1,
                previousKernel: 'edgeDetect6',
                currentKernel: 'gaussianBlur'
            });
            expect(result?.beforeHash).not.toBe(result?.afterHash);
            expect(result?.changedPixelCount).toBeGreaterThan(0);
            await expect(kernel).toHaveValue('gaussianBlur');
            await expectActionProgress(
                page,
                backend,
                before,
                `post-process kernel change must issue a new native ${backend} draw${backend === 'webgpu' ? ' and queue submission' : ''}`
            );
            await assertFinalGraphicsHealth(
                page,
                backend,
                `post-process interaction graphics errors on ${backend}`
            );

            await page.goto('about:blank');
            failures.assertEmpty(`post-process interaction failures on ${backend}`);
        } finally {
            await failures.dispose();
        }
    });
}

declare global {
    interface Window {
        __HILO3D_LIFE_GAME_INTERACTION_RESULT__?: {
            readonly backend: ExampleBackend;
            readonly sequence: number;
            readonly beforeHash: string;
            readonly afterHash: string;
            readonly changedPixelCount: number;
            readonly injectedPixelCount: number;
        };
        __HILO3D_POST_PROCESS_INTERACTION_RESULT__?: {
            readonly backend: ExampleBackend;
            readonly sequence: number;
            readonly previousKernel: string;
            readonly currentKernel: string;
            readonly beforeHash: string;
            readonly afterHash: string;
            readonly changedPixelCount: number;
        };
        __HILO3D_FULLSCREEN_ORIENTATION_RESULT__?: {
            readonly backend: ExampleBackend;
            readonly source: readonly number[];
            readonly copied: readonly number[];
            readonly managed2D: readonly number[];
            readonly managedCube: readonly number[];
        };
    }
}
