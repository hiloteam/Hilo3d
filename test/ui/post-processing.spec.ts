import { expect, test, type Page } from '@playwright/test';
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
