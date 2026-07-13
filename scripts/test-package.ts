import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TextDecoder, TextEncoder } from 'node:util';
import { createContext, runInContext } from 'node:vm';

interface PackResult {
    filename: string;
}

function readPackResult(output: string): PackResult {
    const parsed = JSON.parse(output) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 1) {
        throw new Error(`Unexpected npm pack response: ${output}`);
    }

    const firstResult = parsed[0] as unknown;
    if (
        typeof firstResult !== 'object' ||
        firstResult === null ||
        !('filename' in firstResult) ||
        typeof firstResult.filename !== 'string'
    ) {
        throw new Error(`Unexpected npm pack response: ${output}`);
    }
    return { filename: firstResult.filename };
}

const projectRoot = resolve(import.meta.dirname, '..');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'hilo3d-package-'));
const archiveDirectory = join(temporaryRoot, 'archive');
const consumerDirectory = join(temporaryRoot, 'consumer');

try {
    await mkdir(archiveDirectory);
    await mkdir(consumerDirectory);

    const packOutput = execFileSync(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', archiveDirectory],
        { cwd: projectRoot, encoding: 'utf8' }
    );
    const packResult = readPackResult(packOutput);
    const archivePath = join(archiveDirectory, packResult.filename);

    await writeFile(
        join(consumerDirectory, 'package.json'),
        JSON.stringify({ name: 'hilo3d-package-consumer', private: true, type: 'module' }, null, 2),
        'utf8'
    );
    execFileSync(
        'npm',
        [
            'install',
            '--ignore-scripts',
            '--offline',
            '--no-audit',
            '--no-fund',
            '--no-package-lock',
            archivePath,
            resolve(projectRoot, 'node_modules/gl-matrix')
        ],
        { cwd: consumerDirectory, stdio: 'inherit' }
    );

    await writeFile(
        join(consumerDirectory, 'esm-consumer.mjs'),
        [
            "import { Vector3, version } from 'hilo3d';",
            "if (typeof Vector3 !== 'function') throw new Error('Vector3 is not exported.');",
            "if (typeof version !== 'string') throw new Error('version is not exported.');",
            'const vector = new Vector3(1, 2, 3);',
            "if (!vector) throw new Error('Vector3 could not be constructed.');",
            ''
        ].join('\n'),
        'utf8'
    );
    execFileSync(process.execPath, ['esm-consumer.mjs'], {
        cwd: consumerDirectory,
        stdio: 'inherit'
    });

    await writeFile(
        join(consumerDirectory, 'umd-esm-consumer.mjs'),
        [
            "import * as Hilo3d from 'hilo3d/umd';",
            "if (typeof Hilo3d.Vector3 !== 'function') {",
            "    throw new Error('The UMD compatibility subpath did not expose ESM named exports.');",
            '}',
            ''
        ].join('\n'),
        'utf8'
    );
    execFileSync(process.execPath, ['umd-esm-consumer.mjs'], {
        cwd: consumerDirectory,
        stdio: 'inherit'
    });

    await writeFile(
        join(consumerDirectory, 'umd-cjs-consumer.cjs'),
        [
            "const Hilo3d = require('hilo3d/umd');",
            "if (typeof Hilo3d.Vector3 !== 'function') {",
            "    throw new Error('The UMD compatibility subpath did not expose CommonJS exports.');",
            '}',
            ''
        ].join('\n'),
        'utf8'
    );
    execFileSync(process.execPath, ['umd-cjs-consumer.cjs'], {
        cwd: consumerDirectory,
        stdio: 'inherit'
    });

    const umdSource = await readFile(
        join(consumerDirectory, 'node_modules/hilo3d/dist/Hilo3d.umd.cjs'),
        'utf8'
    );
    const umdContext: {
        Hilo3d?: Record<string, unknown>;
        console: Console;
        TextDecoder: typeof TextDecoder;
        TextEncoder: typeof TextEncoder;
    } = { console, TextDecoder, TextEncoder };
    createContext(umdContext);
    runInContext(umdSource, umdContext, { filename: 'Hilo3d.umd.cjs' });
    if (typeof umdContext.Hilo3d?.['Vector3'] !== 'function') {
        throw new Error('The UMD bundle did not expose Hilo3d.Vector3.');
    }
} finally {
    await rm(temporaryRoot, { force: true, recursive: true });
}
