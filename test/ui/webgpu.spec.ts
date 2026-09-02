import { expect, test } from '@playwright/test';

test('submits the ECS quick-start scene through explicit WebGPU @webgpu', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('quickStart.html?backend=webgpu', { waitUntil: 'load' });
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(
        () => {
            const status = window.__HILO_ECS_STATUS__;
            return status?.backend === 'webgpu' && status.submittedFrameCount >= 2;
        },
        undefined,
        { timeout: 20_000 }
    );
    expect(errors).toEqual([]);
});
