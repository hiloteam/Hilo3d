import { expect, test } from '@playwright/test';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    installRenderHealthProbe,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';

test('renders a real frame through WebGPU and Naga', async ({ page }) => {
    await installRenderHealthProbe(page);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto('/test/ui/fixtures/webgpu.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__HILO3D_WEBGPU_RESULT__ !== undefined);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await expect(page.locator('canvas')).toBeVisible();
    expect(await page.evaluate(() => window.__HILO3D_WEBGPU_RESULT__)).toEqual({
        backend: 'webgpu',
        rhiExtensionBackend: 'webgpu',
        rhiSurfaceState: 'configured',
        // Production RenderInfo includes the main pass plus directional, spot, and cube-shadow draws.
        drawCount: 52,
        faceCount: 60,
        hasShadowAtlas: true,
        shadowLightKinds: { directional: 1, point: 1, spot: 1 },
        renderTargetAttachments: 1,
        renderTargetSampleCount: 4,
        renderTargetHasStencil: true,
        readbackByteLength: 4,
        readbackHasContent: true,
        clearColorReadback: [31, 61, 92, 255],
        mrtAttachments: 2,
        mrtReadbacksHaveContent: true,
        textureRevisionAdvanced: true,
        recoveryState: 'ready',
        recoveryDeviceChanged: true,
        recoveryTargetIdentityPreserved: true,
        recoveryTextureImageReleasedBefore: true,
        recoveryTextureImageReleasedAfter: true,
        recoveryReadbackHasContent: true,
        recoveryProbeHasSceneContent: true,
        recoveryReadbackMatches: true,
        deviceLostEvents: 1,
        deviceRestoredEvents: 1,
        extendedSamplerTypes: [
            'sampler3D',
            'sampler2DArray',
            'sampler2DArrayShadow',
            'usampler2DArray',
            'sampler2D',
            'sampler2D',
            'sampler2D'
        ],
        extendedTextureDimensions: ['3d', '2d-array', '2d-array', '2d-array', '2d', '2d', '2d'],
        extendedSamplerReadback: [64, 128, 200, 255],
        extendedSamplerCompilationErrors: [],
        extendedSamplerValidationError: null,
        extendedGpuSubmissionCompleted: true,
        offscreenStencilReadback: [255, 0, 0, 255],
        offscreenStencilStableAcrossFrames: true
    });
    await assertStableInstrumentationHealth('webgpu', 'portable WebGPU fixture health', {
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });
});

test('closes the high-end clustered transparent, particle, and recovery P0 gate', async ({
    page
}) => {
    test.setTimeout(30_000);
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

    await page.goto('/test/ui/fixtures/clustered-forward-plus-p0.html', {
        waitUntil: 'load'
    });
    await page.waitForFunction(
        () => window.__HILO3D_CLUSTERED_FORWARD_PLUS_P0_RESULT__ !== undefined,
        undefined,
        { timeout: 25_000 }
    );
    const result = await page.evaluate(() => window.__HILO3D_CLUSTERED_FORWARD_PLUS_P0_RESULT__);
    await devtools.detach();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(gpuValidationErrors).toEqual([]);
    expect(result).toMatchObject({
        nativeTransparent: true,
        nativeDeformedLayered: true,
        particleTemporalComposition: true,
        transparentResurrection: true,
        recoveryHistoryInitialized: true,
        recoveryDeviceChanged: true,
        warmedMaterialVariantCount: 1,
        activeMaterialVariantCount: 3,
        materialVariantBudgetExceededCount: 0,
        clusteredTransparentObjectCount: 2,
        clusteredDeformedObjectCount: 1,
        fallbackObjectCount: 0,
        mixedTransparencyFallback: true
    });
    expect(result?.litEnergy).toBeGreaterThan(1_000);
    expect(result?.excludedEnergy).toBeLessThan((result?.litEnergy ?? 0) * 0.75);
    expect(result?.recoveredEnergy).toBeGreaterThan(1_000);
});

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`runs the same scriptable forward feature through ${backend}`, async ({ page }) => {
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

        await page.goto(`/examples/scriptable_pipeline.html?backend=${backend}`, {
            waitUntil: 'load'
        });
        await page.waitForFunction(
            () => window.__HILO3D_SCRIPTABLE_PIPELINE_RESULT__ !== undefined
        );

        const result = await page.evaluate(() => window.__HILO3D_SCRIPTABLE_PIPELINE_RESULT__);
        await devtools.detach();
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
        expect(gpuValidationErrors).toEqual([]);
        expect(result?.backend).toBe(backend);
        expect(result?.drawCount).toBeGreaterThanOrEqual(4);
        expect(result?.faceCount).toBeGreaterThan(0);
        expect(result?.hasShadowAtlas).toBe(true);
    });

    test(`renders native compressed KTX textures through ${backend}`, async ({ page }) => {
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

        await page.goto(`/examples/compressed_texture.html?backend=${backend}`, {
            waitUntil: 'load'
        });
        await page.waitForFunction(() => window.__HILO3D_COMPRESSED_TEXTURE_RESULT__ !== undefined);

        const result = await page.evaluate(() => window.__HILO3D_COMPRESSED_TEXTURE_RESULT__);
        await devtools.detach();
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
        expect(result?.backend).toBe(backend);
        expect(result?.renderedSources).toEqual(result?.supportedSources);
        expect(gpuValidationErrors).toEqual([]);
        if (backend === 'webgpu') {
            expect(result?.supportedSources.length).toBeGreaterThan(0);
            expect(result?.skipped).toContain(
                'pvrtc: native pvrtc texture compression is unavailable'
            );
        }
    });

    test(`asynchronously GPU-picks the same mesh through ${backend}`, async ({ page }) => {
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        page.on('console', message => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', error => pageErrors.push(error.message));

        await page.goto(`/test/ui/fixtures/mesh-picker.html?backend=${backend}`, {
            waitUntil: 'load'
        });
        await page.waitForFunction(() => window.__HILO3D_MESH_PICKER_RESULT__ !== undefined);

        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
        expect(await page.evaluate(() => window.__HILO3D_MESH_PICKER_RESULT__)).toEqual({
            backend,
            selectedCount: 1,
            selectedExpectedMesh: true
        });
    });
}

declare global {
    interface Window {
        __HILO3D_SCRIPTABLE_PIPELINE_RESULT__?: {
            readonly backend: 'webgl2' | 'webgpu';
            readonly drawCount: number;
            readonly faceCount: number;
            readonly hasShadowAtlas: boolean;
        };
        __HILO3D_COMPRESSED_TEXTURE_RESULT__?: {
            readonly backend: 'webgl2' | 'webgpu';
            readonly supportedSources: readonly string[];
            readonly renderedSources: readonly string[];
            readonly skipped: readonly string[];
        };
        __HILO3D_CLUSTERED_FORWARD_PLUS_P0_RESULT__?: {
            readonly litEnergy: number;
            readonly excludedEnergy: number;
            readonly recoveredEnergy: number;
            readonly nativeTransparent: boolean;
            readonly nativeDeformedLayered: boolean;
            readonly particleTemporalComposition: boolean;
            readonly transparentResurrection: boolean;
            readonly recoveryHistoryInitialized: boolean;
            readonly recoveryDeviceChanged: boolean;
            readonly warmedMaterialVariantCount: number;
            readonly activeMaterialVariantCount: number;
            readonly materialVariantBudgetExceededCount: number;
            readonly clusteredTransparentObjectCount: number;
            readonly clusteredDeformedObjectCount: number;
            readonly fallbackObjectCount: number;
            readonly mixedTransparencyFallback: boolean;
        };
    }
}
