import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type UserConfig } from 'vite';
import packageJson from './package.json' with { type: 'json' };

const shaderPattern = /\.(?:frag|glsl|vert)$/u;
const exampleManifestModuleId = 'virtual:hilo3d-example-manifest';
const resolvedExampleManifestModuleId = `\0${exampleManifestModuleId}`;

export const addonAliases = [
    {
        find: '@hilo3d/addon-particle',
        replacement: fileURLToPath(new URL('./addon-particle/src/index.ts', import.meta.url))
    },
    {
        find: '@hilo3d/addon-physics/rapier2d',
        replacement: fileURLToPath(new URL('./addon-physics/src/rapier2d.ts', import.meta.url))
    },
    {
        find: '@hilo3d/addon-physics/rapier3d',
        replacement: fileURLToPath(new URL('./addon-physics/src/rapier3d.ts', import.meta.url))
    },
    {
        find: '@hilo3d/addon-physics',
        replacement: fileURLToPath(new URL('./addon-physics/src/index.ts', import.meta.url))
    },
    {
        find: 'hilo3d',
        replacement: fileURLToPath(new URL('./src/Hilo3d.ts', import.meta.url))
    }
] as const;

function collectHtmlPaths(directory: string, root: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectHtmlPaths(path, root);
        return entry.isFile() && entry.name.endsWith('.html')
            ? [relative(root, path).split(sep).join('/')]
            : [];
    });
}

/** Build-time example discovery shared by the dev server and production gallery. */
export function exampleManifestPlugin(): Plugin {
    const examplesDirectory = fileURLToPath(new URL('./examples/', import.meta.url));
    return {
        name: 'hilo3d-example-manifest',
        resolveId(id) {
            return id === exampleManifestModuleId ? resolvedExampleManifestModuleId : null;
        },
        load(id) {
            if (id !== resolvedExampleManifestModuleId) return null;
            const paths = collectHtmlPaths(examplesDirectory, examplesDirectory).sort();
            for (const path of paths) this.addWatchFile(resolve(examplesDirectory, path));
            return `export default Object.freeze(${JSON.stringify(paths)});`;
        }
    };
}

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

export function createViteConfig(): UserConfig {
    return {
        plugins: [shaderIncludePlugin(), exampleManifestPlugin()],
        resolve: { alias: [...addonAliases] },
        optimizeDeps: {
            include: [...runtimeDependencies]
        },
        define: {
            HILO3D_VERSION: JSON.stringify(packageJson.version)
        },
        build: {
            target: 'es2022',
            sourcemap: true,
            emptyOutDir: true,
            lib: {
                entry: fileURLToPath(new URL('./src/Hilo3d.ts', import.meta.url)),
                formats: ['es'],
                fileName: () => 'Hilo3d.js'
            },
            rolldownOptions: {
                external: [...runtimeDependencies],
                output: {
                    banner
                }
            }
        }
    };
}

export default defineConfig(() => createViteConfig());
