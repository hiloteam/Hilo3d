import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import type { MAT1MaterialAcceptance } from './fixtures/mat1-materials';
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

type FixtureWindow = Window & { __HILO_MAT1__?: MAT1MaterialAcceptance };

function imageDifference(first: Buffer, second: Buffer): number {
    const a = PNG.sync.read(first);
    const b = PNG.sync.read(second);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    let difference = 0;
    for (let offset = 0; offset < a.data.length; offset += 4) {
        for (let channel = 0; channel < 3; channel++) {
            difference += Math.abs(
                (a.data[offset + channel] ?? 0) - (b.data[offset + channel] ?? 0)
            );
        }
    }
    return difference;
}

test.use({ video: 'off' });
for (const [backend, clustered] of [
    ['webgl2', false],
    ['webgpu', false],
    ['webgpu', true]
] as const) {
    test(`MAT1 surfaces compose, resize and interact on ${backend} ${clustered ? 'clustered' : 'forward'} @${backend}`, async ({
        page
    }, testInfo) => {
        test.setTimeout(120_000);
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        if (testInfo.project.name === 'chromium-native-webgpu' && backend === 'webgpu') {
            await page.addInitScript(() => {
                // The explicit teardown navigation has no WebGPU surface to validate.
                if (location.href === 'about:blank') return;
                const original = navigator.gpu.requestAdapter.bind(navigator.gpu);
                navigator.gpu.requestAdapter = async options => {
                    const adapter = await original(options);
                    if (adapter?.info.isFallbackAdapter !== false) {
                        throw new Error('Physical MAT1 acceptance requires a non-fallback adapter');
                    }
                    return adapter;
                };
            });
        }
        try {
            const quality =
                testInfo.project.name === 'chromium-native-webgpu' ? 'production' : 'portable';
            await page.goto(
                `/test/ui/fixtures/mat1-materials.html?backend=${backend}&clustered=${clustered ? '1' : '0'}&quality=${quality}`
            );
            await page.waitForFunction(
                () =>
                    (window as FixtureWindow).__HILO_MAT1__ !== undefined ||
                    document.body.dataset['failure'] !== undefined
            );
            expect(await page.locator('body').getAttribute('data-failure')).toBeNull();
            const canvas = page.locator('canvas');
            const initial = await canvas.screenshot({
                path: testInfo.outputPath('mat1-initial.png')
            });
            for (const feature of ['sheen', 'thin', 'sss'] as const) {
                const button = page.locator(`[data-feature="${feature}"]`);
                const progress = nativeRenderProgress(await readRenderHealth(page), backend);
                await button.click();
                await expect(button).toHaveAttribute('aria-pressed', 'false');
                await page.evaluate(async () => {
                    await (window as FixtureWindow).__HILO_MAT1__?.settle();
                });
                const disabled = await canvas.screenshot({
                    path: testInfo.outputPath(`mat1-${feature}-disabled.png`)
                });
                expect(imageDifference(initial, disabled)).toBeGreaterThan(1000);
                expect(
                    nativeRenderProgressAdvanced(
                        progress,
                        nativeRenderProgress(await readRenderHealth(page), backend),
                        backend
                    )
                ).toBe(true);
                await button.click();
                await page.evaluate(async () => {
                    await (window as FixtureWindow).__HILO_MAT1__?.settle();
                });
            }
            await page.evaluate(async () => {
                await (window as FixtureWindow).__HILO_MAT1__?.resize(480, 240);
                await (window as FixtureWindow).__HILO_MAT1__?.orbit();
            });
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '240');
            await canvas.screenshot({ path: testInfo.outputPath('mat1-resized-orbit.png') });
            if (quality === 'production' && backend === 'webgpu') {
                const beforeHD = nativeRenderProgress(await readRenderHealth(page), backend);
                await page.setViewportSize({ width: 2000, height: 1280 });
                await page.evaluate(async () => {
                    await (window as FixtureWindow).__HILO_MAT1__?.resize(1920, 1080);
                });
                await expect(canvas).toHaveAttribute('width', '1920');
                await expect(canvas).toHaveAttribute('height', '1080');
                const hd = PNG.sync.read(
                    await canvas.screenshot({ path: testInfo.outputPath('mat1-native-1080p.png') })
                );
                expect([hd.width, hd.height]).toEqual([1920, 1080]);
                let redPixels = 0;
                let greenPixels = 0;
                for (let offset = 0; offset < hd.data.length; offset += 4) {
                    const red = hd.data[offset] ?? 0;
                    const green = hd.data[offset + 1] ?? 0;
                    const blue = hd.data[offset + 2] ?? 0;
                    if (red > green + 20 && red > blue + 20) redPixels++;
                    if (green > red + 20 && green > blue + 20) greenPixels++;
                }
                expect(redPixels).toBeGreaterThan(1000);
                expect(greenPixels).toBeGreaterThan(1000);
                expect(
                    nativeRenderProgressAdvanced(
                        beforeHD,
                        nativeRenderProgress(await readRenderHealth(page), backend),
                        backend
                    )
                ).toBe(true);
            }
            await assertStableInstrumentationHealth(backend, `MAT1 ${backend} rendering health`, {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            });
            await page.evaluate(async () => {
                await (window as FixtureWindow).__HILO_MAT1__?.dispose();
            });
            await waitForStableAnimationFrames(page);
            failures.assertEmpty(`MAT1 ${backend} lifecycle`);
            await page.goto('about:blank');
            failures.assertEmpty(`MAT1 ${backend} post-teardown`);
        } finally {
            await failures.dispose();
        }
    });
}
