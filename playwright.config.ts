import { defineConfig } from '@playwright/test';

const isContinuousIntegration = process.env['CI'] === 'true';
const loopbackHosts = ['127.0.0.1', 'localhost'];
const noProxyHosts = new Set(
    (process.env['NO_PROXY'] ?? process.env['no_proxy'] ?? '')
        .split(',')
        .map(host => host.trim())
        .filter(Boolean)
);
loopbackHosts.forEach(host => noProxyHosts.add(host));
const noProxy = [...noProxyHosts].join(',');
process.env['NO_PROXY'] = noProxy;
process.env['no_proxy'] = noProxy;

export default defineConfig({
    testDir: './test/ui',
    outputDir: 'test-results',
    fullyParallel: true,
    forbidOnly: isContinuousIntegration,
    retries: 0,
    ...(isContinuousIntegration ? { workers: 1 } : {}),
    reporter: isContinuousIntegration
        ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
        : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
    expect: {
        timeout: 10_000,
        toHaveScreenshot: {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.005,
            scale: 'css'
        }
    },
    use: {
        baseURL: 'http://127.0.0.1:4173/examples/',
        colorScheme: 'light',
        deviceScaleFactor: 1,
        locale: 'en-US',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        timezoneId: 'UTC',
        video: 'retain-on-failure',
        viewport: { height: 720, width: 1280 }
    },
    projects: [
        {
            name: 'chromium',
            use: {
                browserName: 'chromium',
                launchOptions: {
                    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
                }
            }
        }
    ],
    snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-linux{ext}',
    webServer: {
        command: 'npm run examples:serve',
        reuseExistingServer: !isContinuousIntegration,
        timeout: 120_000,
        url: 'http://127.0.0.1:4173/examples/list.html'
    }
});
