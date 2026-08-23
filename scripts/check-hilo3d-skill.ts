import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import ts from 'typescript';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '..');
const skillRoot = join(repositoryRoot, 'skills', 'hilo3d-game');
const generator = join(skillRoot, 'scripts', 'create-hilo3d-game.mjs');
const temporaryDirectories: string[] = [];

interface TestRegistry {
    close(): Promise<void>;
    url: string;
}

function localRegistryEnvironment(cache: string): NodeJS.ProcessEnv {
    return {
        ...process.env,
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
        npm_config_cache: cache,
        npm_config_https_proxy: '',
        npm_config_proxy: '',
        // `npm publish --tag next` exports this into prepublishOnly scripts.
        npm_config_tag: 'next'
    };
}

async function makeTemporaryDirectory(label: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), `hilo3d-${label}-`));
    temporaryDirectories.push(directory);
    return directory;
}

async function closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolveClose, rejectClose) => {
        server.close(error => {
            if (error) rejectClose(error);
            else resolveClose();
        });
    });
}

async function startRegistry(
    versions: readonly string[],
    nextVersion: string = versions.at(-1) ?? '1.19.1'
): Promise<TestRegistry> {
    let registryUrl = '';
    const server = createServer((request, response) => {
        if (request.url !== '/hilo3d') {
            response.writeHead(404, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'not_found' }));
            return;
        }

        const latest = versions.at(-1) ?? '1.19.1';
        const packageVersions = Object.fromEntries(
            versions.map(version => [
                version,
                {
                    name: 'hilo3d',
                    version,
                    dist: {
                        integrity: 'sha512-dGVzdA==',
                        shasum: '0000000000000000000000000000000000000000',
                        tarball: `${registryUrl}hilo3d/-/hilo3d-${version}.tgz`
                    }
                }
            ])
        );
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
            JSON.stringify({
                name: 'hilo3d',
                'dist-tags': { latest, next: nextVersion },
                versions: packageVersions
            })
        );
    });

    await new Promise<void>((resolveListen, rejectListen) => {
        const reject = (error: Error): void => {
            rejectListen(error);
        };
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolveListen();
        });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        await closeServer(server);
        throw new Error('The test registry did not expose a TCP address.');
    }
    registryUrl = `http://127.0.0.1:${String(address.port)}/`;
    return {
        close: () => closeServer(server),
        url: registryUrl
    };
}

async function generate(
    output: string,
    registry: string,
    type: '2d' | '3d' | 'hybrid' = '2d'
): Promise<void> {
    const cache = await makeTemporaryDirectory('skill-npm-cache');
    await execFileAsync(
        process.execPath,
        [
            generator,
            '--type',
            type,
            '--name',
            `skill-${type}-test`,
            '--output',
            output,
            '--registry',
            registry
        ],
        {
            cwd: repositoryRoot,
            env: localRegistryEnvironment(cache)
        }
    );
}

async function walkFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory);
    const files: string[] = [];
    for (const entry of entries) {
        const path = join(directory, entry);
        if ((await stat(path)).isDirectory()) files.push(...(await walkFiles(path)));
        else files.push(path);
    }
    return files;
}

function parseHilo3dDependency(packageJsonText: string): string {
    const packageJson: unknown = JSON.parse(packageJsonText);
    if (
        typeof packageJson !== 'object' ||
        packageJson === null ||
        !('dependencies' in packageJson) ||
        typeof packageJson.dependencies !== 'object' ||
        packageJson.dependencies === null ||
        !('hilo3d' in packageJson.dependencies) ||
        typeof packageJson.dependencies.hilo3d !== 'string'
    ) {
        throw new Error('Generated package.json does not contain a string hilo3d dependency.');
    }
    return packageJson.dependencies.hilo3d;
}

async function checkStructure(): Promise<void> {
    const files = await walkFiles(skillRoot);
    const markdownFiles = files.filter(file => file.endsWith('.md'));
    const skill = await readFile(join(skillRoot, 'SKILL.md'), 'utf8');
    assert(skill.split('\n').length < 500, 'SKILL.md must stay below 500 lines.');
    assert.match(skill, /^---\nname: hilo3d-game\n/u);

    for (const markdownFile of markdownFiles) {
        const markdown = await readFile(markdownFile, 'utf8');
        if (
            markdownFile.startsWith(join(skillRoot, 'references')) &&
            markdown.split('\n').length > 100
        ) {
            assert(
                markdown.includes('\n## Contents\n'),
                `${relative(skillRoot, markdownFile)} needs a table of contents.`
            );
        }
        for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
            const href = match[1];
            if (!href || href.startsWith('#') || href.startsWith('http')) continue;
            const fileReference = href.split('#', 1)[0];
            if (!fileReference) continue;
            await stat(resolve(dirname(markdownFile), fileReference));
        }
    }

    const textFiles = files.filter(file => /\.(?:css|html|json|md|mjs|ts|yaml)$/u.test(file));
    for (const file of textFiles) {
        const contents = await readFile(file, 'utf8');
        const label = relative(skillRoot, file);
        assert(!contents.includes(repositoryRoot), `${label} contains the checkout path.`);
        assert(!contents.includes('/Users/'), `${label} contains a user-specific absolute path.`);
    }

    const openAiMetadata = await readFile(join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
    assert(openAiMetadata.includes('$hilo3d-game'));
}

async function checkDocumentationContracts(): Promise<void> {
    const twoDimensional = await readFile(join(skillRoot, 'references', '2d-games.md'), 'utf8');
    const threeDimensional = await readFile(join(skillRoot, 'references', '3d-games.md'), 'utf8');
    const publicApi = await readFile(join(skillRoot, 'references', 'public-api.md'), 'utf8');
    const particles = await readFile(join(skillRoot, 'references', 'particle-effects.md'), 'utf8');
    const rendering = await readFile(
        join(skillRoot, 'references', 'rendering-performance.md'),
        'utf8'
    );

    assert(twoDimensional.includes("typeof event.stopPropagation === 'function'"));
    assert(threeDimensional.includes('event.hitPoint instanceof Hilo3d.Vector3'));
    assert(rendering.includes('renderer.renderToTarget(target, scene, camera);'));
    assert(!rendering.includes('renderer.renderToTarget(scene, camera, target);'));
    assert(threeDimensional.includes("coverage: { mode: 'mask', cutoff: 0.5 }"));
    assert(threeDimensional.includes('relevant `Mesh` objects'));
    assert(!publicApi.includes('transparent: true'));
    assert(!publicApi.includes('castShadows: true,\n    receiveShadows: true\n});'));
    assert(particles.includes('ParticleSystemDefinition.create'));
}

function checkStrictPublicApiSnippets(): void {
    const virtualFile = join(repositoryRoot, 'src', '__hilo3d-skill-snippets.ts');
    const source = `
import * as Hilo3d from './Hilo3d';

declare const button: Hilo3d.Sprite;
declare const dragTarget: Hilo3d.Vector2;
declare const interactable: Hilo3d.Mesh;
declare const renderer: Hilo3d.Renderer;
declare const scene: Hilo3d.Node;
declare const camera: Hilo3d.Camera;

const material = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.2, 0.65, 1),
    metallic: 0.2,
    roughness: 0.55,
    coverage: { mode: 'mask', cutoff: 0.5 }
});
const mesh = new Hilo3d.Mesh({
    material,
    castShadows: true,
    receiveShadows: true,
    renderOrder: 0
});
void mesh;

const particleDefinition = Hilo3d.ParticleSystemDefinition.create({
    emitters: [{
        name: 'spark-burst',
        capacity: 512,
        execution: 'auto',
        emission: { rateOverTime: 0, bursts: [{ time: 0, count: 80 }] },
        shape: { type: 'sphere', radius: 0.12, distribution: 'volume' },
        initialize: {
            lifetime: { min: 0.35, max: 0.8 },
            speed: { min: 1.5, max: 4 },
            size: { min: 0.025, max: 0.07 },
            color: [1, 0.45, 0.08, 1]
        },
        modules: [
            { type: 'gravity', force: [0, -4, 0] },
            { type: 'drag', coefficient: 0.2 }
        ],
        renderers: [{ type: 'sprite', blend: 'additive', depthWrite: false }]
    }]
});
new Hilo3d.ParticleSystem({ definition: particleDefinition, seed: 42, autoPlay: false });

button.on('click', event => {
    if ('stopPropagation' in event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
    }
});

button.on('pointerdown', event => {
    if (
        'stageX' in event &&
        typeof event.stageX === 'number' &&
        'stageY' in event &&
        typeof event.stageY === 'number'
    ) {
        dragTarget.set(event.stageX, event.stageY);
    }
});

interactable.on('click', event => {
    if (!('hitPoint' in event) || !(event.hitPoint instanceof Hilo3d.Vector3)) return;
    const point = event.hitPoint;
    void point;
});

const target = renderer.createRenderTarget({
    width: renderer.width,
    height: renderer.height
});
renderer.renderToTarget(target, scene, camera);
target.destroy();
`;
    const configPath = join(repositoryRoot, 'tsconfig.lib.json');
    const config = ts.readConfigFile(configPath, fileName => ts.sys.readFile(fileName));
    if (config.error) {
        throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    }
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repositoryRoot);
    const options: ts.CompilerOptions = {
        ...parsed.options,
        noEmit: true
    };
    const host = ts.createCompilerHost(options);
    const defaultFileExists = host.fileExists.bind(host);
    const defaultGetSourceFile = host.getSourceFile.bind(host);
    const defaultReadFile = host.readFile.bind(host);
    host.fileExists = fileName => fileName === virtualFile || defaultFileExists(fileName);
    host.readFile = fileName => (fileName === virtualFile ? source : defaultReadFile(fileName));
    host.getSourceFile = (
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreateNewSourceFile
    ) =>
        fileName === virtualFile
            ? ts.createSourceFile(fileName, source, languageVersionOrOptions, true)
            : defaultGetSourceFile(
                  fileName,
                  languageVersionOrOptions,
                  onError,
                  shouldCreateNewSourceFile
              );

    const program = ts.createProgram([...parsed.fileNames, virtualFile], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(
        diagnostics.length,
        0,
        ts.formatDiagnosticsWithColorAndContext(diagnostics, {
            getCanonicalFileName: fileName => fileName,
            getCurrentDirectory: () => repositoryRoot,
            getNewLine: () => '\n'
        })
    );
}

async function checkNextPrereleaseSelection(): Promise<void> {
    const registry = await startRegistry(
        ['1.19.1', '2.0.0-alpha.1', '2.0.0-alpha.9', '2.0.0-beta.1', '2.0.0-rc.1'],
        '2.0.0-beta.1'
    );
    try {
        const output = join(await makeTemporaryDirectory('skill-prerelease'), 'game');
        await generate(output, registry.url);
        assert.equal(
            parseHilo3dDependency(await readFile(join(output, 'package.json'), 'utf8')),
            '2.0.0-beta.1'
        );
    } finally {
        await registry.close();
    }
}

async function checkStableSelectionAndVariants(): Promise<void> {
    const registry = await startRegistry(['2.0.0-alpha.99', '2.0.0']);
    try {
        for (const type of ['2d', '3d', 'hybrid'] as const) {
            const output = join(await makeTemporaryDirectory(`skill-${type}`), 'game');
            await generate(output, registry.url, type);
            assert.equal(
                parseHilo3dDependency(await readFile(join(output, 'package.json'), 'utf8')),
                '2.0.0'
            );
            const mainSource = await readFile(join(output, 'src', 'main.ts'), 'utf8');
            assert(mainSource.includes("import { reportStartupFailure } from './startup';"));
            await stat(join(output, 'src', 'startup.ts'));
        }
    } finally {
        await registry.close();
    }
}

async function checkInvalidNextTagFailure(): Promise<void> {
    const registry = await startRegistry(['1.19.1'], '1.19.1');
    try {
        const output = join(await makeTemporaryDirectory('skill-invalid-next'), 'game');
        const cache = await makeTemporaryDirectory('skill-invalid-next-cache');
        let failure: unknown;
        try {
            await execFileAsync(
                process.execPath,
                [
                    generator,
                    '--type',
                    '2d',
                    '--name',
                    'missing-version-test',
                    '--output',
                    output,
                    '--registry',
                    registry.url
                ],
                {
                    cwd: repositoryRoot,
                    env: localRegistryEnvironment(cache)
                }
            );
        } catch (error) {
            failure = error;
        }
        assert(failure && typeof failure === 'object' && 'stderr' in failure);
        assert(String(failure.stderr).includes('next dist-tag must point to'));
        await assert.rejects(stat(output), { code: 'ENOENT' });
    } finally {
        await registry.close();
    }
}

async function checkInvalidProjectNameFailure(): Promise<void> {
    const output = join(await makeTemporaryDirectory('skill-invalid-name'), 'game');
    const overlongName = 'a'.repeat(215);
    let failure: unknown;
    try {
        await execFileAsync(
            process.execPath,
            [
                generator,
                '--type',
                '2d',
                '--name',
                overlongName,
                '--output',
                output,
                '--hilo-version',
                '2.0.0-alpha.1'
            ],
            { cwd: repositoryRoot }
        );
    } catch (error) {
        failure = error;
    }
    assert(failure && typeof failure === 'object' && 'stderr' in failure);
    assert(String(failure.stderr).includes('no longer than 214 characters'));
    await assert.rejects(stat(output), { code: 'ENOENT' });
}

async function main(): Promise<void> {
    try {
        await checkStructure();
        await checkDocumentationContracts();
        checkStrictPublicApiSnippets();
        await checkNextPrereleaseSelection();
        await checkStableSelectionAndVariants();
        await checkInvalidNextTagFailure();
        await checkInvalidProjectNameFailure();
        process.stdout.write('Hilo3D skill checks passed.\n');
    } finally {
        await Promise.all(
            temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true }))
        );
    }
}

await main();
