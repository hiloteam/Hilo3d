import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { ExampleBackend } from './example-paths';
import { installPageFailureMonitor } from './page-failure-monitor';
import { captureStableFrame } from './stable-capture';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    completedRenderCommands,
    installRenderHealthProbe,
    readRenderHealth
} from './render-health';

interface ChromaticSnapshot {
    readonly ready: boolean;
    readonly enabled: boolean;
    readonly mode: string;
    readonly split: boolean;
    readonly motion: boolean;
    readonly bloom: number;
    readonly dispersion: number;
    readonly contours: number;
    readonly exposure: number;
    readonly passCount: number;
    readonly frameCount: number;
    readonly width: number;
    readonly height: number;
}

interface ChromaticTestAPI {
    snapshot(): ChromaticSnapshot;
}

type ChromaticWindow = Window & {
    readonly __HILO3D_CHROMATIC__?: ChromaticTestAPI;
    readonly __HILO3D_CHROMATIC_TEST__?: {
        advanceFrames(count: number): Promise<void>;
    };
};

const backends = ['webgl2', 'webgpu'] as const;
test.use({ video: 'off' });
// Hide the HTML controls during capture so changing a label cannot satisfy a pixel assertion.
const canvasOnlyStyle =
    'body * { visibility: hidden !important; } canvas { visibility: visible !important; }';

interface PixelRegion {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

interface PixelComparisonOptions {
    readonly flipCandidate?: boolean;
    readonly region?: PixelRegion;
    readonly blockSize?: number;
}

interface PixelDifference {
    readonly changedRatio: number;
    readonly strongRatio: number;
    readonly meanChannelDelta: number;
}

// Keep the sculpture, open arch, and upper plinth; exclude most of the uniform room background.
const sculptureRegion: PixelRegion = { left: 0.33, top: 0.16, right: 0.73, bottom: 0.72 };
// Average each image before taking differences so sub-pixel edge shimmer cannot pass as a clear
// optical effect. Both coverage and contrast must remain visible across four-pixel neighborhoods.
const opticalComparison: PixelComparisonOptions = { region: sculptureRegion, blockSize: 4 };

async function snapshot(page: Page): Promise<ChromaticSnapshot> {
    return page.evaluate(() => {
        const api = (window as ChromaticWindow).__HILO3D_CHROMATIC__;
        if (api === undefined) throw new Error('Chromatic frame evidence is unavailable');
        return api.snapshot();
    });
}

async function settle(page: Page, frames = 2): Promise<ChromaticSnapshot> {
    const before = await snapshot(page);
    await page.evaluate(async count => {
        const control = (window as ChromaticWindow).__HILO3D_CHROMATIC_TEST__;
        if (!control) throw new Error('Chromatic requires explicit test frame control');
        await control.advanceFrames(count);
    }, frames);
    await awaitTrackedGPUQueues(page);
    const after = await snapshot(page);
    expect(after.frameCount).toBe(before.frameCount + frames);
    return after;
}

async function captureCanvas(page: Page): Promise<Buffer> {
    await settle(page, 1);
    const backend = new URL(page.url()).searchParams.get('backend');
    if (backend !== 'webgl2' && backend !== 'webgpu') throw new Error('Missing capture backend');
    return captureStableFrame(page, backend, {
        style: canvasOnlyStyle
    });
}

async function setSlider(page: Page, selector: string, value: number): Promise<ChromaticSnapshot> {
    await page.locator(selector).evaluate((element, nextValue) => {
        if (!(element instanceof HTMLInputElement)) {
            throw new TypeError('Chromatic slider must be an input element');
        }
        element.value = String(nextValue);
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    return settle(page);
}

function comparePixels(
    referenceBuffer: Buffer,
    candidateBuffer: Buffer,
    options: PixelComparisonOptions = {}
): PixelDifference {
    const reference = PNG.sync.read(referenceBuffer);
    const candidate = PNG.sync.read(candidateBuffer);
    expect([candidate.width, candidate.height]).toEqual([reference.width, reference.height]);
    let changed = 0;
    let strong = 0;
    let totalDelta = 0;
    let blocks = 0;
    const region = options.region ?? { left: 0, top: 0, right: 1, bottom: 1 };
    const blockSize = options.blockSize ?? 1;
    const left = Math.floor(reference.width * region.left);
    const top = Math.floor(reference.height * region.top);
    const right = Math.floor(reference.width * region.right);
    const bottom = Math.floor(reference.height * region.bottom);
    for (let y = top; y + blockSize <= bottom; y += blockSize) {
        for (let x = left; x + blockSize <= right; x += blockSize) {
            let maximumDelta = 0;
            for (let channel = 0; channel < 3; channel++) {
                let referenceSum = 0;
                let candidateSum = 0;
                for (let row = 0; row < blockSize; row++) {
                    const candidateY = options.flipCandidate
                        ? reference.height - y - row - 1
                        : y + row;
                    for (let column = 0; column < blockSize; column++) {
                        const referenceOffset = ((y + row) * reference.width + x + column) * 4;
                        const candidateOffset = (candidateY * reference.width + x + column) * 4;
                        referenceSum += reference.data[referenceOffset + channel] ?? 0;
                        candidateSum += candidate.data[candidateOffset + channel] ?? 0;
                    }
                }
                const delta = Math.abs(referenceSum - candidateSum) / (blockSize * blockSize);
                totalDelta += delta;
                maximumDelta = Math.max(maximumDelta, delta);
            }
            if (maximumDelta > 8) changed++;
            if (maximumDelta > 24) strong++;
            blocks++;
        }
    }
    expect(blocks).toBeGreaterThan(0);
    return {
        changedRatio: changed / blocks,
        strongRatio: strong / blocks,
        meanChannelDelta: totalDelta / (blocks * 3)
    };
}

async function nativeCommandsPerFrame(page: Page, backend: ExampleBackend): Promise<number> {
    const read = async (): Promise<{ readonly frames: number; readonly commands: number }> =>
        page.evaluate(selectedBackend => {
            const state = (window as ChromaticWindow).__HILO3D_CHROMATIC__?.snapshot();
            const health = window.__HILO3D_UI_RENDER_HEALTH__;
            if (state === undefined || health === undefined) {
                throw new Error('Chromatic native frame instrumentation is unavailable');
            }
            return {
                frames: state.frameCount,
                commands:
                    selectedBackend === 'webgpu'
                        ? health.webgpuRenderPasses
                        : health.webgl2DrawCalls
            };
        }, backend);
    const before = await read();
    await settle(page, 4);
    const after = await read();
    expect(after.frames).toBeGreaterThan(before.frames);
    return (after.commands - before.commands) / (after.frames - before.frames);
}

async function openGallery(page: Page, backend: ExampleBackend): Promise<ChromaticSnapshot> {
    await page.goto(`/examples/scriptable_pipeline.html?backend=${backend}&motion=0&test=1`, {
        waitUntil: 'load'
    });
    await page.waitForFunction(
        () => (window as ChromaticWindow).__HILO3D_CHROMATIC__?.snapshot().ready === true,
        undefined,
        { timeout: 90_000 }
    );
    await expect(page.locator('#loadingPanel')).toBeHidden();
    await expect(page.locator('#controlsFieldset')).toBeEnabled();
    return settle(page);
}

async function assertGraphicsHealth(page: Page, backend: ExampleBackend): Promise<void> {
    expect(completedRenderCommands(await readRenderHealth(page), backend)).toBeGreaterThan(0);
    await assertStableInstrumentationHealth(backend, `Chromatic ${backend} rendering`, {
        waitForStableAnimationFrames: async () => {
            await settle(page, 2);
        },
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });
}

for (const backend of backends) {
    test(`Chromatic demonstrates live scriptable passes on ${backend} @${backend}`, async ({
        page
    }, testInfo) => {
        test.setTimeout(360_000);
        await page.setViewportSize({ width: 960, height: 640 });
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            const initial = await openGallery(page, backend);
            expect(initial).toMatchObject({
                ready: true,
                enabled: true,
                mode: 'beauty',
                split: false,
                motion: false,
                passCount: 4
            });
            await expect(page.locator('#pipelineToggle')).toHaveAttribute('aria-pressed', 'true');
            await expect(page.locator('#motionToggle')).toHaveAttribute('aria-pressed', 'false');
            const result = await page.evaluate(() => window.__HILO3D_SCRIPTABLE_PIPELINE_RESULT__);
            expect(result).toMatchObject({ backend, hasShadowAtlas: true });
            expect(result?.drawCount).toBeGreaterThan(4);
            expect(result?.faceCount).toBeGreaterThan(0);

            const beauty = await captureCanvas(page);
            await testInfo.attach(`Chromatic beauty ${backend}`, {
                body: beauty,
                contentType: 'image/png'
            });
            const enabledCommands = await nativeCommandsPerFrame(page, backend);
            await page.locator('#pipelineToggle').click();
            const disabled = await settle(page);
            expect(disabled.enabled).toBe(false);
            expect(disabled.passCount).toBeLessThan(initial.passCount);
            await expect(page.locator('#pipelineToggle')).toHaveAttribute('aria-pressed', 'false');
            const disabledCommands = await nativeCommandsPerFrame(page, backend);
            expect(enabledCommands - disabledCommands).toBeGreaterThan(2);
            const neutral = await captureCanvas(page);
            expect(comparePixels(beauty, neutral).changedRatio).toBeGreaterThan(0.005);
            await page.locator('#pipelineToggle').click();
            expect((await settle(page)).passCount).toBe(initial.passCount);

            for (const mode of ['bloom', 'depth', 'contours'] as const) {
                const button = page.locator(`[data-view="${mode}"]`);
                await button.click();
                expect((await settle(page)).mode).toBe(mode);
                await expect(button).toHaveAttribute('aria-pressed', 'true');
                const capture = await captureCanvas(page);
                expect(comparePixels(beauty, capture).changedRatio).toBeGreaterThan(0.05);
                await testInfo.attach(`Chromatic ${mode} ${backend}`, {
                    body: capture,
                    contentType: 'image/png'
                });
            }
            await page.locator('[data-view="beauty"]').click();
            await page.locator('#compareToggle').click();
            expect((await settle(page)).split).toBe(true);
            await expect(page.locator('#compareToggle')).toHaveAttribute('aria-pressed', 'true');
            expect(comparePixels(beauty, await captureCanvas(page)).changedRatio).toBeGreaterThan(
                0.002
            );
            const leftComparison: PixelComparisonOptions = {
                region: { left: 0.02, top: 0.06, right: 0.47, bottom: 0.94 }
            };
            const rightComparison: PixelComparisonOptions = {
                region: { left: 0.53, top: 0.06, right: 0.98, bottom: 0.94 }
            };
            for (const mode of ['beauty', 'bloom', 'depth', 'contours']) {
                await page.locator(`[data-view="${mode}"]`).click();
                expect(await settle(page)).toMatchObject({ mode, split: true });
                await expect(page.locator('#compareToggle')).toHaveAttribute(
                    'aria-pressed',
                    'true'
                );
                await expect(page.locator('#splitOverlay')).toContainText(
                    mode === 'beauty' ? 'COMPOSITE' : mode.toUpperCase()
                );
                const splitView = await captureCanvas(page);
                expect(
                    comparePixels(neutral, splitView, leftComparison).meanChannelDelta
                ).toBeLessThan(0.25);
                const rightDifference = comparePixels(beauty, splitView, rightComparison);
                if (mode === 'beauty') expect(rightDifference.meanChannelDelta).toBeLessThan(0.25);
                else expect(rightDifference.changedRatio).toBeGreaterThan(0.05);
                await page.locator('#compareToggle').click();
                expect(await settle(page)).toMatchObject({ mode, split: false });
                // Removing the split expands the selected view; its already-visible right half
                // must stay unchanged rather than silently return to the Beauty output.
                expect(
                    comparePixels(splitView, await captureCanvas(page), rightComparison)
                        .meanChannelDelta
                ).toBeLessThan(0.25);
                await page.locator('#compareToggle').click();
                expect(await settle(page)).toMatchObject({ mode, split: true });
            }
            await page.locator('[data-view="beauty"]').click();
            await page.locator('#compareToggle').click();

            expect((await setSlider(page, '#bloomControl', 0)).bloom).toBe(0);
            const unbloomed = await captureCanvas(page);
            expect((await setSlider(page, '#bloomControl', 160)).bloom).toBeCloseTo(1.6);
            expect(
                comparePixels(unbloomed, await captureCanvas(page)).changedRatio
            ).toBeGreaterThan(0.005);
            await setSlider(page, '#bloomControl', 72);
            expect((await setSlider(page, '#exposureControl', 60)).exposure).toBeCloseTo(0.6);
            const dark = await captureCanvas(page);
            expect((await setSlider(page, '#exposureControl', 150)).exposure).toBeCloseTo(1.5);
            expect(comparePixels(dark, await captureCanvas(page)).changedRatio).toBeGreaterThan(
                0.1
            );
            await setSlider(page, '#exposureControl', 100);

            const canvasBounds = await page.locator('canvas').boundingBox();
            if (canvasBounds === null) throw new Error('Chromatic canvas cannot receive gestures');
            const centerX = canvasBounds.x + canvasBounds.width * 0.52;
            const centerY = canvasBounds.y + canvasBounds.height * 0.53;
            for (const direction of [-1, 1]) {
                await page.mouse.move(centerX, centerY);
                await page.mouse.down();
                await page.mouse.move(centerX + direction * 140, centerY, { steps: 5 });
                let previousOrbit = await captureCanvas(page);
                // Fine steps through the side view reject an abrupt backdrop cutaway while
                // allowing ordinary parallax, silhouette motion, and changing metal reflections.
                for (const distance of [150, 160]) {
                    await page.mouse.move(centerX + direction * distance, centerY);
                    const nextOrbit = await captureCanvas(page);
                    expect(comparePixels(previousOrbit, nextOrbit).meanChannelDelta).toBeLessThan(
                        8
                    );
                    previousOrbit = nextOrbit;
                }
                await page.mouse.move(centerX + direction * 210, centerY, { steps: 6 });
                await page.mouse.up();
                const orbited = await captureCanvas(page);
                expect(comparePixels(beauty, orbited).changedRatio).toBeGreaterThan(0.03);
                await page.locator('#resetView').click();
                const restored = await captureCanvas(page);
                expect(comparePixels(beauty, restored).meanChannelDelta).toBeLessThan(2);
            }

            await page.setViewportSize({ width: 760, height: 540 });
            const resized = await settle(page, 5);
            expect(resized.width).not.toBe(initial.width);
            expect(resized.height).not.toBe(initial.height);
            expect(resized.passCount).toBe(initial.passCount);
            await page.locator('#resetView').click();
            await settle(page);
            await page.locator('#motionToggle').click();
            expect((await settle(page, 5)).motion).toBe(true);
            await page.locator('#motionToggle').click();
            expect((await settle(page)).motion).toBe(false);
            await assertGraphicsHealth(page, backend);
            failures.assertEmpty(`Chromatic ${backend} browser failures`);
        } catch (error: unknown) {
            failures.assertEmpty(`Chromatic ${backend} browser failures`);
            throw error;
        } finally {
            await failures.dispose();
        }
    });

    test(`Chromatic keeps optical controls perceptible and responsive on ${backend} @${backend}`, async ({
        page
    }, testInfo) => {
        test.setTimeout(240_000);
        await page.setViewportSize({ width: 960, height: 640 });
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await openGallery(page, backend);
            await setSlider(page, '#dispersionControl', 0);
            await setSlider(page, '#contourControl', 0);
            for (const control of [
                {
                    selector: '#dispersionControl',
                    key: 'dispersion',
                    midDelta: 2,
                    fullDelta: 5
                },
                { selector: '#contourControl', key: 'contours', midDelta: 2, fullDelta: 6 }
            ] as const) {
                const captures: Buffer[] = [];
                for (const value of [0, 50, 100]) {
                    const state = await setSlider(page, control.selector, value);
                    expect(state[control.key]).toBe(value / 100);
                    const capture = await captureCanvas(page);
                    captures.push(capture);
                    await testInfo.attach(`${control.key} ${String(value)} percent ${backend}`, {
                        body: capture,
                        contentType: 'image/png'
                    });
                }
                const [zero, half, full] = captures;
                if (zero === undefined || half === undefined || full === undefined) {
                    throw new Error(`Incomplete ${control.key} strength captures`);
                }
                const medium = comparePixels(zero, half, opticalComparison);
                const maximum = comparePixels(zero, full, opticalComparison);
                const upperRange = comparePixels(half, full, opticalComparison);
                expect(medium.changedRatio, `${control.key} visible at 50%`).toBeGreaterThan(0.1);
                expect(medium.strongRatio, `${control.key} contrast at 50%`).toBeGreaterThan(0.03);
                expect(medium.meanChannelDelta).toBeGreaterThan(control.midDelta);
                expect(maximum.changedRatio, `${control.key} coverage at 100%`).toBeGreaterThan(
                    0.18
                );
                expect(maximum.strongRatio, `${control.key} contrast at 100%`).toBeGreaterThan(
                    0.08
                );
                expect(maximum.meanChannelDelta).toBeGreaterThan(control.fullDelta);
                // Increasing the control must strengthen the effect, not only produce different
                // pixels; a control that reaches its maximum halfway through the range fails.
                expect(maximum.meanChannelDelta).toBeGreaterThan(medium.meanChannelDelta * 1.3);
                expect(upperRange.changedRatio).toBeGreaterThan(0.1);
                expect(upperRange.meanChannelDelta).toBeGreaterThan(1.5);
                await testInfo.attach(`${control.key} perceptual measurements ${backend}`, {
                    body: Buffer.from(JSON.stringify({ medium, maximum, upperRange }, null, 2)),
                    contentType: 'application/json'
                });
                await setSlider(page, control.selector, 0);
                expect(
                    comparePixels(zero, await captureCanvas(page)).meanChannelDelta
                ).toBeLessThan(0.05);

                await page.locator('#pipelineToggle').click();
                expect((await settle(page)).enabled).toBe(false);
                const bypassed = await captureCanvas(page);
                // A real keyboard interaction dispatches the same input event as a pointer drag.
                await page.locator(control.selector).focus();
                await page.locator(control.selector).press('End');
                expect(await settle(page)).toMatchObject({ enabled: true, mode: 'beauty' });
                await expect(page.locator('#pipelineToggle')).toHaveAttribute(
                    'aria-pressed',
                    'true'
                );
                await expect(page.locator('[data-view="beauty"]')).toHaveAttribute(
                    'aria-pressed',
                    'true'
                );
                expect(
                    comparePixels(bypassed, await captureCanvas(page), opticalComparison)
                        .meanChannelDelta
                ).toBeGreaterThan(2);

                for (const mode of ['bloom', 'depth', 'contours']) {
                    await page.locator(`[data-view="${mode}"]`).click();
                    expect((await settle(page)).mode).toBe(mode);
                    expect(await setSlider(page, control.selector, 50)).toMatchObject({
                        enabled: true,
                        mode: 'beauty'
                    });
                    await expect(page.locator('[data-view="beauty"]')).toHaveAttribute(
                        'aria-pressed',
                        'true'
                    );
                    await expect(page.locator(`[data-view="${mode}"]`)).toHaveAttribute(
                        'aria-pressed',
                        'false'
                    );
                }
                await page.locator('#compareToggle').click();
                expect(await setSlider(page, control.selector, 75)).toMatchObject({
                    enabled: true,
                    mode: 'beauty',
                    split: true
                });
                await expect(page.locator('#compareToggle')).toHaveAttribute(
                    'aria-pressed',
                    'true'
                );
                await page.locator('#compareToggle').click();
                await setSlider(page, control.selector, 0);
            }
            for (const size of [
                { width: 760, height: 540 },
                { width: 844, height: 390 },
                { width: 390, height: 844 }
            ]) {
                await page.setViewportSize(size);
                await settle(page, 3);
                const contentSize = await page.evaluate(() => ({
                    width: document.documentElement.scrollWidth,
                    height: document.documentElement.scrollHeight
                }));
                expect(contentSize.width).toBeLessThanOrEqual(size.width + 1);
                expect(contentSize.height).toBeLessThanOrEqual(size.height + 1);
                for (const selector of [
                    '#bloomControl',
                    '#dispersionControl',
                    '#contourControl',
                    '#exposureControl',
                    '#pipelineToggle',
                    '#compareToggle',
                    '#motionToggle',
                    '#resetView',
                    '[data-view="beauty"]',
                    '[data-view="bloom"]',
                    '[data-view="depth"]',
                    '[data-view="contours"]'
                ]) {
                    // Trial clicks still require a visible, enabled, unobscured pointer target.
                    await page.locator(selector).click({ trial: true });
                }
            }
            await assertGraphicsHealth(page, backend);
            failures.assertEmpty(`Chromatic responsive ${backend} browser failures`);
        } catch (error: unknown) {
            failures.assertEmpty(`Chromatic responsive ${backend} browser failures`);
            throw error;
        } finally {
            await failures.dispose();
        }
    });
}

test('Chromatic keeps asymmetric color, bloom, and depth rows aligned across backends', async ({
    page
}) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 960, height: 640 });
    await installRenderHealthProbe(page);
    const failures = await installPageFailureMonitor(page);
    try {
        const reference = new Map<string, Buffer>();
        for (const backend of backends) {
            await openGallery(page, backend);
            for (const mode of ['beauty', 'bloom', 'depth'] as const) {
                await page.locator(`[data-view="${mode}"]`).click();
                const capture = await captureCanvas(page);
                if (backend === 'webgl2') {
                    reference.set(mode, capture);
                    continue;
                }
                const original = reference.get(mode);
                if (original === undefined) throw new Error(`Missing ${mode} parity reference`);
                const aligned = comparePixels(original, capture);
                const flipped = comparePixels(original, capture, { flipCandidate: true });
                expect(aligned.meanChannelDelta, `${mode} backend parity`).toBeLessThan(6);
                expect(
                    flipped.meanChannelDelta,
                    `${mode} fixture must be asymmetric`
                ).toBeGreaterThan(0.5);
                expect(
                    aligned.meanChannelDelta,
                    `${mode} top-left orientation must fit better than vertically flipped rows`
                ).toBeLessThan(flipped.meanChannelDelta * 0.25);
            }
            await assertGraphicsHealth(page, backend);
        }
        failures.assertEmpty('Chromatic cross-backend browser failures');
    } catch (error: unknown) {
        failures.assertEmpty('Chromatic cross-backend browser failures');
        throw error;
    } finally {
        await failures.dispose();
    }
});
