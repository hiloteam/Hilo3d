import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import { createViteConfig } from './vite.config';

/** Native WebGPU runs in an isolated Chromium/GPU process after the portable RHI suite. */
export default mergeConfig(
    createViteConfig(),
    defineConfig({
        test: {
            name: 'rhi-native-webgpu',
            globals: false,
            clearMocks: true,
            restoreMocks: true,
            unstubEnvs: true,
            unstubGlobals: true,
            include: ['test/spec/rhi/portable/**/*.native.test.ts'],
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
