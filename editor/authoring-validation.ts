import { validateClip, validateClipTargets, type AnimationClip } from './animation';
import { validatePrefab, type PrefabDefinition, type PrefabInstance } from './prefabs';
import { validateScript, type ScriptDocument } from './script-types';
import { parseScene, type SceneDocument } from './scene';
import type { ProjectAsset } from './assets';

export interface AuthoringRegistry {
    prefabs: Record<string, PrefabDefinition>;
    instances: Record<string, PrefabInstance>;
    scripts: Record<string, ScriptDocument>;
    clips: Record<string, AnimationClip>;
}
function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${label} must be an object.`);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        throw new Error(`${label} must be a plain object.`);
    return value as Record<string, unknown>;
}
function id(value: unknown): string {
    if (
        typeof value !== 'string' ||
        value.length > 64 ||
        !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value) ||
        value === 'constructor' ||
        value === 'prototype'
    )
        throw new Error('Invalid authoring record ID.');
    return value;
}
function keys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
    if (Object.keys(record).some(key => !allowed.includes(key)))
        throw new Error(`${label} contains an unknown field.`);
}
function registry(value: unknown, label: string, max: number): Record<string, unknown> {
    const input = value === undefined ? {} : object(value, label);
    if (Object.keys(input).length > max)
        throw new Error(`${label} exceeds ${String(max)} records.`);
    return input;
}
function definition(value: unknown): PrefabDefinition {
    const input = object(value, 'Prefab');
    keys(input, ['id', 'name', 'rootId', 'nodes', 'materials'], 'Prefab');
    const scene = parseScene(
        JSON.stringify({
            format: 'hilo3d-scene',
            version: 2,
            name: input['name'],
            units: 'meters',
            environment: { background: '#222222', ambientIntensity: 1 },
            nodes: input['nodes'],
            materials: input['materials']
        })
    );
    return validatePrefab({
        id: id(input['id']),
        name: scene.name,
        rootId: id(input['rootId']),
        nodes: scene.nodes,
        materials: scene.materials
    });
}
function mapping(value: unknown): Record<string, string> {
    return Object.fromEntries(
        Object.entries(object(value, 'Prefab mapping'))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, target]) => [id(key), id(target)])
    );
}

/** Cross-registry validation is shared by project imports, persistence and collaboration. */
export function validateAuthoring(
    input: Record<string, unknown>,
    scenes: Record<string, SceneDocument>,
    assets: Record<string, ProjectAsset>
): AuthoringRegistry {
    const result: AuthoringRegistry = { prefabs: {}, instances: {}, scripts: {}, clips: {} };
    const clipRecords = registry(input['clips'], 'Animation clips', 128);
    let totalKeys = 0;
    // Count raw arrays before cloning/validating every clip so many individually valid clips
    // cannot multiply the project budget into millions of retained keyframe objects.
    for (const clipValue of Object.values(clipRecords)) {
        const tracks = object(clipValue, 'Animation clip')['tracks'];
        if (!Array.isArray(tracks)) continue;
        if (tracks.length > 3000) throw new Error('Animation clip exceeds 3000 tracks');
        for (const trackValue of tracks) {
            const keyframes = object(trackValue, 'Animation track')['keys'];
            if (Array.isArray(keyframes)) totalKeys += keyframes.length;
            if (totalKeys > 100_000)
                throw new Error('Project animation key budget exceeds 100000 keys');
        }
    }

    for (const [key, value] of Object.entries(registry(input['scripts'], 'Scripts', 64)).sort()) {
        const script = validateScript(value);
        if (id(key) !== script.id) throw new Error('Script ID differs from its record key.');
        result.scripts[key] = script;
    }
    const references = (scene: Pick<SceneDocument, 'nodes' | 'materials'>): void => {
        for (const node of Object.values(scene.nodes)) {
            if (node.asset && assets[node.asset]?.kind !== 'model')
                throw new Error(`Missing model asset ${node.asset}.`);
            for (const script of node.scripts ?? [])
                if (!Object.hasOwn(result.scripts, script))
                    throw new Error(`Missing script ${script}.`);
        }
        for (const material of Object.values(scene.materials)) {
            for (const slot of [
                'baseColorTexture',
                'normalTexture',
                'metallicRoughnessTexture',
                'emissiveTexture'
            ] as const) {
                const texture = material[slot];
                if (texture && assets[texture]?.kind !== 'texture')
                    throw new Error(`Missing texture asset ${texture}.`);
            }
        }
    };
    for (const scene of Object.values(scenes)) references(scene);
    for (const [key, value] of Object.entries(registry(input['prefabs'], 'Prefabs', 64)).sort()) {
        const prefab = definition(value);
        if (id(key) !== prefab.id) throw new Error('Prefab ID differs from its record key.');
        references(prefab);
        result.prefabs[key] = prefab;
    }
    const occupied = new Set<string>();
    for (const [key, value] of Object.entries(
        registry(input['instances'], 'Prefab instances', 256)
    ).sort()) {
        const item = object(value, 'Prefab instance');
        keys(
            item,
            ['id', 'prefabId', 'sceneId', 'rootId', 'nodeMap', 'materialMap', 'baseline'],
            'Prefab instance'
        );
        const instance: PrefabInstance = {
            id: id(item['id']),
            prefabId: id(item['prefabId']),
            sceneId: id(item['sceneId']),
            rootId: id(item['rootId']),
            nodeMap: mapping(item['nodeMap']),
            materialMap: mapping(item['materialMap']),
            baseline: definition(item['baseline'])
        };
        if (
            id(key) !== instance.id ||
            !Object.hasOwn(result.prefabs, instance.prefabId) ||
            instance.baseline.id !== instance.prefabId
        )
            throw new Error('Prefab instance refers to a missing or mismatched template.');
        const scene = scenes[instance.sceneId];
        if (!scene?.nodes[instance.rootId])
            throw new Error('Prefab instance root or scene is missing.');
        if (instance.nodeMap[instance.baseline.rootId] !== instance.rootId)
            throw new Error('Prefab root mapping is inconsistent.');
        if (
            Object.keys(instance.nodeMap).length !== Object.keys(instance.baseline.nodes).length ||
            Object.keys(instance.materialMap).length !==
                Object.keys(instance.baseline.materials).length
        )
            throw new Error('Prefab baseline mapping is incomplete.');
        for (const source of Object.keys(instance.baseline.nodes)) {
            const target = instance.nodeMap[source];
            if (!target) throw new Error('Prefab node mapping is incomplete.');
            const identity = `${instance.sceneId}/${target}`;
            if (occupied.has(identity))
                throw new Error('A node cannot belong to overlapping prefab instances.');
            occupied.add(identity);
        }
        for (const source of Object.keys(instance.baseline.materials)) {
            const target = instance.materialMap[source];
            if (!target || !scene.materials[target])
                throw new Error('Prefab material mapping is incomplete.');
        }
        references(instance.baseline);
        result.instances[key] = instance;
    }
    for (const [key, value] of Object.entries(clipRecords).sort()) {
        const clip = validateClip(value);
        if (id(key) !== clip.id) throw new Error('Animation clip ID differs from its record key.');
        const scene = scenes[clip.sceneId];
        if (!scene) throw new Error('Animation clip references a missing scene.');
        validateClipTargets(clip, scene);
        result.clips[key] = clip;
    }
    return result;
}
