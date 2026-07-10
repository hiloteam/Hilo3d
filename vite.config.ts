import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import glslify from 'glslify';
import { defineConfig, type Plugin } from 'vite';
import packageJson from './package.json' with { type: 'json' };

const shaderPattern = /\.(?:frag|glsl|vert)$/u;

export function glslPlugin(): Plugin {
    const importPattern = /^([\t ]*)#pragma\s+glslify:\s*import\(['"](.+?)['"]\);?[\t ]*$/gmu;
    const exportPattern = /^\s*#pragma\s+glslify:\s*export\(.+?\)\s*$/gmu;

    const inlineImports = (source: string, id: string, stack: readonly string[] = []): string => {
        return source.replace(importPattern, (_match, indentation: string, request: string) => {
            const dependency = resolve(dirname(id), request);
            if (stack.includes(dependency)) {
                throw new Error(`Circular GLSL import: ${[...stack, dependency].join(' -> ')}`);
            }
            const imported = inlineImports(
                readFileSync(dependency, 'utf8'),
                dependency,
                [...stack, dependency]
            ).replace(exportPattern, '');
            return imported
                .split('\n')
                .map(line => `${indentation}${line}`)
                .join('\n');
        });
    };

    const compile = (source: string, id: string): string => {
        const inlined = inlineImports(source, id, [id]).replace(exportPattern, '');
        const compiled = glslify.compile(inlined, { basedir: dirname(id) });
        return `export default ${JSON.stringify(compiled)};`;
    };

    return {
        name: 'hilo3d-glsl',
        enforce: 'pre',
        load(id) {
            const cleanId = id.split('?', 1)[0];
            if (!cleanId || !shaderPattern.test(cleanId)) return null;
            return { code: compile(readFileSync(cleanId, 'utf8'), cleanId), map: null };
        },
        transform(source, id) {
            const cleanId = id.split('?', 1)[0];
            if (!cleanId || !shaderPattern.test(cleanId)) return null;
            if (/^\s*export default\s/u.test(source)) return null;
            return { code: compile(source, cleanId), map: null };
        }
    };
}

const banner = `/*!\n * Hilo3d ${packageJson.version}\n * Copyright (c) 2017-present Alibaba Group Holding Ltd.\n * @license MIT\n */`;

export default defineConfig({
    plugins: [glslPlugin()],
    optimizeDeps: {
        include: [
            'amc/build/amd',
            'gl-matrix',
            'parse-hdr',
            'ray-3d',
            'should',
            'sinon'
        ]
    },
    define: {
        HILO3D_VERSION: JSON.stringify(packageJson.version)
    },
    build: {
        target: 'es2020',
        sourcemap: true,
        lib: {
            entry: fileURLToPath(new URL('./src/Hilo3d.ts', import.meta.url)),
            name: 'Hilo3d',
            formats: ['es', 'umd'],
            fileName(format) {
                return format === 'es' ? 'Hilo3d.js' : 'Hilo3d.umd.cjs';
            }
        },
        rolldownOptions: {
            output: {
                banner
            }
        }
    }
});
