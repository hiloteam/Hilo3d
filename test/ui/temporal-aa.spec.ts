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

test('keeps the fused Clustered motion/TAAU example stable across convergence and camera cuts', async ({
    page
}) => {
    test.setTimeout(60_000);
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

    await page.setViewportSize({ width: 800, height: 500 });
    const examplesOrigin = process.env['HILO3D_EXAMPLES_ORIGIN'] ?? '';
    await page.goto(
        `${examplesOrigin}/examples/temporal_aa_observatory.html?backend=webgpu&test=1`,
        {
            waitUntil: 'load'
        }
    );
    await expect(page.locator('body')).toHaveAttribute('data-temporal-ready', 'true', {
        timeout: 45_000
    });
    const evidence = await page.evaluate(() => window.__HILO3D_TEMPORAL_OBSERVATORY_RESULT__);
    expect(evidence).toMatchObject({
        backend: 'webgpu',
        objectCount: 100,
        fallbackObjectCount: 2,
        hiZValid: true,
        temporalAA: true,
        renderScale: 0.75
    });
    expect(evidence?.visibleObjectCount).toBeGreaterThan(0);

    const canvas = page.locator('canvas');
    await page.evaluate(async () => {
        await window.__HILO3D_TEMPORAL_OBSERVATORY_TEST_API__?.settle(10);
    });
    const converged = await canvas.screenshot({ animations: 'disabled' });
    await page.evaluate(async () => {
        await window.__HILO3D_TEMPORAL_OBSERVATORY_TEST_API__?.settle(1);
    });
    const nextStatic = await canvas.screenshot({ animations: 'disabled' });
    const staticDifference = pixelDifference(converged, nextStatic);
    expect(staticDifference.changedRatio).toBeLessThan(0.035);
    expect(staticDifference.meanChannelDelta).toBeLessThan(1.5);

    await page.evaluate(async () => {
        await window.__HILO3D_TEMPORAL_OBSERVATORY_TEST_API__?.cutAndSettle(1);
    });
    const firstCutFrame = await canvas.screenshot({ animations: 'disabled' });
    expect(pixelDifference(converged, firstCutFrame).changedRatio).toBeGreaterThan(0.04);
    await page.evaluate(async () => {
        await window.__HILO3D_TEMPORAL_OBSERVATORY_TEST_API__?.settle(10);
    });
    const settledCut = await canvas.screenshot({ animations: 'disabled' });
    const cutConvergence = pixelDifference(firstCutFrame, settledCut);
    expect(cutConvergence.changedRatio).toBeLessThan(0.08);
    expect(cutConvergence.meanChannelDelta).toBeLessThan(3);

    await devtools.detach();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(gpuValidationErrors).toEqual([]);
});

declare global {
    interface Window {
        __HILO3D_TEMPORAL_OBSERVATORY_RESULT__?: {
            readonly backend: 'webgpu';
            readonly objectCount: number;
            readonly fallbackObjectCount: number;
            readonly visibleObjectCount: number;
            readonly hiZValid: boolean;
            readonly temporalAA: true;
            readonly renderScale: 0.75;
        };
        __HILO3D_TEMPORAL_OBSERVATORY_TEST_API__?: {
            settle(frames?: number): Promise<void>;
            cutAndSettle(frames?: number): Promise<void>;
            teleportAndSettle(frames?: number): Promise<void>;
        };
    }
}
