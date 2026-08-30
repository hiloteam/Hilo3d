import { expect, test, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

interface PixelDifference {
    readonly changedRatio: number;
    readonly meanChannelDelta: number;
}

interface NormalizedPixelRegion {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

function pixelDifference(
    referenceBuffer: Buffer,
    candidateBuffer: Buffer,
    region: Readonly<NormalizedPixelRegion> = { left: 0, top: 0, right: 1, bottom: 1 }
): PixelDifference {
    const reference = PNG.sync.read(referenceBuffer);
    const candidate = PNG.sync.read(candidateBuffer);
    expect(candidate.width).toBe(reference.width);
    expect(candidate.height).toBe(reference.height);
    const left = Math.floor(reference.width * region.left);
    const top = Math.floor(reference.height * region.top);
    const right = Math.ceil(reference.width * region.right);
    const bottom = Math.ceil(reference.height * region.bottom);
    let changed = 0;
    let totalDelta = 0;
    const pixelCount = (right - left) * (bottom - top);
    for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
            const offset = (y * reference.width + x) * 4;
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
    }
    return {
        changedRatio: changed / pixelCount,
        meanChannelDelta: totalDelta / (pixelCount * 3)
    };
}

async function worstConsecutiveDifference(
    page: Page,
    canvas: Locator,
    initialFrame: Buffer,
    region: Readonly<NormalizedPixelRegion>,
    frameCount: number
): Promise<PixelDifference> {
    let previousFrame = initialFrame;
    let changedRatio = 0;
    let meanChannelDelta = 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
        await page.evaluate(async () => {
            await window.__HILO3D_SSR_PALACE_TEST_API__?.settle(1);
        });
        const staticFrame = await canvas.screenshot({ animations: 'disabled' });
        const difference = pixelDifference(previousFrame, staticFrame, region);
        changedRatio = Math.max(changedRatio, difference.changedRatio);
        meanChannelDelta = Math.max(meanChannelDelta, difference.meanChannelDelta);
        previousFrame = staticFrame;
    }
    return { changedRatio, meanChannelDelta };
}

test('renders a stable and visually material SSR contribution in Afterimage', async ({ page }) => {
    test.setTimeout(180_000);
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
        resolutionScale: 0.5,
        surfaceFinish: 'smoked lacquer',
        heroAsset: 'Khronos Car Concept'
    });
    expect(evidence?.objectCount).toBeGreaterThan(0);
    expect(evidence?.fallbackObjectCount).toBeGreaterThan(0);
    expect(evidence?.activeTileCount).toBeGreaterThan(0);
    expect(evidence?.activePixelCount).toBeGreaterThan(0);
    expect(evidence?.hitPixelCount).toBeGreaterThan(0);
    expect((evidence?.hitPixelCount ?? 0) + (evidence?.missPixelCount ?? 0)).toBe(
        evidence?.activePixelCount
    );
    expect(
        (evidence?.uncertainPixelCount ?? 0) + (evidence?.backfaceRejectedPixelCount ?? 0)
    ).toBeLessThanOrEqual(evidence?.missPixelCount ?? 0);
    expect(
        (evidence?.historyAcceptedPixelCount ?? 0) + (evidence?.historyRejectedPixelCount ?? 0)
    ).toBeGreaterThan(0);

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
    const reflectionRegion = {
        left: 0.5,
        top: 0.62,
        right: 0.88,
        bottom: 0.9
    } as const;
    const initialReflectionStability = pixelDifference(
        reflected,
        nextStaticFrame,
        reflectionRegion
    );
    const additionalReflectionStability = await worstConsecutiveDifference(
        page,
        canvas,
        nextStaticFrame,
        reflectionRegion,
        4
    );
    expect(
        Math.max(
            initialReflectionStability.changedRatio,
            additionalReflectionStability.changedRatio
        )
    ).toBeLessThan(0.075);
    expect(
        Math.max(
            initialReflectionStability.meanChannelDelta,
            additionalReflectionStability.meanChannelDelta
        )
    ).toBeLessThan(1.5);

    await page.evaluate(async () => {
        await window.__HILO3D_SSR_PALACE_TEST_API__?.setGrazingCamera();
        await window.__HILO3D_SSR_PALACE_TEST_API__?.settle(24);
    });
    const grazingReflection = await canvas.screenshot({ animations: 'disabled' });
    const grazingStability = await worstConsecutiveDifference(
        page,
        canvas,
        grazingReflection,
        { left: 0.2, top: 0.6, right: 0.92, bottom: 0.92 },
        4
    );
    expect(grazingStability.changedRatio).toBeLessThan(0.1);
    expect(grazingStability.meanChannelDelta).toBeLessThan(2);

    const defaultStochasticActivePixels = evidence?.activePixelCount ?? 0;
    const deterministicActivePixels = await page.evaluate(async () => {
        const activePixels =
            (await window.__HILO3D_SSR_PALACE_TEST_API__?.setFloorRoughness(0.08)) ?? -1;
        await window.__HILO3D_SSR_PALACE_TEST_API__?.settle(12);
        return activePixels;
    });
    expect(deterministicActivePixels).toBeGreaterThan(0);
    const deterministicReflection = await canvas.screenshot({ animations: 'disabled' });
    const deterministicStability = await worstConsecutiveDifference(
        page,
        canvas,
        deterministicReflection,
        reflectionRegion,
        3
    );
    expect(deterministicStability.changedRatio).toBeLessThan(0.1);
    expect(deterministicStability.meanChannelDelta).toBeLessThan(1.5);

    const stochasticActivePixels = await page.evaluate(async () => {
        const activePixels =
            (await window.__HILO3D_SSR_PALACE_TEST_API__?.setFloorRoughness(0.24)) ?? -1;
        await window.__HILO3D_SSR_PALACE_TEST_API__?.settle(24);
        return activePixels;
    });
    expect(stochasticActivePixels).toBeGreaterThan(0);
    const stochasticReflection = await canvas.screenshot({ animations: 'disabled' });
    const stochasticStability = await worstConsecutiveDifference(
        page,
        canvas,
        stochasticReflection,
        reflectionRegion,
        4
    );
    expect(stochasticStability.changedRatio).toBeLessThan(0.12);
    expect(stochasticStability.meanChannelDelta).toBeLessThan(2);

    const roughActivePixels = await page.evaluate(async () => {
        return (await window.__HILO3D_SSR_PALACE_TEST_API__?.setFloorRoughness(1)) ?? -1;
    });
    expect(roughActivePixels).toBeGreaterThanOrEqual(0);
    expect(roughActivePixels).toBeLessThan(defaultStochasticActivePixels);
    await page.evaluate(async () => {
        await window.__HILO3D_SSR_PALACE_TEST_API__?.setFloorRoughness(0.16);
        await window.__HILO3D_SSR_PALACE_TEST_API__?.moveCamera();
        await window.__HILO3D_SSR_PALACE_TEST_API__?.moveHero();
        await window.__HILO3D_SSR_PALACE_TEST_API__?.settle(12);
    });
    const movedSettled = await canvas.screenshot({ animations: 'disabled' });
    await page.evaluate(async () => {
        await window.__HILO3D_SSR_PALACE_TEST_API__?.settle(1);
    });
    const movedNextFrame = await canvas.screenshot({ animations: 'disabled' });
    const movedContribution = pixelDifference(reflected, movedSettled);
    expect(movedContribution.changedRatio).toBeGreaterThan(0.01);
    const movedStability = pixelDifference(movedSettled, movedNextFrame);
    expect(movedStability.changedRatio).toBeLessThan(0.18);
    expect(movedStability.meanChannelDelta).toBeLessThan(4);

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
            readonly activeTileCount: number;
            readonly activePixelCount: number;
            readonly hitPixelCount: number;
            readonly missPixelCount: number;
            readonly uncertainPixelCount: number;
            readonly backfaceRejectedPixelCount: number;
            readonly historyAcceptedPixelCount: number;
            readonly historyRejectedPixelCount: number;
            readonly resolutionScale: 0.5;
            readonly screenSpaceReflections: boolean;
            readonly temporalAA: true;
            readonly surfaceFinish: 'smoked lacquer';
            readonly heroAsset: 'Khronos Car Concept';
        };
        __HILO3D_SSR_PALACE_TEST_API__?: {
            settle(frames?: number): Promise<void>;
            moveCamera(): Promise<void>;
            setGrazingCamera(): Promise<void>;
            moveHero(deltaX?: number): Promise<void>;
            setFloorRoughness(value: number): Promise<number>;
        };
    }
}
