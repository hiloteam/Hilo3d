import { expect, test } from '@playwright/test';

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`@visual renders a deterministic ECS PBR scene through ${backend}`, async ({ page }) => {
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        page.on('console', message => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', error => pageErrors.push(error.message));

        await page.goto(`/test/ui/fixtures/visual.html?backend=${backend}`, {
            waitUntil: 'load'
        });
        await page.waitForFunction(() => window.__HILO3D_VISUAL_FIRST_FRAME__ !== undefined);

        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
        expect(await page.evaluate(() => window.__HILO3D_VISUAL_FIRST_FRAME__?.backend)).toBe(
            backend
        );
        await expect(page.locator('canvas')).toHaveScreenshot(`ecs-lit-pbr-scene-${backend}.png`, {
            animations: 'disabled',
            maxDiffPixelRatio: 0.005
        });

        await page.evaluate(() => window.__HILO3D_VISUAL_CONTINUE__?.());
        await page.waitForFunction(() => window.__HILO3D_VISUAL_RESULT__ !== undefined);
        const result = await page.evaluate(() => window.__HILO3D_VISUAL_RESULT__);
        expect(result?.backend).toBe(backend);
        expect(result?.readback.backgroundPixel).toEqual([20, 26, 36, 255]);
        expect(result?.readback.transformedPixelCount).toBeGreaterThan(500);
        expect(result?.readback.directionalLightPixelCount).toBeGreaterThan(500);
        expect(result?.readback.litForegroundColorCount).toBeGreaterThan(2);
        expect(result?.readback.viewportBytes).toEqual([0, 0, 37, 23]);
    });
}

test('@visual WebGPU ECS output matches WebGL2 exactly', async ({ page }) => {
    const failures: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') failures.push(message.text());
    });
    page.on('pageerror', error => failures.push(error.message));

    const capture = async (backend: 'webgl2' | 'webgpu'): Promise<Buffer> => {
        await page.goto(`/test/ui/fixtures/visual.html?backend=${backend}`, {
            waitUntil: 'load'
        });
        await page.waitForFunction(() => window.__HILO3D_VISUAL_FIRST_FRAME__ !== undefined);
        return page.locator('canvas').screenshot({ animations: 'disabled' });
    };

    const webgl2 = await capture('webgl2');
    const webgpu = await capture('webgpu');
    expect(failures).toEqual([]);
    expect(webgpu.equals(webgl2), 'WebGPU canvas pixels must match WebGL2').toBe(true);
});
