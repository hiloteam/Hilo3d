import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type UserConfig } from 'vite';
import packageJson from './package.json' with { type: 'json' };

const shaderPattern = /\.(?:frag|glsl|vert)$/u;

export function shaderIncludePlugin(): Plugin {
    const includePattern = /^([\t ]*)#include\s+['"](.+?)['"][\t ]*$/gmu;

    const inlineImports = (
        source: string,
        id: string,
        onDependency: (path: string) => void,
        stack: readonly string[] = []
    ): string => {
        return source.replace(includePattern, (_match, indentation: string, request: string) => {
            const dependency = resolve(dirname(id), request);
            if (stack.includes(dependency)) {
                throw new Error(`Circular GLSL import: ${[...stack, dependency].join(' -> ')}`);
            }
            if (!shaderPattern.test(dependency)) {
                throw new Error(`Shader include must use .glsl, .vert, or .frag: ${dependency}`);
            }
            onDependency(dependency);
            const imported = inlineImports(
                readFileSync(dependency, 'utf8'),
                dependency,
                onDependency,
                [...stack, dependency]
            );
            return imported
                .split('\n')
                .map(line => `${indentation}${line}`)
                .join('\n');
        });
    };

    const compile = (source: string, id: string, onDependency: (path: string) => void): string => {
        const inlined = inlineImports(source, id, onDependency, [id]);
        return `export default ${JSON.stringify(inlined)};`;
    };

    return {
        name: 'hilo3d-shader-includes',
        enforce: 'pre',
        load(id) {
            const cleanId = id.split('?', 1)[0];
            if (!cleanId || !shaderPattern.test(cleanId)) return null;
            return {
                code: compile(readFileSync(cleanId, 'utf8'), cleanId, dependency => {
                    this.addWatchFile(dependency);
                }),
                map: null
            };
        },
        transform(source, id) {
            const cleanId = id.split('?', 1)[0];
            if (!cleanId || !shaderPattern.test(cleanId)) return null;
            if (/^\s*export default\s/u.test(source)) return null;
            return {
                code: compile(source, cleanId, dependency => {
                    this.addWatchFile(dependency);
                }),
                map: null
            };
        }
    };
}

const banner = `/*!\n * Hilo3d ${packageJson.version}\n * Copyright (c) 2017-present Alibaba Group Holding Ltd.\n * @license MIT\n */`;

const runtimeDependencies = ['gl-matrix'] as const;

export function createViteConfig(mode: string): UserConfig {
    const isUmdBuild = mode === 'library-umd';

    return {
        plugins: [shaderIncludePlugin()],
        optimizeDeps: {
            include: [...runtimeDependencies]
        },
        define: {
            HILO3D_VERSION: JSON.stringify(packageJson.version)
        },
        build: {
            target: 'es2022',
            sourcemap: true,
            emptyOutDir: !isUmdBuild,
            lib: {
                entry: fileURLToPath(new URL('./src/Hilo3d.ts', import.meta.url)),
                name: 'Hilo3d',
                formats: [isUmdBuild ? 'umd' : 'es'],
                fileName: () => (isUmdBuild ? 'Hilo3d.umd.cjs' : 'Hilo3d.js')
            },
            rolldownOptions: {
                external: isUmdBuild ? [] : [...runtimeDependencies],
                output: {
                    banner
                }
            }
        }
    };
}

export default defineConfig(({ mode }) => createViteConfig(mode));
