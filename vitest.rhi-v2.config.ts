import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import { createViteConfig } from './vite.config';

/** RHI v2 suites deliberately avoid the legacy WebGL-native global test fixture. */
export default mergeConfig(
    createViteConfig(),
    defineConfig({
        test: {
            name: 'rhi-v2-browser',
            globals: false,
            clearMocks: true,
            restoreMocks: true,
            unstubEnvs: true,
            unstubGlobals: true,
            include: [
                'test/spec/rhi/v2/**/*.test.ts',
                'test/spec/renderer/Renderer.test.ts',
                'test/spec/renderer/RenderPerformanceArchitecture.test.ts'
            ],
            testTimeout: 10_000,
            hookTimeout: 10_000,
            browser: {
                enabled: true,
                headless: true,
                provider: playwright({
                    launchOptions: {
                        args: [
                            '--enable-unsafe-swiftshader',
                            '--enable-unsafe-webgpu',
                            '--use-angle=swiftshader',
                            '--use-webgpu-adapter=swiftshader'
                        ]
                    }
                }),
                instances: [{ browser: 'chromium' }]
            }
        }
    })
);
