import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { installPageFailureMonitor } from './page-failure-monitor';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    completedRenderCommands,
    installRenderHealthProbe,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';

interface LumenEvidence {
    readonly backend: 'webgpu';
    readonly activeLights: number;
    readonly lightCount: number;
    readonly objectCount: number;
    readonly visibleObjectCount: number;
    readonly fallbackObjectCount: number;
    readonly clusterLightIndexCount: number;
    readonly clusterOverflowCount: number;
    readonly droppedLightCount: number;
    readonly motionEnabled: boolean;
    readonly movingLightCount: number;
    readonly lightDirectionChecksum: number;
    readonly palette: string;
    readonly intensity: number;
    readonly elapsed: number;
}

interface LumenTestAPI {
    settle(frames?: number): Promise<LumenEvidence>;
}

async function settle(page: Page, frames = 4): Promise<LumenEvidence> {
    return page.evaluate(async frameCount => {
        const api = (
            window as Window & {
                readonly __HILO3D_LUMEN_TEST_API__?: LumenTestAPI;
            }
        ).__HILO3D_LUMEN_TEST_API__;
        if (api === undefined) throw new Error('Lumen did not expose its settled-frame evidence');
        return api.settle(frameCount);
    }, frames);
}

async function setSlider(page: Page, selector: string, value: number): Promise<LumenEvidence> {
    await page.locator(selector).evaluate((element, nextValue) => {
        if (!(element instanceof HTMLInputElement)) {
            throw new TypeError('Lumen control must be an input element');
        }
        element.value = String(nextValue);
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    return settle(page, 6);
}

function assertClusteredEvidence(evidence: LumenEvidence, activeLights: number): void {
    expect(evidence).toMatchObject({
        backend: 'webgpu',
        activeLights,
        lightCount: activeLights + 1,
        fallbackObjectCount: 0,
        droppedLightCount: 0,
        clusterOverflowCount: 0
    });
    expect(evidence.objectCount).toBeGreaterThan(100);
    expect(evidence.visibleObjectCount).toBeGreaterThan(0);
    expect(evidence.visibleObjectCount).toBeLessThanOrEqual(evidence.objectCount);
    expect(evidence.clusterLightIndexCount).toBeGreaterThan(0);
}

function changedPixelRatio(referenceBuffer: Buffer, candidateBuffer: Buffer): number {
    const reference = PNG.sync.read(referenceBuffer);
    const candidate = PNG.sync.read(candidateBuffer);
    expect(candidate.width).toBe(reference.width);
    expect(candidate.height).toBe(reference.height);
    let changed = 0;
    for (let offset = 0; offset < reference.data.length; offset += 4) {
        const delta = Math.max(
            Math.abs((reference.data[offset] ?? 0) - (candidate.data[offset] ?? 0)),
            Math.abs((reference.data[offset + 1] ?? 0) - (candidate.data[offset + 1] ?? 0)),
            Math.abs((reference.data[offset + 2] ?? 0) - (candidate.data[offset + 2] ?? 0))
        );
        if (delta > 8) changed++;
    }
    return changed / (reference.width * reference.height);
}

test('Lumen renders material multi-light changes through Clustered Forward+ @webgpu', async ({
    page
}, testInfo) => {
    test.setTimeout(180_000);
    await installRenderHealthProbe(page);
    const failures = await installPageFailureMonitor(page);
    try {
        await page.setViewportSize({ width: 960, height: 600 });
        await page.goto('/examples/clustered_forward_plus_lumen.html?backend=webgpu&test=1', {
            waitUntil: 'load'
        });
        await expect(page.locator('body')).toHaveAttribute('data-lumen-ready', 'true', {
            timeout: 90_000
        });

        const initial = await settle(page);
        assertClusteredEvidence(initial, 144);
        expect(initial.motionEnabled).toBe(false);
        expect(initial.movingLightCount).toBe(4);
        expect(initial.palette).toBe('nocturne');
        const screenshotPath = testInfo.outputPath('lumen-final.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await testInfo.attach('Lumen final', { path: screenshotPath, contentType: 'image/png' });

        const fewerLights = await setSlider(page, '#lightControl', 24);
        assertClusteredEvidence(fewerLights, 24);
        const noLocalLights = await setSlider(page, '#lightControl', 0);
        expect(noLocalLights).toMatchObject({
            activeLights: 0,
            lightCount: 1,
            fallbackObjectCount: 0,
            clusterLightIndexCount: 0,
            clusterOverflowCount: 0,
            droppedLightCount: 0
        });
        const allLights = await setSlider(page, '#lightControl', 192);
        assertClusteredEvidence(allLights, 192);
        expect(allLights.clusterLightIndexCount).toBeGreaterThan(
            fewerLights.clusterLightIndexCount
        );

        const canvas = page.locator('canvas');
        const illuminated = await canvas.screenshot({ animations: 'disabled' });
        const unlitEvidence = await setSlider(page, '#intensityControl', 0);
        expect(unlitEvidence.activeLights).toBe(192);
        expect(unlitEvidence.intensity).toBe(0);
        const unlit = await canvas.screenshot({ animations: 'disabled' });
        // Emissive light markers retain their brightness while the illuminated materials change.
        expect(changedPixelRatio(illuminated, unlit)).toBeGreaterThan(0.005);
        await setSlider(page, '#intensityControl', 100);

        await page.locator('[data-palette="ember"]').click();
        const ember = await settle(page, 6);
        expect(ember.palette).toBe('ember');
        const warm = await canvas.screenshot({ animations: 'disabled' });
        expect(changedPixelRatio(illuminated, warm)).toBeGreaterThan(0.005);
        await page.locator('[data-palette="spectrum"]').click();
        expect((await settle(page)).palette).toBe('spectrum');

        const beforeView = await canvas.screenshot({ animations: 'disabled' });
        await page.locator('#viewButton').click();
        await settle(page, 6);
        const alternateView = await canvas.screenshot({ animations: 'disabled' });
        expect(changedPixelRatio(beforeView, alternateView)).toBeGreaterThan(0.04);

        const paused = await settle(page, 2);
        const beforeMotion = await canvas.screenshot({ animations: 'disabled' });
        await page.locator('#motionToggle').click();
        const moving = await settle(page, 60);
        expect(moving.motionEnabled).toBe(true);
        expect(moving.movingLightCount).toBe(4);
        expect(moving.elapsed).toBeGreaterThan(paused.elapsed);
        expect(
            Math.abs(moving.lightDirectionChecksum - paused.lightDirectionChecksum)
        ).toBeGreaterThan(0.01);
        const afterMotion = await canvas.screenshot({ animations: 'disabled' });
        expect(changedPixelRatio(beforeMotion, afterMotion)).toBeGreaterThan(0.005);
        await page.locator('#motionToggle').click();
        const stopped = await settle(page, 2);
        expect(stopped.motionEnabled).toBe(false);
        expect(stopped.elapsed).toBe(moving.elapsed);
        expect(stopped.lightDirectionChecksum).toBe(moving.lightDirectionChecksum);

        const health = await readRenderHealth(page);
        expect(completedRenderCommands(health, 'webgpu')).toBeGreaterThan(0);
        expect(
            health.reduce((sum, frame) => sum + (frame.snapshot.webgpuIndirectDrawCalls ?? 0), 0)
        ).toBeGreaterThan(0);
        await assertStableInstrumentationHealth('webgpu', 'Lumen Forward+ lighting', {
            waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
            awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
            readRenderHealth: () => readRenderHealth(page)
        });
        failures.assertEmpty('Lumen Forward+ browser failures');
    } finally {
        await failures.dispose();
    }
});
