import { expect, test } from '@playwright/test';

test('glTF prefab survives repeated ECS frame extraction @webgl2', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('gltf.html?backend=webgl2', { waitUntil: 'load' });
    await expect(page.locator('canvas')).toBeVisible();
    await page.waitForFunction(
        () =>
            (window.__HILO_ECS_STATUS__?.submittedFrameCount ?? 0) >= 4 &&
            (window.__HILO_ECS_STATUS__?.lightCount ?? 0) >= 2,
        undefined,
        { timeout: 20_000 }
    );
    expect(errors).toEqual([]);
});
