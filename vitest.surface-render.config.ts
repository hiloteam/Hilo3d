import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import { createViteConfig } from './vite.config';

/** Real WebGPU canvas composition runs in the required macOS lane with the full compositor. */
export default mergeConfig(
    createViteConfig(),
    defineConfig({
        test: {
            name: 'surface-render',
            globals: false,
            clearMocks: true,
            restoreMocks: true,
            unstubEnvs: true,
            unstubGlobals: true,
            include: ['test/surface-render/**/*.test.ts'],
            fileParallelism: false,
            testTimeout: 10_000,
            hookTimeout: 10_000,
            browser: {
                enabled: true,
                headless: true,
                provider: playwright({
                    launchOptions: {
                        // Multi-camera views exercise canvas presentation as well as offscreen readbacks.
                        channel: 'chromium',
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
