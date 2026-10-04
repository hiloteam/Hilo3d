import manifestSchema from './project-manifest.schema.json' with { type: 'json' };
import sceneSchema from './scene.schema.json' with { type: 'json' };
import { parseProject, serializeProject, validateProject, type ProjectDocument } from './project';
import { serializeScene } from './scene';
import { validateProjectAssetDecoding, type ProjectAsset } from './assets';
import type { ScriptDocument } from './script-types';

export interface WorkspaceFileReference {
    path: string;
}

/** Versioned, binary-free index for source-controlled or AI-edited workspace folders. */
export interface ProjectWorkspaceManifest {
    $schema: './project-manifest.schema.json';
    format: 'hilo3d-workspace';
    version: 1;
    project: Pick<
        ProjectDocument,
        'id' | 'name' | 'revision' | 'createdAt' | 'updatedAt' | 'activeSceneId'
    >;
    scenes: Record<string, WorkspaceFileReference>;
    assets: Record<string, Omit<ProjectAsset, 'data'> & WorkspaceFileReference>;
    scripts: Record<string, Omit<ScriptDocument, 'source'> & WorkspaceFileReference>;
    prefabs: Record<string, WorkspaceFileReference>;
    instances: Record<string, WorkspaceFileReference>;
    clips: Record<string, WorkspaceFileReference>;
}

interface ZipEntry {
    name: string;
    method: number;
    checksum: number;
    compressedSize: number;
    size: number;
    dataOffset: number;
    recordStart: number;
    recordEnd: number;
    directory: boolean;
}

const MANIFEST = 'project.hilo.json';
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 96 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
    let value = 0xffffffff;
    for (const byte of bytes) value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
}

function jsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
    return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function safeStem(id: string): string {
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(id) ? `_${id}` : id;
}

function safePath(name: string): void {
    const body = name.endsWith('/') ? name.slice(0, -1) : name;
    if (
        !body ||
        name.length > 240 ||
        body.includes('\\') ||
        body.includes(':') ||
        Array.from(body).some(
            character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ) ||
        body.startsWith('/') ||
        body.includes('//')
    )
        throw new Error(`Unsafe workspace archive path: ${name}`);
    for (const segment of body.split('/')) {
        if (
            segment === '.' ||
            segment === '..' ||
            segment.endsWith('.') ||
            segment.endsWith(' ') ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)
        )
            throw new Error(`Unsafe workspace archive path: ${name}`);
    }
}

function base64(bytes: Uint8Array): string {
    const parts: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
        parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    return btoa(parts.join(''));
}

function assetBytes(asset: ProjectAsset): Uint8Array<ArrayBuffer> {
    const binary = atob(asset.data);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function extension(mime: ProjectAsset['mimeType']): string {
    return mime === 'model/gltf-binary'
        ? 'glb'
        : mime === 'image/jpeg'
          ? 'jpg'
          : mime === 'image/png'
            ? 'png'
            : 'webp';
}

// Classic ZIP records follow PKWARE APPNOTE 6.3.10. No ZIP64, encryption or executable extraction stub.
// https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
function storedZip(files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>): Blob {
    if (!files.size || files.size > MAX_ENTRIES)
        throw new Error('Workspace archive supports 1–1024 entries');
    const order = [...files.keys()].sort((left, right) =>
        left === MANIFEST ? -1 : right === MANIFEST ? 1 : left < right ? -1 : left > right ? 1 : 0
    );
    const parts: BlobPart[] = [];
    const directory: Uint8Array<ArrayBuffer>[] = [];
    let offset = 0;
    let expanded = 0;
    for (const name of order) {
        safePath(name);
        const data = files.get(name);
        if (!data) throw new Error('Missing workspace file');
        expanded += data.length;
        if (data.length > MAX_ENTRY_BYTES || expanded > MAX_EXPANDED_BYTES)
            throw new Error('Workspace expanded data exceeds its size limit');
        const path = encoder.encode(name);
        const checksum = crc32(data);
        const local = new Uint8Array(30 + path.length);
        const view = new DataView(local.buffer);
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 0x0800, true);
        view.setUint16(12, 0x21, true);
        view.setUint32(14, checksum, true);
        view.setUint32(18, data.length, true);
        view.setUint32(22, data.length, true);
        view.setUint16(26, path.length, true);
        local.set(path, 30);
        const central = new Uint8Array(46 + path.length);
        const record = new DataView(central.buffer);
        record.setUint32(0, 0x02014b50, true);
        record.setUint16(4, 20, true);
        record.setUint16(6, 20, true);
        record.setUint16(8, 0x0800, true);
        record.setUint16(14, 0x21, true);
        record.setUint32(16, checksum, true);
        record.setUint32(20, data.length, true);
        record.setUint32(24, data.length, true);
        record.setUint16(28, path.length, true);
        record.setUint32(42, offset, true);
        central.set(path, 46);
        parts.push(local, data);
        directory.push(central);
        offset += local.length + data.length;
    }
    const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0);
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, files.size, true);
    view.setUint16(10, files.size, true);
    view.setUint32(12, directorySize, true);
    view.setUint32(16, offset, true);
    if (offset + directorySize + 22 > MAX_ARCHIVE_BYTES)
        throw new Error('Workspace ZIP exceeds 128 MiB');
    return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}

/** Export editable UTF-8 documents and original binary assets, with no base64 in the manifest. */
export async function exportProjectArchive(project: ProjectDocument): Promise<Blob> {
    const valid = validateProject(project);
    // The workspace must also fit the authoritative portable project representation on reimport.
    serializeProject(valid);
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    let expandedBytes = 0;
    const add = (path: string, data: Uint8Array<ArrayBuffer>): void => {
        expandedBytes += data.length;
        if (data.length > MAX_ENTRY_BYTES || expandedBytes > MAX_EXPANDED_BYTES)
            throw new Error('Workspace expanded data exceeds its size limit');
        if (files.has(path)) throw new Error(`Duplicate workspace file: ${path}`);
        files.set(path, data);
    };
    const manifest: ProjectWorkspaceManifest = {
        $schema: './project-manifest.schema.json',
        format: 'hilo3d-workspace',
        version: 1,
        project: {
            id: valid.id,
            name: valid.name,
            revision: valid.revision,
            createdAt: valid.createdAt,
            updatedAt: valid.updatedAt,
            activeSceneId: valid.activeSceneId
        },
        scenes: {},
        assets: {},
        scripts: {},
        prefabs: {},
        instances: {},
        clips: {}
    };
    for (const [id, scene] of Object.entries(valid.scenes)) {
        const path = `scenes/${safeStem(id)}.scene.json`;
        add(path, encoder.encode(serializeScene(scene)));
        manifest.scenes[id] = { path };
    }
    for (const [id, asset] of Object.entries(valid.assets)) {
        const path = `assets/${safeStem(id)}.${extension(asset.mimeType)}`;
        add(path, assetBytes(asset));
        manifest.assets[id] = {
            id: asset.id,
            name: asset.name,
            kind: asset.kind,
            mimeType: asset.mimeType,
            size: asset.size,
            hash: asset.hash,
            source: { ...asset.source },
            path
        };
    }
    for (const [id, script] of Object.entries(valid.scripts)) {
        const path = `scripts/${safeStem(id)}.js`;
        add(path, encoder.encode(script.source));
        manifest.scripts[id] = { id: script.id, name: script.name, enabled: script.enabled, path };
    }
    for (const [id, prefab] of Object.entries(valid.prefabs)) {
        const path = `prefabs/${safeStem(id)}.prefab.json`;
        add(path, jsonBytes(prefab));
        manifest.prefabs[id] = { path };
    }
    for (const [id, instance] of Object.entries(valid.instances)) {
        const path = `instances/${safeStem(id)}.instance.json`;
        add(path, jsonBytes(instance));
        manifest.instances[id] = { path };
    }
    for (const [id, clip] of Object.entries(valid.clips)) {
        const path = `animations/${safeStem(id)}.clip.json`;
        add(path, jsonBytes(clip));
        manifest.clips[id] = { path };
    }
    add(MANIFEST, jsonBytes(manifest));
    add('project-manifest.schema.json', jsonBytes(manifestSchema));
    add('scene.schema.json', jsonBytes(sceneSchema));
    add(
        'README.md',
        encoder.encode(
            `# Hilo Studio editable workspace\n\nStart with project.hilo.json. It indexes every file by stable project IDs.\n\n- Edit scenes/*.scene.json to change objects, transforms, materials and lights. Positions use meters; local XYZ rotations use degrees.\n- Edit scripts/*.js as inert user-authored source. Import never executes these files; explicit Play runs enabled scripts through the editor runtime.\n- Animation clips and prefab documents are separate JSON files. Preserve IDs and references when editing.\n- Assets are original binary files. If replacing an asset, update its SHA-256, byte length and content-derived ID consistently, or import the new asset through the editor.\n- The JSON Schema files are offline authoring references. Scene documents reject unknown fields; do not add a $schema property to them.\n\nRepack this folder as a normal stored or Deflate ZIP and import it in Hilo Studio. A single enclosing folder is accepted. Encrypted, ZIP64, multi-disk, symbolic-link and path-traversal entries are rejected.\n`
        )
    );
    return Promise.resolve(storedZip(files));
}

function bounds(bytes: Uint8Array, offset: number, length: number, end = bytes.length): void {
    if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset + length > end
    )
        throw new Error('Truncated or invalid ZIP record');
}

function extras(bytes: Uint8Array, offset: number, length: number): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = offset + length;
    bounds(bytes, offset, length);
    while (offset < end) {
        bounds(bytes, offset, 4, end);
        const id = view.getUint16(offset, true);
        const size = view.getUint16(offset + 2, true);
        if (id === 0x0001) throw new Error('ZIP64 workspace archives are not supported');
        if (id === 0x9901 || id === 0x0017)
            throw new Error('Encrypted ZIP workspace archives are not supported');
        if (id === 0x7075)
            throw new Error(
                'Alternate Unicode ZIP paths are not supported; use stable ASCII workspace paths'
            );
        offset += 4;
        bounds(bytes, offset, size, end);
        offset += size;
    }
}

function zipEntries(bytes: Uint8Array<ArrayBuffer>): ZipEntry[] {
    const view = new DataView(bytes.buffer);
    let end = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
        if (
            view.getUint32(offset, true) === 0x06054b50 &&
            offset + 22 + view.getUint16(offset + 20, true) === bytes.length
        ) {
            end = offset;
            break;
        }
    }
    if (end < 0) throw new Error('ZIP end directory was not found');
    const count = view.getUint16(end + 10, true);
    const directorySize = view.getUint32(end + 12, true);
    const directoryOffset = view.getUint32(end + 16, true);
    if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff)
        throw new Error('ZIP64 workspace archives are not supported');
    if (
        view.getUint16(end + 4, true) !== 0 ||
        view.getUint16(end + 6, true) !== 0 ||
        view.getUint16(end + 8, true) !== count
    )
        throw new Error('Multi-disk workspace ZIPs are not supported');
    if (!count || count > MAX_ENTRIES) throw new Error('Workspace archive supports 1–1024 entries');
    if (directoryOffset + directorySize !== end)
        throw new Error('Unsupported ZIP directory records or ZIP64 layout');
    bounds(bytes, directoryOffset, directorySize, end);
    const result: ZipEntry[] = [];
    const names = new Set<string>();
    let cursor = directoryOffset;
    let expanded = 0;
    for (let index = 0; index < count; index++) {
        bounds(bytes, cursor, 46, end);
        if (view.getUint32(cursor, true) !== 0x02014b50)
            throw new Error('Invalid ZIP central directory signature');
        const flags = view.getUint16(cursor + 8, true);
        const method = view.getUint16(cursor + 10, true);
        const checksum = view.getUint32(cursor + 16, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const size = view.getUint32(cursor + 24, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const local = view.getUint32(cursor + 42, true);
        if (flags & 0x2041) throw new Error('Encrypted ZIP workspace archives are not supported');
        if (flags & ~0x080e) throw new Error('Unsupported ZIP entry flags');
        if (method === 0 && flags & 6)
            throw new Error('Stored ZIP entries cannot use compression flags');
        if (method !== 0 && method !== 8)
            throw new Error('Only stored or Deflate workspace ZIP entries are supported');
        if (size === 0xffffffff || compressedSize === 0xffffffff || local === 0xffffffff)
            throw new Error('ZIP64 workspace archives are not supported');
        if (view.getUint16(cursor + 34, true) !== 0)
            throw new Error('Multi-disk workspace ZIPs are not supported');
        if (size > MAX_ENTRY_BYTES || (expanded += size) > MAX_EXPANDED_BYTES)
            throw new Error('Workspace expanded data exceeds its size limit');
        bounds(bytes, cursor + 46, nameLength + extraLength + commentLength, end);
        const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
        safePath(name);
        const portableName = name.replace(/\/$/u, '').normalize('NFC').toLowerCase();
        if (names.has(portableName))
            throw new Error(`Duplicate or case-conflicting ZIP path: ${name}`);
        names.add(portableName);
        extras(bytes, cursor + 46 + nameLength, extraLength);
        const unixType = (view.getUint32(cursor + 38, true) >>> 16) & 0xf000;
        if (unixType !== 0 && unixType !== 0x8000 && unixType !== 0x4000)
            throw new Error('Symbolic links and special ZIP entries are not supported');
        const directory = name.endsWith('/');
        if (directory && size !== 0) throw new Error('ZIP directories must be empty');
        bounds(bytes, local, 30, directoryOffset);
        if (
            view.getUint32(local, true) !== 0x04034b50 ||
            view.getUint16(local + 6, true) !== flags ||
            view.getUint16(local + 8, true) !== method
        )
            throw new Error('Local and central ZIP headers disagree');
        const localNameLength = view.getUint16(local + 26, true);
        const localExtraLength = view.getUint16(local + 28, true);
        bounds(bytes, local + 30, localNameLength + localExtraLength, directoryOffset);
        if (decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name)
            throw new Error('Local and central ZIP paths disagree');
        extras(bytes, local + 30 + localNameLength, localExtraLength);
        const dataOffset = local + 30 + localNameLength + localExtraLength;
        bounds(bytes, dataOffset, compressedSize, directoryOffset);
        let recordEnd = dataOffset + compressedSize;
        if (flags & 8) {
            for (const [field, expected] of [
                [14, checksum],
                [18, compressedSize],
                [22, size]
            ] as const) {
                const localValue = view.getUint32(local + field, true);
                if (localValue !== 0 && localValue !== expected)
                    throw new Error('Local ZIP metadata disagrees with its data descriptor');
            }
            bounds(bytes, recordEnd, 12, directoryOffset);
            if (
                view.getUint32(recordEnd, true) === 0x08074b50 &&
                recordEnd + 16 <= directoryOffset &&
                view.getUint32(recordEnd + 4, true) === checksum &&
                view.getUint32(recordEnd + 8, true) === compressedSize &&
                view.getUint32(recordEnd + 12, true) === size
            )
                recordEnd += 4;
            bounds(bytes, recordEnd, 12, directoryOffset);
            if (
                view.getUint32(recordEnd, true) !== checksum ||
                view.getUint32(recordEnd + 4, true) !== compressedSize ||
                view.getUint32(recordEnd + 8, true) !== size
            )
                throw new Error('ZIP data descriptor differs from central directory');
            recordEnd += 12;
        } else if (
            view.getUint32(local + 14, true) !== checksum ||
            view.getUint32(local + 18, true) !== compressedSize ||
            view.getUint32(local + 22, true) !== size
        )
            throw new Error('Local and central ZIP sizes or checksum disagree');
        result.push({
            name,
            method,
            checksum,
            compressedSize,
            size,
            dataOffset,
            recordStart: local,
            recordEnd,
            directory
        });
        cursor += 46 + nameLength + extraLength + commentLength;
    }
    if (cursor !== end) throw new Error('ZIP central directory length is inconsistent');
    let localEnd = 0;
    for (const entry of [...result].sort((a, b) => a.recordStart - b.recordStart)) {
        if (entry.recordStart !== localEnd)
            throw new Error('ZIP has overlapping, hidden or unsupported local records');
        localEnd = entry.recordEnd;
    }
    if (localEnd !== directoryOffset)
        throw new Error('ZIP contains unsupported records before its directory');
    return result;
}

async function inflate(
    bytes: Uint8Array<ArrayBuffer>,
    entry: ZipEntry
): Promise<Uint8Array<ArrayBuffer>> {
    const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
    if (entry.method === 0) {
        if (entry.compressedSize !== entry.size) throw new Error('Stored ZIP entry size mismatch');
        return compressed;
    }
    let decompressor: DecompressionStream;
    try {
        decompressor = new DecompressionStream('deflate-raw');
    } catch (cause) {
        throw new Error(
            'This browser cannot decode Deflate ZIPs. Repack the workspace using stored/uncompressed ZIP.',
            { cause }
        );
    }
    const reader = new Blob([compressed]).stream().pipeThrough(decompressor).getReader();
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let length = 0;
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.length;
            if (length > entry.size || length > MAX_ENTRY_BYTES)
                throw new Error('Expanded ZIP data exceeds its declared size');
            parts.push(next.value);
        }
    } finally {
        await reader.cancel().catch(() => undefined);
    }
    if (length !== entry.size) throw new Error('Expanded ZIP entry size mismatch');
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

function object(
    value: unknown,
    label: string,
    allowed?: readonly string[]
): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${label}: expected an object`);
    const result = value as Record<string, unknown>;
    if (allowed)
        for (const key of Object.keys(result))
            if (!allowed.includes(key)) throw new Error(`${label}.${key}: unknown field`);
    return result;
}

function identifier(id: string): void {
    if (
        id.length > 64 ||
        !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(id) ||
        id === 'constructor' ||
        id === 'prototype'
    )
        throw new Error('Workspace contains an invalid stable identifier');
}

function jsonFile(bytes: Uint8Array, label: string): unknown {
    try {
        return JSON.parse(decoder.decode(bytes).replace(/^\uFEFF/u, '')) as unknown;
    } catch (cause) {
        throw new Error(`${label}: invalid UTF-8 JSON`, { cause });
    }
}

/** Import a bounded workspace transaction; validate CRC, assets, scripts and every project reference. */
export async function importProjectArchive(file: Blob): Promise<ProjectDocument> {
    if (file.size < 22 || file.size > MAX_ARCHIVE_BYTES)
        throw new Error('Workspace ZIP must contain 22 bytes to 128 MiB');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size) throw new Error('Workspace archive changed while being read');
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const entry of zipEntries(bytes)) {
        const data = await inflate(bytes, entry);
        if (crc32(data) !== entry.checksum) throw new Error(`ZIP CRC mismatch: ${entry.name}`);
        if (!entry.directory) files.set(entry.name, data);
    }
    const candidates = [...files.keys()].filter(
        name => name === MANIFEST || name.endsWith(`/${MANIFEST}`)
    );
    if (candidates.length !== 1)
        throw new Error('Workspace requires exactly one project.hilo.json manifest');
    const manifestPath = candidates[0];
    if (!manifestPath) throw new Error('Workspace manifest is missing');
    const prefix = manifestPath.slice(0, -MANIFEST.length);
    const manifestBytes = files.get(manifestPath);
    if (!manifestBytes || manifestBytes.length > 2 * 1024 * 1024)
        throw new Error('Workspace manifest exceeds 2 MiB');
    const manifest = object(jsonFile(manifestBytes, MANIFEST), MANIFEST, [
        '$schema',
        'format',
        'version',
        'project',
        'scenes',
        'assets',
        'scripts',
        'prefabs',
        'instances',
        'clips'
    ]);
    if (
        manifest['$schema'] !== './project-manifest.schema.json' ||
        manifest['format'] !== 'hilo3d-workspace' ||
        manifest['version'] !== 1
    )
        throw new Error('Unsupported workspace manifest format or version');
    const metadata = object(manifest['project'], 'manifest.project', [
        'id',
        'name',
        'revision',
        'createdAt',
        'updatedAt',
        'activeSceneId'
    ]);
    const claimed = new Set([manifestPath]);
    const read = (reference: Record<string, unknown>, pattern: RegExp): Uint8Array<ArrayBuffer> => {
        const path = reference['path'];
        if (typeof path !== 'string' || !pattern.test(path))
            throw new Error('Invalid workspace file reference');
        safePath(path);
        const full = prefix + path;
        if (claimed.has(full))
            throw new Error(`Workspace path is referenced more than once: ${path}`);
        claimed.add(full);
        const data = files.get(full);
        if (!data) throw new Error(`Referenced workspace file is missing: ${path}`);
        return data;
    };
    const collection = (name: string, maximum: number): [string, unknown][] => {
        const entries = Object.entries(object(manifest[name], `manifest.${name}`));
        if (entries.length > maximum) throw new Error(`Workspace ${name} exceeds its record limit`);
        for (const [id] of entries) identifier(id);
        return entries;
    };
    const scenes: Record<string, unknown> = {};
    for (const [id, value] of collection('scenes', 32))
        scenes[id] = jsonFile(
            read(object(value, 'scene reference', ['path']), /^scenes\/[_a-z0-9-]+\.scene\.json$/u),
            id
        );
    const assets: Record<string, unknown> = {};
    for (const [id, value] of collection('assets', 128)) {
        const asset = object(value, 'asset reference', [
            'id',
            'name',
            'kind',
            'mimeType',
            'size',
            'hash',
            'source',
            'path'
        ]);
        const data = read(asset, /^assets\/[_a-z0-9-]+\.(glb|png|jpg|webp)$/u);
        assets[id] = {
            id: asset['id'],
            name: asset['name'],
            kind: asset['kind'],
            mimeType: asset['mimeType'],
            size: asset['size'],
            hash: asset['hash'],
            source: asset['source'],
            data: base64(data)
        };
    }
    const scripts: Record<string, unknown> = {};
    for (const [id, value] of collection('scripts', 64)) {
        const script = object(value, 'script reference', ['id', 'name', 'enabled', 'path']);
        const data = read(script, /^scripts\/[_a-z0-9-]+\.js$/u);
        if (data.length > 65_536) throw new Error('Workspace script exceeds 64 KiB');
        scripts[id] = {
            id: script['id'],
            name: script['name'],
            enabled: script['enabled'],
            source: decoder.decode(data)
        };
    }
    const documents = (name: string, maximum: number, pattern: RegExp): Record<string, unknown> =>
        Object.fromEntries(
            collection(name, maximum).map(([id, value]) => [
                id,
                jsonFile(read(object(value, `${name} reference`, ['path']), pattern), id)
            ])
        );
    const prefabs = documents('prefabs', 64, /^prefabs\/[_a-z0-9-]+\.prefab\.json$/u);
    const instances = documents('instances', 256, /^instances\/[_a-z0-9-]+\.instance\.json$/u);
    const clips = documents('clips', 128, /^animations\/[_a-z0-9-]+\.clip\.json$/u);
    for (const path of files.keys()) {
        if (
            claimed.has(path) ||
            path === `${prefix}README.md` ||
            path === `${prefix}project-manifest.schema.json` ||
            path === `${prefix}scene.schema.json` ||
            path.startsWith('__MACOSX/') ||
            path.split('/').at(-1) === '.DS_Store'
        )
            continue;
        throw new Error(`Unreferenced workspace file: ${path}`);
    }
    // This reuses the authoritative project/asset SHA-256, image/GLB, script and reference validators.
    // Script text is never evaluated, imported as a module, or sent to the script worker here.
    const project = parseProject(
        JSON.stringify({
            format: 'hilo3d-project',
            version: 1,
            ...metadata,
            scenes,
            assets,
            scripts,
            prefabs,
            instances,
            clips
        })
    );
    await validateProjectAssetDecoding(project.assets);
    return project;
}
