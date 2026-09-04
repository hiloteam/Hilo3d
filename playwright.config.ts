import { defineConfig } from '@playwright/test';

const isContinuousIntegration = process.env['CI'] === 'true';
const swiftShaderArguments = [
    '--enable-unsafe-swiftshader',
    '--enable-unsafe-webgpu',
    '--use-angle=swiftshader',
    '--use-webgpu-adapter=swiftshader'
];
const nativeWebGPUArguments = [
    '--disable-software-rasterizer',
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    process.platform === 'darwin'
        ? '--use-angle=metal'
        : process.platform === 'linux'
          ? '--use-angle=vulkan'
          : '--use-angle=default'
];
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
    timeout: isContinuousIntegration ? 60_000 : 30_000,
    fullyParallel: true,
    workers: 1,
    forbidOnly: isContinuousIntegration,
    retries: 0,
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
        trace: 'off',
        timezoneId: 'UTC',
        // SwiftShader rendering and screenshot/trace/video recording contend for the same GPU
        // process and can prevent a WebGPU device from initializing after WebGL2 coverage. A final
        // failure screenshot retains visual diagnostics without perturbing presentation.
        video: 'off',
        viewport: { height: 720, width: 1280 }
    },
    projects: [
        {
            name: 'chromium',
            use: {
                browserName: 'chromium',
                launchOptions: {
                    args: swiftShaderArguments
                }
            }
        },
        {
            // Explicitly selected only by `npm run test:webgpu:native`; never part of portable CI.
            name: 'chromium-native-webgpu',
            use: {
                browserName: 'chromium',
                launchOptions: {
                    args: nativeWebGPUArguments
                }
            }
        }
    ],
    snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-linux{ext}',
    webServer: {
        command: 'npm run examples:serve',
        reuseExistingServer: !isContinuousIntegration,
        timeout: 120_000,
        url: 'http://127.0.0.1:4173/examples/index.html'
    }
});
