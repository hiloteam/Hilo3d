import { readBoundedResponse } from './bounded-response';
import { assetHash } from './assets';
import { createStoredArchive, exportProjectArchive } from './project-archive';
import { validateProject, type ProjectDocument } from './project';
import { validatePlayerManifest, type PlayerManifest } from './player-manifest';

interface TemplateFile {
    path: string;
    bytes: number;
    sha256: string;
}
interface PlayerTemplate {
    engineVersion: string;
    files: TemplateFile[];
}
const MAX_TEMPLATE_BYTES = 40 * 1024 * 1024;
const reserved = new Set(['player.json', 'project.zip', 'README.md']);

function template(value: unknown): PlayerTemplate {
    if (!value || typeof value !== 'object') throw new Error('Player template is invalid');
    const input = value as Record<string, unknown>;
    if (
        input['format'] !== 'hilo3d-player-template' ||
        input['version'] !== 1 ||
        typeof input['engineVersion'] !== 'string' ||
        !Array.isArray(input['files']) ||
        input['files'].length > 256
    )
        throw new Error('Unsupported Player template');
    const files: TemplateFile[] = [];
    const paths = new Set<string>();
    let total = 0;
    for (const fileValue of input['files'] as unknown[]) {
        if (!fileValue || typeof fileValue !== 'object')
            throw new Error('Invalid Player template file');
        const entry = fileValue as Record<string, unknown>;
        const path = entry['path'];
        const bytes = entry['bytes'];
        const sha256 = entry['sha256'];
        if (
            typeof path !== 'string' ||
            !/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/u.test(path) ||
            path.split('/').some(part => !part || part === '.' || part === '..') ||
            reserved.has(path) ||
            paths.has(path) ||
            typeof bytes !== 'number' ||
            !Number.isSafeInteger(bytes) ||
            bytes < 0 ||
            typeof sha256 !== 'string' ||
            !/^[a-f0-9]{64}$/u.test(sha256)
        )
            throw new Error('Invalid Player template file');
        total += bytes;
        if (total > MAX_TEMPLATE_BYTES) throw new Error('Player template exceeds 40 MiB');
        paths.add(path);
        files.push({ path, bytes, sha256 });
    }
    if (!paths.has('index.html') || !files.some(file => file.path.endsWith('.js')))
        throw new Error('Player template is incomplete');
    return { engineVersion: input['engineVersion'], files };
}

/** Bound response reads even if a server omits or misreports Content-Length. */
export async function readDeploymentResponse(
    response: Response,
    maximum: number,
    signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
    if (!response.ok || !response.body)
        throw new Error(`Could not load deployment resource (${String(response.status)})`);
    return readBoundedResponse(response, maximum, signal);
}

/** Package an immutable, validated project with the exact production runtime built with Studio. */
export async function exportPlayerArchive(
    project: ProjectDocument,
    settings: PlayerManifest,
    templateURL: URL,
    signal?: AbortSignal,
    onProgress: (message: string) => void = () => undefined
): Promise<Blob> {
    const valid = validateProject(project);
    const manifest = validatePlayerManifest(settings, valid);
    onProgress('Checking Player runtime…');
    const options = signal ? { signal } : {};
    const response = await fetch(new URL('template.json', templateURL), options);
    const bytes = await readDeploymentResponse(response, 128 * 1024, signal);
    const runtime = template(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    if (manifest.engineVersion !== runtime.engineVersion)
        throw new Error(
            'Player runtime and project build versions differ. Reload Studio before exporting.'
        );
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const [index, file] of runtime.files.entries()) {
        signal?.throwIfAborted();
        onProgress(`Packing runtime ${String(index + 1)} / ${String(runtime.files.length)}…`);
        const fileResponse = await fetch(new URL(file.path, templateURL), options);
        const data = await readDeploymentResponse(fileResponse, file.bytes, signal);
        if (data.length !== file.bytes || assetHash(data) !== file.sha256)
            throw new Error(`Player runtime integrity check failed: ${file.path}`);
        files.set(file.path, data);
    }
    onProgress('Packing scenes, scripts and assets…');
    const workspace = await exportProjectArchive(valid);
    signal?.throwIfAborted();
    files.set('project.zip', new Uint8Array(await workspace.arrayBuffer()));
    const encoder = new TextEncoder();
    files.set('player.json', encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`));
    files.set(
        'README.md',
        encoder.encode(
            `# ${valid.name}\n\nUpload this entire folder to a static HTTP(S) host and open index.html. Subdirectory hosting is supported. All runtime files and project assets are included; no CDN or editor service is required. Opening index.html with file:// is unsupported.\n\nClick Start to run authored scripts, physics and particles and unlock audio. The toolbar supports pause, restart and scene selection when enabled. Add ?backend=webgl2 or ?backend=webgpu for an explicit backend; the default is auto. WebGPU requires a secure context.\n\nproject.zip is an editable Hilo Studio workspace. Asset license, attribution and source information are retained inside it; check your rights before distributing your own assets. LICENSE.txt covers Hilo3D; dependency notices accompany the compiled runtime.\n\nBuilt with Hilo3D ${manifest.engineVersion}.\n`
        )
    );
    onProgress('Creating website ZIP…');
    return createStoredArchive(files, {
        entryBytes: 96 * 1024 * 1024,
        expandedBytes: 127 * 1024 * 1024
    });
}
