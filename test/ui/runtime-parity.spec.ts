import { expect, test } from '@playwright/test';

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`ECS composition remains interactive on ${backend} @${backend}`, async ({ page }) => {
        await page.goto(`composition.html?backend=${backend}`, { waitUntil: 'load' });
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();
        await page.waitForFunction(
            () => (window.__HILO_ECS_STATUS__?.submittedFrameCount ?? 0) >= 2,
            undefined,
            { timeout: 20_000 }
        );
        const before = await canvas.screenshot();
        const box = await canvas.boundingBox();
        if (!box) throw new Error('ECS composition canvas has no layout box.');
        await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.45, { steps: 4 });
        await page.mouse.up();
        const submittedBefore = await page.evaluate(
            () => window.__HILO_ECS_STATUS__?.submittedFrameCount ?? 0
        );
        await page.waitForFunction(
            previous => (window.__HILO_ECS_STATUS__?.submittedFrameCount ?? 0) > previous,
            submittedBefore,
            { timeout: 20_000 }
        );
        const after = await canvas.screenshot();
        expect(after.equals(before)).toBe(false);
    });
}
