import { defineConfig } from '@playwright/test';

const isContinuousIntegration = process.env['CI'] === 'true';
const swiftShaderArguments = [
    '--enable-unsafe-swiftshader',
    '--enable-unsafe-webgpu',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    // Keep the portable browser project aligned with Chromium's own WebGPU SwiftShader bots.
    // Vulkan-backed Skia is intentionally not forced here: doing so serializes software
    // compositing with the WebGL/WebGPU workload and makes presentation readback unreliable.
    '--enable-dawn-features=allow_unsafe_apis',
    '--disable-dawn-features=use_dxc',
    '--enable-webgpu-developer-features',
    '--use-gpu-in-tests',
    '--enable-accelerated-2d-canvas'
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
        trace: 'retain-on-failure',
        timezoneId: 'UTC',
        // SwiftShader rendering and full-frame video encoding contend for the same CI CPU. Failure
        // screenshots and traces retain the browser diagnostics without perturbing presentation.
        video: isContinuousIntegration ? 'off' : 'retain-on-failure',
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
        url: 'http://127.0.0.1:4173/examples/list.html'
    }
});
