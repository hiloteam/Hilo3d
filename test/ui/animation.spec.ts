import { expect, test } from '@playwright/test';

for (const backend of ['webgl2', 'webgpu']) {
    test(`creature animation blends and triggers interactions @${backend}`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`animation.html?backend=${backend}`);
        await expect(page.locator('body')).toHaveAttribute('data-animation-ready', 'true');
        await expect(page.locator('body')).toHaveAttribute('data-animation-model', 'BlockCreature');
        await expect(page.locator('body')).toHaveAttribute('data-animation-clip-count', '6');
        await page.screenshot({ path: test.info().outputPath('creature.png') });
        await page.getByRole('button', { name: 'Run', exact: true }).click();
        await expect(page.locator('body')).toHaveAttribute('data-animation-motion', 'Run');
        await page.getByRole('button', { name: 'Sleep', exact: true }).click();
        await expect(page.locator('body')).toHaveAttribute('data-animation-motion', 'Sleep');
        await expect(page.locator('body')).toHaveAttribute('data-animation-body-scale', '0.60');
        await page.getByRole('slider', { name: 'Speed', exact: true }).fill('1.5');
        await expect(page.locator('body')).toHaveAttribute('data-animation-motion', 'Locomotion');
        await page.getByRole('slider', { name: 'Head attention' }).fill('0.7');
        await page.getByRole('button', { name: 'Attack', exact: true }).click();
        // Latch the semantic event so a slow CI poll cannot miss the short visual flash.
        await expect(page.locator('body')).toHaveAttribute('data-animation-effect-count', '1');
        await expect(page.locator('body')).toHaveAttribute('data-animation-motion', 'Locomotion');
        await expect(page.locator('body')).toHaveAttribute('data-animation-effect', 'false');
        // A cached page must remain usable; final disposal must cancel the ticker before
        // destroying the animation, including RAF callbacks after the pagehide event.
        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });
        await page.getByRole('button', { name: 'Run', exact: true }).click();
        await expect(page.locator('body')).toHaveAttribute('data-animation-motion', 'Run');
        await page.evaluate(async () => {
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
            for (let frame = 0; frame < 3; frame++) {
                await new Promise<void>(resolve => {
                    requestAnimationFrame(() => {
                        resolve();
                    });
                });
            }
        });
        expect(errors).toEqual([]);
    });
}
