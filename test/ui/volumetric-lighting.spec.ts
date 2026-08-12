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

test('renders stable, visually material froxel lighting in Neon Reliquary', async ({ page }) => {
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
        `${examplesOrigin}/examples/volumetric_neon_reliquary.html?backend=webgpu&test=1`,
        { waitUntil: 'load' }
    );
    await expect(page.locator('body')).toHaveAttribute('data-volumetric-ready', 'true', {
        timeout: 60_000
    });
    const evidence = await page.evaluate(() => window.__HILO3D_VOLUMETRIC_RELIQUARY_RESULT__);
    expect(evidence).toMatchObject({
        backend: 'webgpu',
        volumetricLighting: true,
        historyUsed: true,
        clusterOverflowCount: 0,
        localVolumeCount: 7,
        heroAsset: 'Khronos Sponza'
    });
    expect(evidence?.froxelCount).toBeGreaterThan(128);
    expect(evidence?.froxelCount).toBeLessThan(1_000);

    const canvas = page.locator('canvas');
    await page.evaluate(async () => {
        await window.__HILO3D_VOLUMETRIC_RELIQUARY_TEST_API__?.settle(8);
    });
    const converged = await canvas.screenshot({ animations: 'disabled' });
    await page.evaluate(async () => {
        await window.__HILO3D_VOLUMETRIC_RELIQUARY_TEST_API__?.settle(1);
    });
    const nextStaticFrame = await canvas.screenshot({ animations: 'disabled' });
    const stability = pixelDifference(converged, nextStaticFrame);
    expect(stability.changedRatio).toBeLessThan(0.08);
    expect(stability.meanChannelDelta).toBeLessThan(2.5);

    await page.goto(
        `${examplesOrigin}/examples/volumetric_neon_reliquary.html?backend=webgpu&test=1&volume=false`,
        { waitUntil: 'load' }
    );
    await expect(page.locator('body')).toHaveAttribute('data-volumetric-ready', 'true', {
        timeout: 60_000
    });
    const disabledEvidence = await page.evaluate(
        () => window.__HILO3D_VOLUMETRIC_RELIQUARY_RESULT__
    );
    expect(disabledEvidence).toMatchObject({
        volumetricLighting: false,
        froxelCount: 0,
        historyUsed: false
    });
    const directLightingOnly = await page.locator('canvas').screenshot({
        animations: 'disabled'
    });
    const volumetricContribution = pixelDifference(directLightingOnly, converged);
    expect(volumetricContribution.changedRatio).toBeGreaterThan(0.06);
    expect(volumetricContribution.meanChannelDelta).toBeGreaterThan(1.5);

    await devtools.detach();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(gpuValidationErrors).toEqual([]);
});

declare global {
    interface Window {
        __HILO3D_VOLUMETRIC_RELIQUARY_RESULT__?: {
            readonly backend: 'webgpu';
            readonly volumetricLighting: boolean;
            readonly froxelCount: number;
            readonly historyUsed: boolean;
            readonly clusterOverflowCount: number;
            readonly localVolumeCount: 7;
            readonly heroAsset: 'Khronos Sponza';
        };
        __HILO3D_VOLUMETRIC_RELIQUARY_TEST_API__?: {
            settle(frames?: number): Promise<void>;
        };
    }
}
