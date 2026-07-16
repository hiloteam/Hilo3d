import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';

const projectRoot = resolve(import.meta.dirname, '..');
const declarationInput = resolve(projectRoot, '.cache/types/Hilo3d.d.ts');
const outputDirectory = resolve(projectRoot, 'dist');
const packageDocumentation = `/**
 * TypeScript-first public API for the Hilo3d WebGL engine.
 *
 * @packageDocumentation
 */`;

await mkdir(outputDirectory, { recursive: true });

const bundle = await rollup({
    input: declarationInput,
    plugins: [dts()]
});

try {
    await bundle.write({
        file: resolve(outputDirectory, 'Hilo3d.d.ts'),
        format: 'es',
        banner: packageDocumentation,
        sourcemap: true
    });
} finally {
    await bundle.close();
}

const umdDeclaration = ["export * from './Hilo3d.js';", 'export as namespace Hilo3d;', ''].join(
    '\n'
);

await Promise.all([
    writeFile(resolve(outputDirectory, 'Hilo3d.umd.d.mts'), umdDeclaration, 'utf8'),
    writeFile(resolve(outputDirectory, 'Hilo3d.umd.d.cts'), umdDeclaration, 'utf8')
]);
