#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STARTER_ROOT = join(SKILL_ROOT, 'assets', 'starter');
const VALID_TYPES = new Set(['2d', '3d', 'hybrid']);
const PROJECT_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const MAXIMUM_PROJECT_NAME_LENGTH = 214;
const MINIMUM_NODE_VERSION = [22, 22, 2];
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';
const HILO_STABLE_VERSION = '2.0.0';
const HILO_ALPHA_PATTERN = /^2\.0\.0-alpha\.(\d+)$/u;
const execFileAsync = promisify(execFile);

function usage() {
    return `Create a standalone Hilo3D 2.0.0 game.

Usage:
  node create-hilo3d-game.mjs --type <2d|3d|hybrid> --name <name> --output <directory> [options]

Options:
  --hilo-version <version|auto>  Exact 2.0.0/2.0.0-alpha.N, or stable-first lookup (default: auto)
  --registry <url>               Registry used for automatic lookup (default: npmjs.org)

Example:
  node create-hilo3d-game.mjs --type hybrid --name orbit-quest --output ./orbit-quest
`;
}

function parseArguments(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--help' || argument === '-h') return { help: true };
        if (
            argument !== '--type' &&
            argument !== '--name' &&
            argument !== '--output' &&
            argument !== '--hilo-version' &&
            argument !== '--registry'
        ) {
            throw new Error(`Unknown argument: ${argument}\n\n${usage()}`);
        }
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for ${argument}\n\n${usage()}`);
        }
        options[argument.slice(2)] = value;
        index += 1;
    }
    return options;
}

function compareVersionParts(left, right) {
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

function warnForUnsupportedNode() {
    const current = process.versions.node.split('.').map(Number);
    if (compareVersionParts(current, MINIMUM_NODE_VERSION) < 0) {
        process.stderr.write(
            `Warning: generated Hilo3D projects require Node.js 22.22.2 or newer; current Node is ${process.versions.node}.\n`
        );
    }
}

function validateRegistry(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
        return url.href;
    } catch {
        throw new Error('--registry must be an absolute HTTP or HTTPS URL');
    }
}

function selectPublishedHiloVersion(versions) {
    if (versions.includes(HILO_STABLE_VERSION)) return HILO_STABLE_VERSION;

    const alphas = versions
        .map(version => {
            const match = HILO_ALPHA_PATTERN.exec(version);
            return match ? { number: Number(match[1]), version } : undefined;
        })
        .filter(candidate => candidate !== undefined)
        .sort((left, right) => right.number - left.number);

    if (alphas[0]) return alphas[0].version;
    throw new Error(
        'No compatible hilo3d release is published: expected 2.0.0 or 2.0.0-alpha.N. ' +
            'Use --hilo-version with an exact prerelease only when it is available from your registry.'
    );
}

async function resolveHiloVersion(requested, registry) {
    if (requested && requested !== 'auto') {
        if (requested !== HILO_STABLE_VERSION && !HILO_ALPHA_PATTERN.test(requested)) {
            throw new Error(
                '--hilo-version must be auto, 2.0.0, or an exact 2.0.0-alpha.N version'
            );
        }
        return requested;
    }

    let stdout;
    try {
        ({ stdout } = await execFileAsync(
            process.platform === 'win32' ? 'npm.cmd' : 'npm',
            ['view', 'hilo3d', 'versions', '--json', '--tag=latest', `--registry=${registry}`],
            { maxBuffer: 1024 * 1024 }
        ));
    } catch (error) {
        const detail =
            error && typeof error === 'object' && 'stderr' in error
                ? String(error.stderr).trim()
                : '';
        throw new Error(
            `Could not query published hilo3d versions from ${registry}.` +
                (detail ? `\n${detail}` : '') +
                '\nRetry online or pass --hilo-version with an exact published version.'
        );
    }

    let result;
    try {
        result = JSON.parse(stdout);
    } catch {
        throw new Error(`Registry ${registry} returned invalid JSON for hilo3d versions`);
    }
    const versions = Array.isArray(result) ? result : [result];
    return selectPublishedHiloVersion(versions.filter(value => typeof value === 'string'));
}

async function directoryExists(path) {
    try {
        return (await stat(path)).isDirectory();
    } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
        throw error;
    }
}

async function requireEmptyDestination(output) {
    if (!(await directoryExists(output))) {
        await mkdir(output, { recursive: true });
        return;
    }
    const entries = await readdir(output);
    if (entries.length > 0) {
        throw new Error(`Output directory is not empty: ${output}`);
    }
}

async function copy(relativeSource, output, relativeDestination = relativeSource) {
    const source = join(STARTER_ROOT, relativeSource);
    const destination = join(output, relativeDestination);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
}

async function generate(options) {
    warnForUnsupportedNode();
    const type = options.type;
    const name = options.name;
    const outputValue = options.output;
    const registry = validateRegistry(options.registry ?? DEFAULT_REGISTRY);

    if (!type || !VALID_TYPES.has(type)) {
        throw new Error(`--type must be one of: ${[...VALID_TYPES].join(', ')}`);
    }
    if (!name || name.length > MAXIMUM_PROJECT_NAME_LENGTH || !PROJECT_NAME_PATTERN.test(name)) {
        throw new Error(
            `--name must be a lowercase npm-compatible package name no longer than ${String(MAXIMUM_PROJECT_NAME_LENGTH)} characters`
        );
    }
    if (!outputValue) throw new Error('--output is required');

    const hiloVersion = await resolveHiloVersion(options['hilo-version'], registry);
    const output = resolve(process.cwd(), outputValue);
    await requireEmptyDestination(output);

    await Promise.all([
        copy('index.html', output),
        copy('tsconfig.json', output),
        copy('src/style.css', output),
        copy('src/startup.ts', output),
        copy('src/vite-env.d.ts', output),
        copy(`variants/main-${type}.ts`, output, 'src/main.ts')
    ]);

    const packageTemplate = await readFile(join(STARTER_ROOT, 'package.json'), 'utf8');
    const packageJson = packageTemplate
        .replaceAll('__PROJECT_NAME__', name)
        .replaceAll('__HILO3D_VERSION__', hiloVersion);
    await writeFile(join(output, 'package.json'), packageJson, 'utf8');

    process.stdout.write(`Created ${type} Hilo3D game with hilo3d@${hiloVersion} at ${output}

Next:
  cd ${JSON.stringify(output)}
  npm install
  npm run dev
`);
}

try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write(usage());
    else await generate(options);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
}
