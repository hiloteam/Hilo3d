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

interface SanctumEvidence {
    readonly backend: 'webgpu';
    readonly movingCasters: number;
    readonly shadowRequestedPages: number;
    readonly shadowUpdatedPages: number;
    readonly shadowDeferredPages: number;
    readonly shadowResidentPages: number;
    readonly hiddenLayerEnabled: boolean;
    readonly drawCount: number;
}

declare global {
    interface Window {
        __HILO3D_SHADOW_SANCTUM_TEST_API__?: Readonly<{
            settle(frames?: number): Promise<SanctumEvidence>;
            setMotion(value: boolean): Promise<SanctumEvidence>;
            setVeil(value: boolean): Promise<SanctumEvidence>;
            nextView(): Promise<SanctumEvidence>;
        }>;
    }
}

interface ImageStatistics {
    readonly darkRatio: number;
    readonly brightRatio: number;
    readonly range: number;
}

function imageStatistics(buffer: Buffer): ImageStatistics {
    const image = PNG.sync.read(buffer);
    let dark = 0;
    let bright = 0;
    let minimum = 255;
    let maximum = 0;
    const pixelCount = image.width * image.height;
    for (let offset = 0; offset < image.data.length; offset += 4) {
        const luminance =
            (image.data[offset] ?? 0) * 0.2126 +
            (image.data[offset + 1] ?? 0) * 0.7152 +
            (image.data[offset + 2] ?? 0) * 0.0722;
        if (luminance < 28) dark++;
        if (luminance > 118) bright++;
        minimum = Math.min(minimum, luminance);
        maximum = Math.max(maximum, luminance);
    }
    return {
        darkRatio: dark / pixelCount,
        brightRatio: bright / pixelCount,
        range: maximum - minimum
    };
}

function differingPixelRatio(referenceBuffer: Buffer, candidateBuffer: Buffer): number {
    const reference = PNG.sync.read(referenceBuffer);
    const candidate = PNG.sync.read(candidateBuffer);
    expect(candidate.width).toBe(reference.width);
    expect(candidate.height).toBe(reference.height);
    let changed = 0;
    const pixelCount = reference.width * reference.height;
    for (let offset = 0; offset < reference.data.length; offset += 4) {
        const delta = Math.max(
            Math.abs((reference.data[offset] ?? 0) - (candidate.data[offset] ?? 0)),
            Math.abs((reference.data[offset + 1] ?? 0) - (candidate.data[offset + 1] ?? 0)),
            Math.abs((reference.data[offset + 2] ?? 0) - (candidate.data[offset + 2] ?? 0))
        );
        if (delta > 5) changed++;
    }
    return changed / pixelCount;
}

test('Umbra Sanctum keeps moving shadow pages budgeted and camera layers isolated @webgpu', async ({
    page
}) => {
    test.setTimeout(120_000);
    await installRenderHealthProbe(page);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.setViewportSize({ width: 960, height: 600 });
    await page.goto('/examples/shadow_residency_sanctum.html?backend=webgpu&test=1', {
        waitUntil: 'load'
    });
    await expect(page.locator('body')).toHaveAttribute('data-sanctum-ready', 'true', {
        timeout: 90_000
    });

    const moving = await page.evaluate(async () =>
        window.__HILO3D_SHADOW_SANCTUM_TEST_API__?.settle(3)
    );
    expect(moving).toMatchObject({
        backend: 'webgpu',
        movingCasters: 12,
        hiddenLayerEnabled: false
    });
    expect(moving?.shadowRequestedPages).toBeGreaterThan(32);
    expect(moving?.shadowUpdatedPages).toBeGreaterThan(0);
    expect(moving?.shadowUpdatedPages).toBeLessThanOrEqual(32);
    expect(moving?.shadowDeferredPages).toBeGreaterThan(0);
    expect(moving?.shadowResidentPages).toBeGreaterThan(32);

    await page.evaluate(async () => window.__HILO3D_SHADOW_SANCTUM_TEST_API__?.setMotion(false));
    await page.evaluate(async () => window.__HILO3D_SHADOW_SANCTUM_TEST_API__?.settle(4));
    const canvas = page.locator('canvas');
    const excluded = await canvas.screenshot({ animations: 'disabled' });
    const statistics = imageStatistics(excluded);
    expect(statistics.range).toBeGreaterThan(90);
    expect(statistics.darkRatio).toBeGreaterThan(0.12);
    expect(statistics.brightRatio).toBeGreaterThan(0.001);

    const revealedEvidence = await page.evaluate(async () =>
        window.__HILO3D_SHADOW_SANCTUM_TEST_API__?.setVeil(true)
    );
    expect(revealedEvidence).toMatchObject({ hiddenLayerEnabled: true });
    const revealed = await canvas.screenshot({ animations: 'disabled' });
    expect(differingPixelRatio(excluded, revealed)).toBeGreaterThan(0.01);

    await page.evaluate(async () => window.__HILO3D_SHADOW_SANCTUM_TEST_API__?.nextView());
    const alternate = await canvas.screenshot({ animations: 'disabled' });
    expect(differingPixelRatio(revealed, alternate)).toBeGreaterThan(0.08);

    await waitForStableAnimationFrames(page);
    await awaitTrackedGPUQueues(page);
    const health = await readRenderHealth(page);
    expect(completedRenderCommands(health, 'webgpu')).toBeGreaterThan(0);
    await assertStableInstrumentationHealth('webgpu', 'Umbra Sanctum', {
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
});
