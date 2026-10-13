import { defineConfig } from '@playwright/test';

/** Round-trip the production Studio download into a separate static-hosted Player. */
export default defineConfig({
    testDir: './test/ui',
    testMatch: 'player-export.spec.ts',
    outputDir: 'test-results/player-export',
    workers: 1,
    retries: 0,
    timeout: 120_000,
    expect: { timeout: 10_000 },
    forbidOnly: process.env['CI'] === 'true',
    reporter: [['list']],
    use: {
        browserName: 'chromium',
        channel: 'chromium',
        viewport: { width: 1440, height: 960 },
        deviceScaleFactor: 1,
        trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true },
        screenshot: 'only-on-failure',
        launchOptions: {
            args: [
                '--enable-unsafe-swiftshader',
                '--enable-unsafe-webgpu',
                '--use-angle=swiftshader',
                '--use-webgpu-adapter=swiftshader'
            ]
        }
    }
});
