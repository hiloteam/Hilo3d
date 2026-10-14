import { writeFile } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type { TestFrameControl } from '../../examples/shared/test-frame-control';
import type { ClusteredForwardPlusDiagnostics } from '../../src/render/pipeline/ClusteredForwardPlus';
import type { RendererDiagnosticsSnapshot } from '../../src/render/RendererDiagnostics';
import { installPageFailureMonitor } from './page-failure-monitor';
import { captureStableFrame } from './stable-capture';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    installRenderHealthProbe,
    nativeRenderProgress,
    nativeRenderProgressAdvanced,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';

type Feature = 'gi' | 'volumetric' | 'decals' | 'transparency';
type Triple = readonly [number, number, number];
interface GardenEvidence {
    readonly backend: 'webgpu';
    readonly submittedFrames: number;
    readonly drawCalls: number;
    readonly features: Readonly<Record<Feature, boolean>>;
    readonly preset: 'morning' | 'evening';
    readonly motion: boolean;
    readonly view: number;
    readonly triangleCount: number;
    readonly meshCount: number;
    readonly decalCount: number;
    readonly weightedMeshCount: number;
    readonly camera: { readonly position: Triple; readonly target: Triple };
    readonly volumetricCenter: Triple;
    readonly disposed: boolean;
    readonly pipeline: Readonly<ClusteredForwardPlusDiagnostics>;
    readonly native: Readonly<RendererDiagnosticsSnapshot>;
}
interface GardenAPI {
    settle(frames?: number, options?: Readonly<{ keepPaused?: boolean }>): Promise<GardenEvidence>;
    setPreset(preset: 'morning' | 'evening'): void;
    setFeature(feature: Feature, enabled: boolean): void;
    setMotion(enabled: boolean): void;
    diagnostics(): Promise<GardenEvidence>;
    dispose(): Promise<void>;
}
type GardenWindow = Window & {
    __HILO_RAIN_TEA_GARDEN__?: GardenAPI;
    __HILO3D_TEST_CAPTURE__?: TestFrameControl;
};

interface PixelDifference {
    readonly changedRatio: number;
    readonly meanRGB: number;
}

// Leave layout untouched while excluding labels and pressed-state changes from scene evidence.
const SCENE_CAPTURE_STYLE = `
body * { visibility: hidden !important; }
canvas[data-hilo3d-backend] { visibility: visible !important; }
`;
const WEIGHTED_PASSES = [
    'Weighted transparency HDR accumulation',
    'Weighted transparency revealage',
    'Weighted transparency HDR composition'
] as const;

function gardenRequestURL(testInfo: TestInfo): string {
    const query = new URLSearchParams({ backend: 'webgpu', test: '1' });
    if (testInfo.project.name === 'chromium-native-webgpu') query.set('quality', 'production');
    return `/examples/rain_tea_garden.html?${query.toString()}`;
}

function difference(first: Buffer, second: Buffer): PixelDifference {
    const a = PNG.sync.read(first);
    const b = PNG.sync.read(second);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    let changed = 0;
    let total = 0;
    for (let offset = 0; offset < a.data.length; offset += 4) {
        const red = Math.abs((a.data[offset] ?? 0) - (b.data[offset] ?? 0));
        const green = Math.abs((a.data[offset + 1] ?? 0) - (b.data[offset + 1] ?? 0));
        const blue = Math.abs((a.data[offset + 2] ?? 0) - (b.data[offset + 2] ?? 0));
        total += red + green + blue;
        if (Math.max(red, green, blue) > 6) changed++;
    }
    return {
        changedRatio: changed / (a.width * a.height),
        meanRGB: total / (a.width * a.height * 3)
    };
}

async function settle(page: Page, frames = 24): Promise<GardenEvidence> {
    return page.evaluate(async count => {
        const api = (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__;
        if (!api) throw new Error('Rain tea garden controls unavailable');
        await api.settle(count);
        return api.diagnostics();
    }, frames);
}

/** Require natural ticker work: settle() deliberately performs its own manual submissions. */
async function waitForLiveFrames(page: Page, frames = 2): Promise<GardenEvidence> {
    const before = nativeRenderProgress(await readRenderHealth(page), 'webgpu');
    const evidence = await page.evaluate(async count => {
        const garden = window as GardenWindow;
        const capture = garden.__HILO3D_TEST_CAPTURE__;
        const api = garden.__HILO_RAIN_TEA_GARDEN__;
        if (!capture || !api) throw new Error('Garden live-frame controls unavailable');
        await capture.waitForFrames(count);
        return api.diagnostics();
    }, frames);
    await awaitTrackedGPUQueues(page);
    const after = nativeRenderProgress(await readRenderHealth(page), 'webgpu');
    expect(nativeRenderProgressAdvanced(before, after, 'webgpu')).toBe(true);
    expect(after.canvasAcquisitions).toBeGreaterThan(before.canvasAcquisitions);
    return evidence;
}

async function captureScene(page: Page): Promise<Buffer> {
    await page.evaluate(async () => {
        const garden = window as GardenWindow;
        const capture = garden.__HILO3D_TEST_CAPTURE__;
        const api = garden.__HILO_RAIN_TEA_GARDEN__;
        if (!capture || !api) throw new Error('Garden capture controls unavailable');
        await capture.pause();
        const state = await api.diagnostics();
        // TAA has eight projection samples. Compare identical phases so subpixel edge jitter
        // cannot masquerade as a small decal/fog contribution; retain real draws and histories.
        await api.settle(8 - (state.submittedFrames % 8));
        await capture.pause();
    });
    return captureStableFrame(page, 'webgpu', { style: SCENE_CAPTURE_STYLE });
}

async function attachImage(testInfo: TestInfo, name: string, body: Buffer): Promise<void> {
    const path = testInfo.outputPath(`${name}.png`);
    await writeFile(path, body);
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

function passNames(evidence: GardenEvidence): readonly string[] {
    const graph = evidence.native.renderGraph;
    expect(graph, 'diagnostics must describe a submitted Render Graph').not.toBeNull();
    return graph?.passes.map(pass => pass.name) ?? [];
}

function assertSubmittedFeatures(evidence: GardenEvidence): void {
    expect(evidence.backend).toBe('webgpu');
    expect(evidence.submittedFrames).toBeGreaterThan(0);
    expect(evidence.drawCalls).toBeGreaterThan(0);
    expect(evidence.meshCount).toBeGreaterThan(10);
    expect(evidence.decalCount).toBeGreaterThan(0);
    expect(evidence.weightedMeshCount).toBeGreaterThan(1);
    expect(evidence.triangleCount).toBeGreaterThan(1000);
    expect(evidence.native.frame.draws).toBeGreaterThan(0);
    expect(evidence.native.frame.dispatches).toBeGreaterThan(0);
    expect(evidence.native.frame.submissions).toBeGreaterThan(0);
    expect(evidence.pipeline.clusterOverflowCount).toBe(0);
    expect(evidence.pipeline.dynamicGlobalIllumination?.sceneTriangleCount).toBeGreaterThan(1000);
    expect(evidence.pipeline.dynamicGlobalIllumination?.tracedRayCount).toBeGreaterThan(0);
    expect(evidence.pipeline.dynamicGlobalIllumination?.submittedFrameCount).toBeGreaterThan(0);
    expect(evidence.pipeline.volumetricFroxelCount).toBeGreaterThan(0);
    const names = passNames(evidence);
    expect(names).toContain('DDGI BVH ray queries and probe integration');
    expect(names).toContain('Froxel volumetric light and density injection');
    expect(names).toContain('Volumetric lighting linear HDR composite');
    for (const name of WEIGHTED_PASSES) expect(names).toContain(name);
}

async function assertGPUHealth(page: Page): Promise<void> {
    await assertStableInstrumentationHealth('webgpu', 'Rain tea garden', {
        readRenderHealth: () => readRenderHealth(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page)
    });
}

// Software GPU work competes with video encoding; actual captures and failure traces remain enabled.
test.use({ video: 'off' });

test.beforeEach(async ({ page }, testInfo) => {
    await installRenderHealthProbe(page);
    if (testInfo.project.name === 'chromium-native-webgpu') {
        await page.addInitScript(() => {
            const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
            navigator.gpu.requestAdapter = async options => {
                const adapter = await requestAdapter({ ...options, forceFallbackAdapter: false });
                if (adapter?.info.isFallbackAdapter !== false)
                    throw new Error('Physical garden acceptance requires a non-fallback adapter');
                return adapter;
            };
        });
    }
});

test('rain tea garden stays still across consecutive TAA phases @webgpu', async ({
    page
}, testInfo) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 960, height: 640 });
    const failures = await installPageFailureMonitor(page);
    let initialized = false;
    try {
        await page.goto(gardenRequestURL(testInfo), {
            waitUntil: 'load'
        });
        await page.waitForFunction(
            () =>
                document.body.dataset['rainTeaGardenReady'] === 'true' ||
                document.body.dataset['rainTeaGardenFailed'] !== undefined,
            undefined,
            { timeout: 120_000 }
        );
        expect(await page.locator('body').getAttribute('data-rain-tea-garden-failed')).toBeNull();
        await expect(page.locator('body')).toHaveAttribute('data-rain-tea-garden-ready', 'true');
        initialized = true;
        const rows: {
            preset: 'morning' | 'evening';
            submittedFrame: number;
            samplePhase: number;
            camera: GardenEvidence['camera'];
            adjacentDifference: PixelDifference | null;
        }[] = [];
        try {
            for (const preset of ['morning', 'evening'] as const) {
                let evidence = await page.evaluate(async nextPreset => {
                    const api = (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__;
                    if (!api) throw new Error('Garden stability controls unavailable');
                    api.setMotion(false);
                    api.setPreset(nextPreset);
                    // Warm the complete GI volume and temporal history without disabling any pass.
                    return api.settle(144, { keepPaused: true });
                }, preset);
                const fixedCamera = evidence.camera;
                let previousPixels: Buffer | undefined;
                let previousFrame = evidence.submittedFrames - 1;
                const phases = new Set<number>();
                // Nine consecutive images produce all eight transitions, including the cycle wrap.
                for (let sample = 0; sample < 9; sample++) {
                    expect(evidence.submittedFrames).toBe(previousFrame + 1);
                    expect(evidence.camera).toEqual(fixedCamera);
                    expect(evidence.motion).toBe(false);
                    expect(evidence.features).toEqual({
                        gi: true,
                        volumetric: true,
                        decals: true,
                        transparency: true
                    });
                    assertSubmittedFeatures(evidence);
                    expect(passNames(evidence)).toContain('TemporalAA production resolve');
                    const submittedFrame = evidence.submittedFrames;
                    const samplePhase = submittedFrame % 8;
                    phases.add(samplePhase);
                    // Deliberately do not use captureScene(): no phase alignment or skipped frames.
                    const pixels = await captureStableFrame(page, 'webgpu', {
                        style: SCENE_CAPTURE_STYLE
                    });
                    const afterCapture = await page.evaluate(async () => {
                        const api = (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__;
                        if (!api) throw new Error('Garden stability controls unavailable');
                        return api.diagnostics();
                    });
                    expect(
                        afterCapture.submittedFrames,
                        'capture must not schedule a hidden frame'
                    ).toBe(submittedFrame);
                    expect(afterCapture.camera).toEqual(fixedCamera);
                    const adjacentDifference =
                        previousPixels === undefined ? null : difference(previousPixels, pixels);
                    rows.push({
                        preset,
                        submittedFrame,
                        samplePhase,
                        camera: afterCapture.camera,
                        adjacentDifference
                    });
                    await attachImage(
                        testInfo,
                        `garden-${preset}-consecutive-${String(sample)}`,
                        pixels
                    );
                    if (adjacentDifference !== null) {
                        expect
                            .soft(
                                adjacentDifference.meanRGB,
                                `${preset} adjacent frame ${String(sample)} mean`
                            )
                            .toBeLessThan(0.15);
                        expect
                            .soft(
                                adjacentDifference.changedRatio,
                                `${preset} adjacent frame ${String(sample)} coverage`
                            )
                            .toBeLessThan(0.005);
                    }
                    previousPixels = pixels;
                    previousFrame = submittedFrame;
                    if (sample < 8) {
                        const before = nativeRenderProgress(await readRenderHealth(page), 'webgpu');
                        evidence = await page.evaluate(async () => {
                            const api = (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__;
                            if (!api) throw new Error('Garden stability controls unavailable');
                            return api.settle(1, { keepPaused: true });
                        });
                        await awaitTrackedGPUQueues(page);
                        const after = nativeRenderProgress(await readRenderHealth(page), 'webgpu');
                        expect(nativeRenderProgressAdvanced(before, after, 'webgpu')).toBe(true);
                        expect(after.canvasAcquisitions).toBeGreaterThan(before.canvasAcquisitions);
                    }
                }
                expect(phases.size, `${preset} must visit every TAA sample phase`).toBe(8);
            }
        } finally {
            const path = testInfo.outputPath('garden-consecutive-frame-metrics.json');
            await writeFile(path, JSON.stringify(rows, null, 2));
            await testInfo.attach('garden-consecutive-frame-metrics', {
                path,
                contentType: 'application/json'
            });
            // Release the test-only latch even if a pixel, frame-count or GPU assertion failed.
            await page.evaluate(async () => {
                const api = (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__;
                if (api && !(await api.diagnostics()).disposed) await api.settle(1);
            });
        }
        const beforeOrbit = await waitForLiveFrames(page);
        await page.mouse.move(576, 332);
        await page.mouse.down();
        await page.mouse.move(666, 304, { steps: 8 });
        await page.mouse.up();
        const afterOrbit = await waitForLiveFrames(page, 12);
        expect(afterOrbit.camera.position).not.toEqual(beforeOrbit.camera.position);
        expect(afterOrbit.submittedFrames).toBeGreaterThan(beforeOrbit.submittedFrames);
        await assertGPUHealth(page);
    } finally {
        try {
            if (initialized && !page.isClosed()) {
                await page.evaluate(async () => {
                    await (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__?.dispose();
                });
                await assertGPUHealth(page);
            }
            failures.assertEmpty('Rain tea garden consecutive-frame stability, including teardown');
        } finally {
            await failures.dispose();
        }
    }
});

function testFeatureComparison(title: string, features: readonly Feature[]): void {
    test(title, async ({ page }, testInfo) => {
        test.setTimeout(300_000);
        await page.setViewportSize({ width: 960, height: 640 });
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(gardenRequestURL(testInfo), {
                waitUntil: 'load'
            });
            await page.waitForFunction(
                () =>
                    document.body.dataset['rainTeaGardenReady'] === 'true' ||
                    document.body.dataset['rainTeaGardenFailed'] !== undefined,
                undefined,
                { timeout: 120_000 }
            );
            expect(
                await page.locator('body').getAttribute('data-rain-tea-garden-failed')
            ).toBeNull();
            await expect(page.locator('body')).toHaveAttribute(
                'data-rain-tea-garden-ready',
                'true'
            );
            const canvas = page.locator('canvas[data-hilo3d-backend="webgpu"]');
            await expect(canvas).toHaveCount(1);
            const initial = await settle(page, 72);
            expect(initial.preset).toBe('morning');
            expect(initial.motion).toBe(false);
            expect(initial.features).toEqual({
                gi: true,
                volumetric: true,
                decals: true,
                transparency: true
            });
            assertSubmittedFeatures(initial);
            const morning = await captureScene(page);
            await attachImage(testInfo, 'garden-morning', morning);
            await attachImage(
                testInfo,
                'garden-morning-ui',
                await captureStableFrame(page, 'webgpu')
            );

            await page.locator('button[data-preset="evening"]').click();
            // 420 probes at 48 per frame need nine frames per complete visit; let the new light settle.
            const eveningState = await settle(page, 108);
            expect(eveningState.preset).toBe('evening');
            expect(eveningState.submittedFrames).toBeGreaterThan(initial.submittedFrames);
            const evening = await captureScene(page);
            expect(difference(morning, evening).changedRatio).toBeGreaterThan(0.1);
            await attachImage(testInfo, 'garden-evening', evening);

            // Compare feature contributions against the same camera, light preset and frozen motion.
            await page.locator('.details-panel > summary').click();
            const featureReport: Partial<Record<Feature, PixelDifference>> = {};
            for (const feature of features) {
                const beforeState = await settle(page, 24);
                const enabled = await captureScene(page);
                await settle(page, 2);
                const stable = await captureScene(page);
                const baseline = difference(enabled, stable);
                await attachImage(testInfo, `garden-${feature}-static-reference`, enabled);
                await attachImage(testInfo, `garden-${feature}-static-next`, stable);
                await testInfo.attach(`garden-${feature}-static-difference`, {
                    body: JSON.stringify(baseline, null, 2),
                    contentType: 'application/json'
                });
                expect(baseline.meanRGB, `${feature}: unchanged scene must settle`).toBeLessThan(
                    0.6
                );
                expect(baseline.changedRatio).toBeLessThan(0.02);
                const control = page.locator(`button[data-feature="${feature}"]`);
                await expect(control).toHaveAttribute('aria-pressed', 'true');
                await control.click();
                await expect(control).toHaveAttribute('aria-pressed', 'false');
                const disabledState = await settle(page, 36);
                expect(disabledState.features[feature]).toBe(false);
                expect(disabledState.submittedFrames).toBeGreaterThan(beforeState.submittedFrames);
                const disabled = await captureScene(page);
                const contribution = difference(stable, disabled);
                featureReport[feature] = contribution;
                await attachImage(testInfo, `garden-${feature}-enabled`, stable);
                await attachImage(testInfo, `garden-${feature}-disabled`, disabled);
                const metricsPath = testInfo.outputPath(`garden-${feature}-metrics.json`);
                await writeFile(metricsPath, JSON.stringify({ baseline, contribution }, null, 2));
                await testInfo.attach(`garden-${feature}-metrics`, {
                    path: metricsPath,
                    contentType: 'application/json'
                });
                expect
                    .soft(contribution.changedRatio, `${feature}: visible scene contribution`)
                    .toBeGreaterThan(0.005);
                expect.soft(contribution.meanRGB).toBeGreaterThan(0.15);
                expect
                    .soft(contribution.meanRGB, `${feature}: distinguish from temporal noise`)
                    .toBeGreaterThan(baseline.meanRGB * 4);
                if (feature === 'transparency') {
                    for (const name of WEIGHTED_PASSES)
                        expect(passNames(disabledState)).not.toContain(name);
                }
                if (feature === 'volumetric') {
                    expect(disabledState.volumetricCenter).not.toEqual(
                        beforeState.volumetricCenter
                    );
                    expect(disabledState.pipeline.volumetricFroxelCount).toBeGreaterThan(0);
                }
                await control.click();
                const restored = await settle(page, 36);
                expect(restored.features[feature]).toBe(true);
                assertSubmittedFeatures(restored);
            }
            await testInfo.attach('garden-feature-pixel-contributions', {
                body: JSON.stringify(featureReport, null, 2),
                contentType: 'application/json'
            });
            await page.locator('.details-panel > summary').click();

            // The final capture must release its pause before natural ticker submissions resume.
            await captureScene(page);
            const live = await waitForLiveFrames(page, 2);
            expect(live.features).toEqual({
                gi: true,
                volumetric: true,
                decals: true,
                transparency: true
            });
            assertSubmittedFeatures(live);
            await assertGPUHealth(page);
            await page.evaluate(async () => {
                const api = (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__;
                if (!api) throw new Error('Garden controls missing before teardown');
                await api.dispose();
                await new Promise<void>(resolve =>
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() => {
                            resolve();
                        })
                    )
                );
            });
            const disposed = await page.evaluate(() =>
                (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__?.diagnostics()
            );
            expect(disposed?.disposed).toBe(true);
            await assertGPUHealth(page);
            failures.assertEmpty('Rain tea garden, including post-teardown observation');
        } finally {
            await failures.dispose();
        }
    });
}

testFeatureComparison('rain tea garden compares GI and volumetric lighting @webgpu', [
    'gi',
    'volumetric'
]);
testFeatureComparison('rain tea garden compares decals and weighted transparency @webgpu', [
    'decals',
    'transparency'
]);

test('rain tea garden stays interactive across camera views and page lifecycle @webgpu', async ({
    page
}, testInfo) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 960, height: 640 });
    const failures = await installPageFailureMonitor(page);
    try {
        await page.goto(gardenRequestURL(testInfo), {
            waitUntil: 'load'
        });
        await page.waitForFunction(
            () =>
                document.body.dataset['rainTeaGardenReady'] === 'true' ||
                document.body.dataset['rainTeaGardenFailed'] !== undefined,
            undefined,
            { timeout: 120_000 }
        );
        expect(await page.locator('body').getAttribute('data-rain-tea-garden-failed')).toBeNull();
        await expect(page.locator('body')).toHaveAttribute('data-rain-tea-garden-ready', 'true');
        const canvas = page.locator('canvas[data-hilo3d-backend="webgpu"]');
        await expect(canvas).toHaveCount(1);
        await page.locator('button[data-preset="evening"]').click();
        const ready = await settle(page, 108);
        expect(ready.preset).toBe('evening');
        expect(ready.motion).toBe(false);
        expect(ready.features).toEqual({
            gi: true,
            volumetric: true,
            decals: true,
            transparency: true
        });
        assertSubmittedFeatures(ready);

        // Every input happens after stable captures: capture pause must not strand the live ticker.
        const beforeCameraFrame = await captureScene(page);
        const beforeOrbit = await waitForLiveFrames(page);
        const bounds = await canvas.boundingBox();
        if (!bounds) throw new Error('Garden canvas has no layout box');
        const x = bounds.x + bounds.width * 0.6;
        const y = bounds.y + bounds.height * 0.52;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 90, y - 28, { steps: 8 });
        await page.mouse.up();
        const afterOrbit = await waitForLiveFrames(page, 12);
        expect(afterOrbit.camera.position).not.toEqual(beforeOrbit.camera.position);
        expect(afterOrbit.submittedFrames).toBeGreaterThan(beforeOrbit.submittedFrames);
        const orbited = await captureScene(page);
        expect(difference(beforeCameraFrame, orbited).changedRatio).toBeGreaterThan(0.03);
        await page.mouse.wheel(0, 120);
        const afterDolly = await waitForLiveFrames(page, 12);
        expect(afterDolly.camera.position).not.toEqual(afterOrbit.camera.position);
        await page.locator('#viewButton').click();
        const nextView = await waitForLiveFrames(page, 12);
        expect(nextView.view).not.toBe(afterDolly.view);
        expect(nextView.camera.position).not.toEqual(afterDolly.camera.position);

        await page.setViewportSize({ width: 390, height: 844 });
        const portraitState = await settle(page, 24);
        expect(portraitState.submittedFrames).toBeGreaterThan(nextView.submittedFrames);
        expect(portraitState.camera.position).toEqual(nextView.camera.position);
        expect(portraitState.camera.target).toEqual(nextView.camera.target);
        const layout = await canvas.evaluate(element => ({
            width: element.clientWidth,
            height: element.clientHeight,
            backingWidth: (element as HTMLCanvasElement).width,
            backingHeight: (element as HTMLCanvasElement).height,
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth
        }));
        expect(layout.width).toBeGreaterThan(0);
        expect(layout.width).toBeLessThanOrEqual(390);
        expect(layout.height).toBeGreaterThan(0);
        expect(layout.backingWidth).toBeGreaterThan(0);
        expect(layout.backingHeight).toBeGreaterThan(0);
        expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
        const portraitEvening = await captureScene(page);
        await attachImage(testInfo, 'garden-portrait', await captureStableFrame(page, 'webgpu'));
        await page.locator('button[data-preset="morning"]').click();
        expect((await settle(page, 36)).preset).toBe('morning');
        const portraitMorning = await captureScene(page);
        expect(difference(portraitEvening, portraitMorning).changedRatio).toBeGreaterThan(0.1);

        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        });
        const retained = await page.evaluate(async () => {
            await new Promise<void>(resolve =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                        resolve();
                    })
                )
            );
            return (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__?.diagnostics();
        });
        expect(retained?.disposed).toBe(false);
        // Cover the capture control's pending backpressure continuation while the page is retained.
        await page.waitForTimeout(150);
        const stillRetained = await page.evaluate(() =>
            (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__?.diagnostics()
        );
        expect(stillRetained?.submittedFrames).toBe(retained?.submittedFrames);
        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });
        const resumed = await waitForLiveFrames(page);
        expect(resumed.submittedFrames).toBeGreaterThan(retained?.submittedFrames ?? Infinity);
        await assertGPUHealth(page);
        await page.evaluate(async () => {
            const api = (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__;
            if (!api) throw new Error('Garden controls missing before teardown');
            await api.dispose();
            await new Promise<void>(resolve =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                        resolve();
                    })
                )
            );
        });
        const disposed = await page.evaluate(() =>
            (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__?.diagnostics()
        );
        expect(disposed?.disposed).toBe(true);
        await assertGPUHealth(page);
        failures.assertEmpty('Rain tea garden, including post-teardown observation');
    } finally {
        await failures.dispose();
    }
});

test('rain tea garden releases resources after an initialization rendering failure @webgpu', async ({
    page
}, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 960, height: 640 });
    const failures = await installPageFailureMonitor(page);
    await page.addInitScript(() => {
        const observer = new MutationObserver(() => {
            if (document.querySelector('body')?.dataset['rainTeaGardenPhase'] !== 'warming') return;
            observer.disconnect();
            // Fail the second real presentation, after a complete warmup submission allocated resources.
            const getCurrentTexture = Object.getOwnPropertyDescriptor(
                GPUCanvasContext.prototype,
                'getCurrentTexture'
            )?.value as ((this: GPUCanvasContext) => GPUTexture) | undefined;
            if (getCurrentTexture === undefined)
                throw new Error('Garden presentation method unavailable');
            GPUCanvasContext.prototype.getCurrentTexture = function (): GPUTexture {
                GPUCanvasContext.prototype.getCurrentTexture = getCurrentTexture;
                document.body.dataset['testWarmupFailureInjected'] = 'true';
                throw new Error('Injected tea garden warmup failure');
            };
            const destroyDevice = Object.getOwnPropertyDescriptor(GPUDevice.prototype, 'destroy')
                ?.value as ((this: GPUDevice) => void) | undefined;
            if (destroyDevice === undefined)
                throw new Error('Garden device cleanup method unavailable');
            document.body.dataset['testWarmupFailureDestroyCount'] = '0';
            GPUDevice.prototype.destroy = function (this: GPUDevice): void {
                const count = Number(document.body.dataset['testWarmupFailureDestroyCount']);
                document.body.dataset['testWarmupFailureDestroyCount'] = String(count + 1);
                destroyDevice.call(this);
            };
        });
        observer.observe(document, { subtree: true, attributes: true });
    });
    try {
        await page.goto(gardenRequestURL(testInfo), { waitUntil: 'load' });
        await expect(page.locator('body')).toHaveAttribute('data-rain-tea-garden-ready', 'error', {
            timeout: 90_000
        });
        await expect(page.locator('body')).toHaveAttribute(
            'data-test-warmup-failure-injected',
            'true'
        );
        await expect(page.locator('body')).toHaveAttribute('data-rain-tea-garden-disposed', 'true');
        await expect(page.locator('body')).toHaveAttribute(
            'data-test-warmup-failure-destroy-count',
            '1'
        );
        await expect(page.locator('#loadingPanel')).toBeVisible();
        await expect(page.locator('#loadingDetail')).toHaveText(
            'Injected tea garden warmup failure'
        );
        expect(
            await page.evaluate(
                () => (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__ === undefined
            )
        ).toBe(true);
        const stopped = nativeRenderProgress(await readRenderHealth(page), 'webgpu');
        expect(stopped.drawCalls).toBeGreaterThan(0);
        expect(stopped.queueSubmissions).toBeGreaterThan(0);
        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        });
        await page.waitForTimeout(150);
        expect(nativeRenderProgress(await readRenderHealth(page), 'webgpu')).toEqual(stopped);
        await expect(page.locator('body')).toHaveAttribute(
            'data-test-warmup-failure-destroy-count',
            '1'
        );
        await assertGPUHealth(page);
        const observed = failures.snapshot();
        expect(observed.consoleErrors).toHaveLength(1);
        expect(observed.consoleErrors[0]).toContain('Injected tea garden warmup failure');
        expect(observed.pageErrors).toEqual([]);
        expect(observed.graphicsErrors).toEqual([]);
        expect(observed.failedRequests).toEqual([]);
        expect(observed.failedResponses).toEqual([]);
    } finally {
        await failures.dispose();
    }
});

for (const persisted of [true, false]) {
    test(`rain tea garden handles ${persisted ? 'retained' : 'final'} pagehide during warmup @webgpu`, async ({
        page
    }, testInfo) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 960, height: 640 });
        const failures = await installPageFailureMonitor(page);
        await page.addInitScript(retain => {
            // Observe the first completed warmup submission, before ready/API publication.
            // Dispatch in the observer microtask so fast physical GPUs cannot race past this case.
            const observer = new MutationObserver(() => {
                const body = document.querySelector('body');
                if (body?.dataset['rainTeaGardenPhase'] !== 'warming') return;
                observer.disconnect();
                document.body.dataset['testWarmupPagehide'] = 'true';
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: retain }));
            });
            observer.observe(document, { subtree: true, attributes: true });
        }, persisted);
        try {
            await page.goto(gardenRequestURL(testInfo), {
                waitUntil: 'load'
            });
            await expect(page.locator('body')).toHaveAttribute(
                'data-test-warmup-pagehide',
                'true',
                {
                    timeout: 90_000
                }
            );
            await awaitTrackedGPUQueues(page);
            const paused = nativeRenderProgress(await readRenderHealth(page), 'webgpu');
            expect(paused.drawCalls).toBeGreaterThan(0);
            expect(paused.queueSubmissions).toBeGreaterThan(0);
            // Include the capture control's pending 50 ms continuation and delayed browser errors.
            await page.waitForTimeout(150);
            const retained = nativeRenderProgress(await readRenderHealth(page), 'webgpu');
            expect(retained.drawCalls).toBe(paused.drawCalls);
            expect(retained.canvasAcquisitions).toBe(paused.canvasAcquisitions);
            expect(await page.locator('body').getAttribute('data-rain-tea-garden-ready')).not.toBe(
                'true'
            );
            expect(
                await page.locator('body').getAttribute('data-rain-tea-garden-failed')
            ).toBeNull();
            if (persisted) {
                await page.evaluate(() => {
                    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
                });
                await expect(page.locator('body')).toHaveAttribute(
                    'data-rain-tea-garden-ready',
                    'true',
                    {
                        timeout: 90_000
                    }
                );
                const resumed = await waitForLiveFrames(page);
                expect(resumed.disposed).toBe(false);
                expect(
                    nativeRenderProgressAdvanced(
                        retained,
                        nativeRenderProgress(await readRenderHealth(page), 'webgpu'),
                        'webgpu'
                    )
                ).toBe(true);
                await page.evaluate(async () => {
                    await (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__?.dispose();
                });
            } else {
                await expect(page.locator('body')).toHaveAttribute(
                    'data-rain-tea-garden-disposed',
                    'true'
                );
                // Final navigation must not publish a usable API after disposing a partial scene.
                expect(
                    await page.evaluate(
                        () => (window as GardenWindow).__HILO_RAIN_TEA_GARDEN__ === undefined
                    )
                ).toBe(true);
            }
            await assertGPUHealth(page);
            failures.assertEmpty('Rain tea garden warmup lifecycle, including teardown');
        } finally {
            await failures.dispose();
        }
    });
}
