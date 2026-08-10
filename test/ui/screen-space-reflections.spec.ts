import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

interface PixelDifference {
    readonly changedRatio: number;
    readonly meanChannelDelta: number;
}

function pixelDifference(referenceBuffer: Buffer, candidateBuffer: Buffer): PixelDifference {
    const reference = PNG.sync.read(referenceBuffer);
    const candidate = PNG.sync.read(candidateBuffer);
    expect(candidate.width).toBe(reference.width);
    expect(candidate.height).toBe(reference.height);
    let changed = 0;
    let totalDelta = 0;
    const pixelCount = reference.width * reference.height;
    for (let offset = 0; offset < reference.data.length; offset += 4) {
        const red = Math.abs((reference.data[offset] ?? 0) - (candidate.data[offset] ?? 0));
        const green = Math.abs(
            (reference.data[offset + 1] ?? 0) - (candidate.data[offset + 1] ?? 0)
        );
        const blue = Math.abs(
            (reference.data[offset + 2] ?? 0) - (candidate.data[offset + 2] ?? 0)
        );
        totalDelta += red + green + blue;
        if (Math.max(red, green, blue) > 5) changed++;
    }
    return {
        changedRatio: changed / pixelCount,
        meanChannelDelta: totalDelta / (pixelCount * 3)
    };
}

test('renders a stable and visually material SSR contribution in Nocturne Pavilion', async ({
    page
}) => {
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const gpuValidationErrors: string[] = [];
    const devtools = await page.context().newCDPSession(page);
    await devtools.send('Log.enable');
    devtools.on('Log.entryAdded', ({ entry }) => {
        if (entry.level === 'error' && entry.source === 'rendering') {
            gpuValidationErrors.push(entry.text);
        }
    });
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.setViewportSize({ width: 960, height: 600 });
    const examplesOrigin = process.env['HILO3D_EXAMPLES_ORIGIN'] ?? '';
    await page.goto(
        `${examplesOrigin}/examples/screen_space_reflections_palace.html?backend=webgpu&test=1`,
        { waitUntil: 'load' }
    );
    await expect(page.locator('body')).toHaveAttribute('data-ssr-ready', 'true', {
        timeout: 60_000
    });
    const evidence = await page.evaluate(() => window.__HILO3D_SSR_PALACE_RESULT__);
    expect(evidence).toMatchObject({
        backend: 'webgpu',
        hiZValid: true,
        screenSpaceReflections: true,
        temporalAA: true,
        roughnessTiers: 3,
        heroAsset: 'Khronos Car Concept'
    });
    expect(evidence?.objectCount).toBeGreaterThan(50);
    expect(evidence?.fallbackObjectCount).toBeGreaterThan(0);
    expect(evidence?.visibleObjectCount).toBeGreaterThan(0);

    const canvas = page.locator('canvas');
    await page.evaluate(async () => {
        await window.__HILO3D_SSR_PALACE_TEST_API__?.settle(8);
    });
    const reflected = await canvas.screenshot({ animations: 'disabled' });
    await page.evaluate(async () => {
        await window.__HILO3D_SSR_PALACE_TEST_API__?.settle(1);
    });
    const nextStaticFrame = await canvas.screenshot({ animations: 'disabled' });
    const stability = pixelDifference(reflected, nextStaticFrame);
    expect(stability.changedRatio).toBeLessThan(0.16);
    expect(stability.meanChannelDelta).toBeLessThan(3.5);

    await page.goto(
        `${examplesOrigin}/examples/screen_space_reflections_palace.html?backend=webgpu&test=1&ssr=false`,
        { waitUntil: 'load' }
    );
    await expect(page.locator('body')).toHaveAttribute('data-ssr-ready', 'true', {
        timeout: 60_000
    });
    const disabledEvidence = await page.evaluate(() => window.__HILO3D_SSR_PALACE_RESULT__);
    expect(disabledEvidence?.screenSpaceReflections).toBe(false);
    await page.evaluate(async () => {
        await window.__HILO3D_SSR_PALACE_TEST_API__?.settle(8);
    });
    const directLightingOnly = await page.locator('canvas').screenshot({
        animations: 'disabled'
    });
    const reflectionContribution = pixelDifference(directLightingOnly, reflected);
    expect(reflectionContribution.changedRatio).toBeGreaterThan(0.02);
    expect(reflectionContribution.meanChannelDelta).toBeGreaterThan(0.35);

    await devtools.detach();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(gpuValidationErrors).toEqual([]);
});

declare global {
    interface Window {
        __HILO3D_SSR_PALACE_RESULT__?: {
            readonly backend: 'webgpu';
            readonly objectCount: number;
            readonly fallbackObjectCount: number;
            readonly visibleObjectCount: number;
            readonly hiZValid: boolean;
            readonly screenSpaceReflections: boolean;
            readonly temporalAA: true;
            readonly roughnessTiers: 3;
            readonly heroAsset: 'Khronos Car Concept';
        };
        __HILO3D_SSR_PALACE_TEST_API__?: {
            settle(frames?: number): Promise<void>;
            advance(frames?: number): Promise<void>;
        };
    }
}
