import { defineConfig, mergeConfig } from 'vitest/config';
import { createViteConfig } from './vite.config';

export default mergeConfig(
    createViteConfig(),
    defineConfig({
        test: {
            name: 'physics-ecs',
            include: [
                'test/spec/physics/PhysicsEcsSystem.test.ts',
                'test/spec/physics/RapierPhysics.test.ts'
            ],
            environment: 'node',
            globals: false,
            browser: { enabled: false }
        }
    })
);
