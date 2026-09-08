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

// A whole-image frame delta can miss sparse single-pixel holes. Measure dark outliers
// inside a smooth red reflection against their local median instead of its silhouette.
function reflectionHoleRatio(frame: Buffer): { readonly holes: number; readonly samples: number } {
    const pixels = PNG.sync.read(frame);
    let holes = 0;
    let samples = 0;
    const neighbors: number[] = [];
    for (let y = 740; y < 850; y++) {
        for (let x = 530; x < 645; x++) {
            neighbors.length = 0;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    if (dx !== 0 || dy !== 0) {
                        neighbors.push(pixels.data[((y + dy) * pixels.width + x + dx) * 4] ?? 0);
                    }
                }
            }
            neighbors.sort((left, right) => left - right);
            const median = neighbors[12] ?? 0;
            const red = pixels.data[(y * pixels.width + x) * 4] ?? 0;
            if (median > 30) {
                samples++;
                if (red < median * 0.65 && median - red > 12) holes++;
            }
        }
    }
    return { holes, samples };
}

function meanRedTrail(frame: Buffer): number {
    const pixels = PNG.sync.read(frame);
    let excess = 0;
    // This floor area stays outside the car's reflection throughout the fixed orbit below.
    for (let y = 630; y < 835; y++) {
        for (let x = 0; x < 220; x++) {
            const offset = (y * pixels.width + x) * 4;
            excess += Math.max(
                0,
                (pixels.data[offset] ?? 0) -
                    Math.max(pixels.data[offset + 1] ?? 0, pixels.data[offset + 2] ?? 0)
            );
        }
    }
    return excess / (220 * 205);
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

    const defaultActivePixels = evidence?.activePixelCount ?? 0;
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

    for (const roughness of [0.16, 0.24]) {
        const stochasticActivePixels = await page.evaluate(async value => {
            const activePixels =
                (await window.__HILO3D_SSR_PALACE_TEST_API__?.setFloorRoughness(value)) ?? -1;
            await window.__HILO3D_SSR_PALACE_TEST_API__?.settle(24);
            return activePixels;
        }, roughness);
        expect(stochasticActivePixels).toBeGreaterThan(0);
        const stochasticReflection = await canvas.screenshot({ animations: 'disabled' });
        const stochasticStability = await worstConsecutiveDifference(
            page,
            canvas,
            stochasticReflection,
            reflectionRegion,
            4
        );
        expect(stochasticStability.changedRatio).toBeLessThan(roughness < 0.2 ? 0.075 : 0.12);
        expect(stochasticStability.meanChannelDelta).toBeLessThan(roughness < 0.2 ? 1.5 : 2);
    }

    const roughActivePixels = await page.evaluate(async () => {
        return (await window.__HILO3D_SSR_PALACE_TEST_API__?.setFloorRoughness(1)) ?? -1;
    });
    expect(roughActivePixels).toBeGreaterThanOrEqual(0);
    expect(roughActivePixels).toBeLessThan(defaultActivePixels);
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

    await page.locator('#ssrToggle').click();
    await expect(page).toHaveURL(/ssr=false/u);
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

test('keeps Afterimage reflections free of fine dark holes across a full jitter cycle', async ({
    page
}) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 960 });
    const examplesOrigin = process.env['HILO3D_EXAMPLES_ORIGIN'] ?? '';
    await page.goto(`${examplesOrigin}/examples/screen_space_reflections_palace.html?test=1`);
    await expect(page.locator('body')).toHaveAttribute('data-ssr-ready', 'true', {
        timeout: 60_000
    });
    await page.evaluate(async () => window.__HILO3D_SSR_PALACE_TEST_API__?.settle(24));
    for (let phase = 0; phase < 32; phase++) {
        const frame = await page.locator('canvas').screenshot({ animations: 'disabled' });
        const { holes, samples } = reflectionHoleRatio(frame);
        expect(samples, `visible reflection at phase ${String(phase)}`).toBeGreaterThan(5_000);
        expect(holes / samples, `fine dark holes at phase ${String(phase)}`).toBeLessThan(0.005);
        await page.evaluate(async () => window.__HILO3D_SSR_PALACE_TEST_API__?.settle(1));
    }
    expect(errors).toEqual([]);
});

test('rejects stale Afterimage reflection trails during rapid orbit in both directions', async ({
    page
}) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 960 });
    const examplesOrigin = process.env['HILO3D_EXAMPLES_ORIGIN'] ?? '';
    await page.goto(`${examplesOrigin}/examples/screen_space_reflections_palace.html?test=1`);
    await expect(page.locator('body')).toHaveAttribute('data-ssr-ready', 'true', {
        timeout: 60_000
    });
    await page.evaluate(async () => {
        await window.__HILO3D_SSR_PALACE_TEST_API__?.setGrazingCamera();
        await window.__HILO3D_SSR_PALACE_TEST_API__?.settle(24);
    });
    await page.mouse.move(1100, 400);
    await page.mouse.down();
    for (const step of [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0]) {
        await page.mouse.move(1100 - step * 115, 400);
        // Inspect the moving frame immediately; settling here would conceal the regression.
        await page.evaluate(async () => window.__HILO3D_SSR_PALACE_TEST_API__?.settle(1));
        const movingFrame = await page.locator('canvas').screenshot({ animations: 'disabled' });
        expect(meanRedTrail(movingFrame), `red trails at orbit step ${String(step)}`).toBeLessThan(
            1
        );
    }
    await page.mouse.up();
    await page.evaluate(async () => window.__HILO3D_SSR_PALACE_TEST_API__?.settle(32));
    const settled = await page.locator('canvas').screenshot({ animations: 'disabled' });
    expect(meanRedTrail(settled)).toBeLessThan(1);
    const stability = await worstConsecutiveDifference(
        page,
        page.locator('canvas'),
        settled,
        { left: 0.2, top: 0.64, right: 0.9, bottom: 0.94 },
        3
    );
    expect(stability.meanChannelDelta).toBeLessThan(2);
    expect(errors).toEqual([]);
});

test('keeps the complete car visible in portrait and supports orbit after resizing', async ({
    page
}) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    const examplesOrigin = process.env['HILO3D_EXAMPLES_ORIGIN'] ?? '';
    await page.goto(`${examplesOrigin}/examples/screen_space_reflections_palace.html?test=1`);
    await expect(page.locator('body')).toHaveAttribute('data-ssr-ready', 'true', {
        timeout: 60_000
    });
    await page.evaluate(async () => window.__HILO3D_SSR_PALACE_TEST_API__?.settle(8));
    await expect(page.locator('#ssrToggle')).toBeInViewport();
    await expect(page.locator('.ssrIntro')).toBeInViewport();
    const portrait = PNG.sync.read(await page.locator('canvas').screenshot());
    let left = portrait.width;
    let right = 0;
    for (let y = Math.floor(portrait.height * 0.3); y < portrait.height * 0.7; y++) {
        for (let x = 0; x < portrait.width; x++) {
            const offset = (y * portrait.width + x) * 4;
            if (
                (portrait.data[offset] ?? 0) > 60 &&
                (portrait.data[offset] ?? 0) > (portrait.data[offset + 1] ?? 0) * 2
            ) {
                left = Math.min(left, x);
                right = Math.max(right, x);
            }
        }
    }
    expect(right - left).toBeGreaterThan(180);
    expect(left).toBeGreaterThan(12);
    expect(right).toBeLessThan(portrait.width - 12);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(async () => window.__HILO3D_SSR_PALACE_TEST_API__?.settle(24));
    const beforeOrbit = await page.locator('canvas').screenshot();
    await page.mouse.move(820, 370);
    await page.mouse.down();
    await page.mouse.move(980, 400, { steps: 8 });
    await page.mouse.up();
    await page.evaluate(async () => window.__HILO3D_SSR_PALACE_TEST_API__?.settle(24));
    const afterOrbit = await page.locator('canvas').screenshot();
    expect(pixelDifference(beforeOrbit, afterOrbit).changedRatio).toBeGreaterThan(0.01);
    expect(errors).toEqual([]);
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
