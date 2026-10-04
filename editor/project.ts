import { validateAuthoring, type AuthoringRegistry } from './authoring-validation';
import { validateAsset, type ProjectAsset } from './assets';
import { parseScene, serializeScene, type SceneDocument } from './scene';

/** A self-contained local project bundle. Runtime URLs, handles and caches never enter the document. */
export interface ProjectDocument extends AuthoringRegistry {
    format: 'hilo3d-project';
    version: 1;
    id: string;
    name: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    activeSceneId: string;
    scenes: Record<string, SceneDocument>;
    assets: Record<string, ProjectAsset>;
}

export interface ProjectSummary {
    id: string;
    name: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    activeSceneId: string;
    sceneCount: number;
    assetCount: number;
}

const MAX_PROJECT_TEXT_BYTES = 96 * 1024 * 1024;
const MAX_PROJECT_ASSET_BYTES = 64 * 1024 * 1024;
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function record(value: unknown, path: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${path}: expected an object`);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        throw new Error(`${path}: expected a plain object`);
    return value as Record<string, unknown>;
}

function identifier(value: unknown, path: string): string {
    if (
        typeof value !== 'string' ||
        value.length > 64 ||
        !ID.test(value) ||
        value === 'constructor' ||
        value === 'prototype'
    )
        throw new Error(`${path}: expected a stable kebab-case ID of at most 64 characters`);
    return value;
}

function timestamp(value: unknown, path: string): string {
    if (
        typeof value !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString() !== value
    )
        throw new Error(`${path}: expected an ISO UTC timestamp`);
    return value;
}

/** Count portable bytes without copying any base64 payload into the temporary JSON string. */
function enforcePortableBudget(
    project: Record<string, unknown>,
    assetRecords: Record<string, unknown>
): void {
    let binaryCharacters = 0;
    const assets = Object.fromEntries(
        Object.entries(assetRecords).map(([id, value]) => {
            const asset = record(value, `project.assets.${id}`);
            if (typeof asset['data'] === 'string') binaryCharacters += asset['data'].length;
            return [id, { ...asset, data: '' }];
        })
    );
    const metadata = JSON.stringify({ ...project, assets }, null, 2);
    const bytes = new TextEncoder().encode(metadata).byteLength + binaryCharacters + 1;
    if (bytes > MAX_PROJECT_TEXT_BYTES)
        throw new Error('Canonical project document exceeds 96 MiB');
}

/** Validate references, checksums and schema before a project can replace stored data. */
export function validateProject(value: unknown): ProjectDocument {
    const input = record(value, 'project');
    const allowed = [
        'format',
        'version',
        'id',
        'name',
        'revision',
        'createdAt',
        'updatedAt',
        'activeSceneId',
        'scenes',
        'assets',
        'prefabs',
        'instances',
        'scripts',
        'clips'
    ];
    for (const key of Object.keys(input))
        if (!allowed.includes(key)) throw new Error(`project.${key}: unknown field`);
    if (input['format'] !== 'hilo3d-project' || input['version'] !== 1)
        throw new Error('Unsupported project format or version');
    const name = input['name'];
    if (
        typeof name !== 'string' ||
        name.length > 120 ||
        !name.trim() ||
        Array.from(name).some(character => character.charCodeAt(0) < 32)
    )
        throw new Error('project.name: expected a nonempty name of at most 120 characters');
    const revision = input['revision'];
    if (
        typeof revision !== 'number' ||
        !Number.isSafeInteger(revision) ||
        revision < 0 ||
        revision >= Number.MAX_SAFE_INTEGER
    )
        throw new Error('project.revision: expected a nonnegative safe integer');
    const createdAt = timestamp(input['createdAt'], 'project.createdAt');
    const updatedAt = timestamp(input['updatedAt'], 'project.updatedAt');
    if (updatedAt < createdAt) throw new Error('project.updatedAt precedes creation');
    const sceneInput = record(input['scenes'], 'project.scenes');
    const assetInput = record(input['assets'], 'project.assets');
    const sceneIds = Object.keys(sceneInput).sort();
    const assetIds = Object.keys(assetInput).sort();
    if (sceneIds.length < 1 || sceneIds.length > 32)
        throw new Error('Projects require 1 to 32 scenes');
    if (assetIds.length > 128) throw new Error('Projects support at most 128 assets');
    // Reject an oversized bundle before decoding/hashing binaries or validating every scene.
    // Recheck after normalization too, since validation can add canonical registry fields.
    enforcePortableBudget(input, assetInput);
    const assets: Record<string, ProjectAsset> = {};
    let assetBytes = 0;
    for (const id of assetIds) {
        identifier(id, `project.assets.${id}`);
        const asset = validateAsset(assetInput[id]);
        if (asset.id !== id)
            throw new Error(`project.assets.${id}: asset ID does not match its record key`);
        assetBytes += asset.size;
        if (assetBytes > MAX_PROJECT_ASSET_BYTES)
            throw new Error('Project asset data exceeds 64 MiB');
        assets[id] = asset;
    }
    const requireAsset = (id: string, kind: ProjectAsset['kind'], path: string): void => {
        if (!Object.hasOwn(assets, id) || assets[id]?.kind !== kind)
            throw new Error(`${path}: missing ${kind} asset "${id}"`);
    };
    const scenes: Record<string, SceneDocument> = {};
    for (const id of sceneIds) {
        identifier(id, `project.scenes.${id}`);
        const scene = parseScene(JSON.stringify(sceneInput[id]));
        for (const [nodeId, node] of Object.entries(scene.nodes)) {
            if (node.type === 'model' && node.asset)
                requireAsset(node.asset, 'model', `project.scenes.${id}.nodes.${nodeId}.asset`);
        }
        for (const [materialId, material] of Object.entries(scene.materials)) {
            for (const slot of [
                'baseColorTexture',
                'normalTexture',
                'metallicRoughnessTexture',
                'emissiveTexture'
            ] as const) {
                const assetId = material[slot];
                if (assetId)
                    requireAsset(
                        assetId,
                        'texture',
                        `project.scenes.${id}.materials.${materialId}.${slot}`
                    );
            }
        }
        scenes[id] = scene;
    }
    const activeSceneId = identifier(input['activeSceneId'], 'project.activeSceneId');
    if (!Object.hasOwn(scenes, activeSceneId))
        throw new Error('project.activeSceneId references a missing scene');
    const result: ProjectDocument = {
        format: 'hilo3d-project',
        version: 1,
        id: identifier(input['id'], 'project.id'),
        name,
        revision,
        createdAt,
        updatedAt,
        activeSceneId,
        scenes,
        assets,
        ...validateAuthoring(input, scenes, assets)
    };
    enforcePortableBudget({ ...result }, result.assets);
    return result;
}

/** Migrate a standalone scene into a new local project without changing scene content. */
export function createProject(scene: SceneDocument, name = scene.name): ProjectDocument {
    const now = new Date().toISOString();
    return validateProject({
        format: 'hilo3d-project',
        version: 1,
        id: `project-${crypto.randomUUID()}`,
        name,
        revision: 0,
        createdAt: now,
        updatedAt: now,
        activeSceneId: 'scene-main',
        scenes: { 'scene-main': parseScene(serializeScene(scene)) },
        assets: {}
    });
}

/** Parse a portable JSON bundle, checking every embedded asset and scene before returning. */
export function parseProject(source: string): ProjectDocument {
    if (
        source.length > MAX_PROJECT_TEXT_BYTES ||
        new TextEncoder().encode(source).byteLength > MAX_PROJECT_TEXT_BYTES
    )
        throw new Error('Project document exceeds 96 MiB');
    let input: unknown;
    try {
        input = JSON.parse(source) as unknown;
    } catch {
        throw new Error('Project contains invalid JSON');
    }
    return validateProject(input);
}

/** Produce deterministic self-contained JSON suitable for backups and transfer to another browser. */
export function serializeProject(project: ProjectDocument): string {
    const source = `${JSON.stringify(validateProject(project), null, 2)}\n`;
    if (new TextEncoder().encode(source).byteLength > MAX_PROJECT_TEXT_BYTES)
        throw new Error('Project document exceeds 96 MiB');
    return source;
}

/** Lightweight metadata returned by the project browser and recovery history. */
export function projectSummary(project: ProjectDocument): ProjectSummary {
    return {
        id: project.id,
        name: project.name,
        revision: project.revision,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        activeSceneId: project.activeSceneId,
        sceneCount: Object.keys(project.scenes).length,
        assetCount: Object.keys(project.assets).length
    };
}
