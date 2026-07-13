import { expect, test } from '@playwright/test';

test('@visual renders a deterministic lit PBR scene', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto('/test/ui/fixtures/visual.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__HILO3D_VISUAL_READY__ === true);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await expect(page.locator('canvas')).toHaveScreenshot('lit-pbr-scene.png', {
        animations: 'disabled',
        maxDiffPixelRatio: 0.005
    });
});
