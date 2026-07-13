import { expect, test } from '@playwright/test';

test('renders a real frame through WebGPU and Naga', async ({ page }) => {
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
        drawCount: 4,
        faceCount: 60,
        hasShadowAtlas: true,
        shadowLightKinds: { directional: 1, point: 1, spot: 1 },
        renderTargetAttachments: 1,
        renderTargetSampleCount: 4,
        renderTargetHasStencil: true,
        readbackByteLength: 4,
        readbackHasContent: true,
        mrtAttachments: 2,
        mrtReadbacksHaveContent: true,
        textureRevisionAdvanced: true,
        gpuErrors: []
    });
});
