import { expect, test } from '@playwright/test';

test('keeps the 100k static + 10k dynamic GPU Scene scale contract GPU-only', async ({ page }) => {
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

    await page.goto('/test/ui/fixtures/clustered-forward-plus-scale.html', {
        waitUntil: 'load'
    });
    await page.waitForFunction(
        () => window.__HILO3D_CLUSTERED_FORWARD_PLUS_SCALE_RESULT__ !== undefined,
        undefined,
        { timeout: 110_000 }
    );
    const result = await page.evaluate(() => window.__HILO3D_CLUSTERED_FORWARD_PLUS_SCALE_RESULT__);
    await devtools.detach();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(gpuValidationErrors).toEqual([]);
    expect(result).toMatchObject({
        objectCount: 110_000,
        fallbackObjectCount: 0,
        lightCount: 256,
        droppedLightCount: 0,
        clusterOverflowCount: 0,
        hiZValid: true,
        recoveryDeviceChanged: true,
        recoveredObjectCount: 110_000,
        recoveredFallbackObjectCount: 0
    });
    expect(result?.visibleObjectCount).toBeGreaterThan(0);
    expect(result?.cpuFrameRecordMilliseconds).toHaveLength(5);
    expect(
        result?.cpuFrameRecordMilliseconds.every(value => Number.isFinite(value) && value >= 0)
    ).toBe(true);
    expect(result?.gpuBatchCompletionMilliseconds).toHaveLength(2);
    expect(
        result?.gpuBatchCompletionMilliseconds.every(value => Number.isFinite(value) && value > 0)
    ).toBe(true);
});

declare global {
    interface Window {
        __HILO3D_CLUSTERED_FORWARD_PLUS_SCALE_RESULT__?: {
            readonly objectCount: number;
            readonly fallbackObjectCount: number;
            readonly lightCount: number;
            readonly droppedLightCount: number;
            readonly visibleObjectCount: number;
            readonly clusterOverflowCount: number;
            readonly hiZValid: boolean;
            readonly cpuFrameRecordMilliseconds: readonly number[];
            readonly gpuBatchCompletionMilliseconds: readonly number[];
            readonly recoveryDeviceChanged: boolean;
            readonly recoveredObjectCount: number;
            readonly recoveredFallbackObjectCount: number;
        };
    }
}
