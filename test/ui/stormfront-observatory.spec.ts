import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    completedRenderCommands,
    installRenderHealthProbe,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';

interface ImageStatistics {
    readonly brightPixelRatio: number;
    readonly darkPixelRatio: number;
    readonly luminanceRange: number;
}

function imageStatistics(buffer: Buffer): ImageStatistics {
    const image = PNG.sync.read(buffer);
    let brightPixels = 0;
    let darkPixels = 0;
    let minimum = 255;
    let maximum = 0;
    const pixelCount = image.width * image.height;
    for (let offset = 0; offset < image.data.length; offset += 4) {
        const luminance =
            (image.data[offset] ?? 0) * 0.2126 +
            (image.data[offset + 1] ?? 0) * 0.7152 +
            (image.data[offset + 2] ?? 0) * 0.0722;
        if (luminance > 110) brightPixels++;
        if (luminance < 32) darkPixels++;
        minimum = Math.min(minimum, luminance);
        maximum = Math.max(maximum, luminance);
    }
    return {
        brightPixelRatio: brightPixels / pixelCount,
        darkPixelRatio: darkPixels / pixelCount,
        luminanceRange: maximum - minimum
    };
}

function differingPixelRatio(referenceBuffer: Buffer, candidateBuffer: Buffer): number {
    const reference = PNG.sync.read(referenceBuffer);
    const candidate = PNG.sync.read(candidateBuffer);
    expect(candidate.width).toBe(reference.width);
    expect(candidate.height).toBe(reference.height);
    let changedPixels = 0;
    const pixelCount = reference.width * reference.height;
    for (let offset = 0; offset < reference.data.length; offset += 4) {
        const red = Math.abs((reference.data[offset] ?? 0) - (candidate.data[offset] ?? 0));
        const green = Math.abs(
            (reference.data[offset + 1] ?? 0) - (candidate.data[offset + 1] ?? 0)
        );
        const blue = Math.abs(
            (reference.data[offset + 2] ?? 0) - (candidate.data[offset + 2] ?? 0)
        );
        if (Math.max(red, green, blue) > 5) changedPixels++;
    }
    return changedPixels / pixelCount;
}

test('Stormfront Observatory renders and interacts through the physical WebGPU stack', async ({
    page
}) => {
    test.setTimeout(150_000);
    await installRenderHealthProbe(page);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/examples/stormfront_observatory.html?backend=webgpu&test=1', {
        waitUntil: 'load'
    });
    await expect(page.locator('body')).toHaveAttribute('data-stormfront-ready', 'true', {
        timeout: 120_000
    });
    const result = await page.evaluate(() => window.__HILO3D_STORMFRONT_RESULT__);
    expect(result).toMatchObject({
        backend: 'webgpu',
        atmosphere: true,
        clouds: true,
        autoExposure: true
    });
    expect(result?.visibleObjectCount).toBeGreaterThan(20);

    const canvas = page.locator('canvas');
    await page.evaluate(async () => window.__HILO3D_STORMFRONT_TEST_API__?.settle(6));
    const hero = await canvas.screenshot({ animations: 'disabled' });
    const statistics = imageStatistics(hero);
    expect(statistics.luminanceRange).toBeGreaterThan(80);
    expect(statistics.darkPixelRatio).toBeGreaterThan(0.08);
    expect(statistics.brightPixelRatio).toBeGreaterThan(0.002);

    await page.locator('#cloudControl').evaluate(element => {
        if (!(element instanceof HTMLInputElement))
            throw new Error('Cloud control is not an input');
        element.value = '0.91';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#windControl').evaluate(element => {
        if (!(element instanceof HTMLInputElement)) throw new Error('Wind control is not an input');
        element.value = '31';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#stormControl').evaluate(element => {
        if (!(element instanceof HTMLInputElement))
            throw new Error('Storm control is not an input');
        element.value = '0.95';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#cloudOutput')).toHaveText('91%');
    await expect(page.locator('#windOutput')).toHaveText('31 m/s');
    await expect(page.locator('#stormOutput')).toHaveText('0.95');

    await page.evaluate(async () => window.__HILO3D_STORMFRONT_TEST_API__?.nextView());
    const alternateView = await canvas.screenshot({ animations: 'disabled' });
    expect(differingPixelRatio(hero, alternateView)).toBeGreaterThan(0.08);

    await waitForStableAnimationFrames(page);
    await awaitTrackedGPUQueues(page);
    const health = await readRenderHealth(page);
    expect(completedRenderCommands(health, 'webgpu')).toBeGreaterThan(0);
    await assertStableInstrumentationHealth('webgpu', 'Stormfront Observatory', {
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
});

declare global {
    interface Window {
        __HILO3D_STORMFRONT_RESULT__?: Readonly<{
            backend: 'webgpu';
            atmosphere: true;
            clouds: true;
            autoExposure: true;
            visibleObjectCount: number;
        }>;
        __HILO3D_STORMFRONT_TEST_API__?: Readonly<{
            settle(frames: number): Promise<void>;
            nextView(): Promise<void>;
        }>;
    }
}
