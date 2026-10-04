import {
    cloneScene,
    parseScene,
    type SceneDocument,
    type SceneNode,
    type SceneMaterial
} from './scene';

export interface PrefabDefinition {
    id: string;
    name: string;
    rootId: string;
    nodes: Record<string, SceneNode>;
    materials: Record<string, SceneMaterial>;
}

export interface PrefabInstance {
    id: string;
    prefabId: string;
    sceneId: string;
    rootId: string;
    nodeMap: Record<string, string>;
    materialMap: Record<string, string>;
    baseline: PrefabDefinition;
}

export interface PrefabOverride {
    nodeId: string;
    property: string;
    kind: 'changed' | 'removed' | 'added';
}

export interface PrefabUpdate {
    scene: SceneDocument;
    instance: PrefabInstance;
    warnings: string[];
}

function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
function unique(prefix: string, record: Record<string, unknown>): string {
    const stem = prefix.slice(0, 54).replace(/-+$/u, '');
    let id = stem;
    let index = 1;
    while (Object.hasOwn(record, id)) id = `${stem}-${String(index++)}`;
    return id;
}
function descendants(scene: SceneDocument, rootId: string): Set<string> {
    const result = new Set([rootId]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const [id, node] of Object.entries(scene.nodes)) {
            if (node.parent && result.has(node.parent) && !result.has(id)) {
                result.add(id);
                changed = true;
            }
        }
    }
    return result;
}
function templateScene(definition: PrefabDefinition): SceneDocument {
    return parseScene(
        JSON.stringify({
            format: 'hilo3d-scene',
            version: 2,
            name: definition.name,
            units: 'meters',
            environment: { background: '#222222', ambientIntensity: 1 },
            nodes: definition.nodes,
            materials: definition.materials
        })
    );
}

/** Capture a complete subtree as a reusable template, retaining external project asset IDs. */
export function createPrefab(
    scene: SceneDocument,
    rootId: string,
    id: string,
    name: string
): PrefabDefinition {
    const valid = cloneScene(scene);
    const source = valid.nodes[rootId];
    if (!source) throw new Error('Select an existing object to create a prefab.');
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(id) || id.length > 64)
        throw new Error('Invalid prefab ID.');
    const ids = descendants(valid, rootId);
    const nodes = Object.fromEntries(Object.entries(valid.nodes).filter(([key]) => ids.has(key)));
    const root = nodes[rootId];
    if (!root) throw new Error('Prefab root was not captured.');
    root.parent = null;
    const materialIds = new Set(
        Object.values(nodes).flatMap(node => (node.material ? [node.material] : []))
    );
    const materials = Object.fromEntries(
        Object.entries(valid.materials).filter(([key]) => materialIds.has(key))
    );
    const definition = { id, name: name.trim(), rootId, nodes, materials };
    const parsed = templateScene(definition);
    return { ...definition, nodes: parsed.nodes, materials: parsed.materials };
}

/** Validate a stored prefab without interpreting arbitrary constructors or executable content. */
export function validatePrefab(value: PrefabDefinition): PrefabDefinition {
    const validated = createPrefab(templateScene(value), value.rootId, value.id, value.name);
    if (Object.keys(validated.nodes).length !== Object.keys(value.nodes).length)
        throw new Error('Prefab nodes must all belong to its root subtree.');
    if (value.nodes[value.rootId]?.parent !== null)
        throw new Error('Prefab root cannot have a parent.');
    return validated;
}
function mappedNode(
    source: SceneNode,
    sourceId: string,
    definition: PrefabDefinition,
    instance: PrefabInstance
): SceneNode {
    const node = structuredClone(source);
    node.parent =
        sourceId === definition.rootId
            ? null
            : source.parent
              ? (instance.nodeMap[source.parent] ?? null)
              : null;
    if (source.material) {
        const material = instance.materialMap[source.material];
        if (!material) throw new Error(`Prefab material mapping is missing: ${source.material}`);
        node.material = material;
    }
    return node;
}

/** Instantiate with fresh node and material IDs; each instance's overrides remain isolated. */
export function instantiatePrefab(
    scene: SceneDocument,
    prefab: PrefabDefinition,
    sceneId: string,
    instanceId: string
): PrefabUpdate {
    const definition = validatePrefab(prefab);
    const next = cloneScene(scene);
    const instance: PrefabInstance = {
        id: instanceId,
        prefabId: definition.id,
        sceneId,
        rootId: '',
        nodeMap: {},
        materialMap: {},
        baseline: structuredClone(definition)
    };
    for (const [id, material] of Object.entries(definition.materials)) {
        const mapped = unique(`${instanceId}-${id}`, next.materials);
        instance.materialMap[id] = mapped;
        next.materials[mapped] = structuredClone(material);
    }
    for (const id of Object.keys(definition.nodes)) {
        const mapped = unique(`${instanceId}-${id}`, next.nodes);
        instance.nodeMap[id] = mapped;
        const source = definition.nodes[id];
        if (source) next.nodes[mapped] = structuredClone(source);
    }
    for (const [id, source] of Object.entries(definition.nodes)) {
        const mapped = instance.nodeMap[id];
        if (mapped) next.nodes[mapped] = mappedNode(source, id, definition, instance);
    }
    instance.rootId = instance.nodeMap[definition.rootId] ?? '';
    return { scene: cloneScene(next), instance, warnings: [] };
}

/** Report authored changes against the exact template revision from which an instance derives. */
export function prefabOverrides(scene: SceneDocument, instance: PrefabInstance): PrefabOverride[] {
    const overrides: PrefabOverride[] = [];
    const rootParent = scene.nodes[instance.rootId]?.parent;
    for (const [sourceId, baseline] of Object.entries(instance.baseline.nodes)) {
        const id = instance.nodeMap[sourceId];
        if (!id) continue;
        const current = scene.nodes[id];
        if (!current) {
            overrides.push({ nodeId: id, property: 'node', kind: 'removed' });
            continue;
        }
        const expected = mappedNode(baseline, sourceId, instance.baseline, instance);
        if (sourceId === instance.baseline.rootId) expected.parent = rootParent ?? null;
        for (const key of new Set([...Object.keys(expected), ...Object.keys(current)])) {
            if (!same(Reflect.get(expected, key), Reflect.get(current, key)))
                overrides.push({ nodeId: id, property: key, kind: 'changed' });
        }
    }
    for (const [sourceId, baseline] of Object.entries(instance.baseline.materials)) {
        const mapped = instance.materialMap[sourceId];
        if (mapped && !same(scene.materials[mapped], baseline))
            overrides.push({ nodeId: mapped, property: 'material', kind: 'changed' });
    }
    const mappedIds = new Set(Object.values(instance.nodeMap));
    for (const id of descendants(scene, instance.rootId))
        if (!mappedIds.has(id)) overrides.push({ nodeId: id, property: 'node', kind: 'added' });
    return overrides;
}

/** Merge a new template revision while preserving explicit field-level instance edits. */
export function updatePrefabInstance(
    scene: SceneDocument,
    prefab: PrefabDefinition,
    original: PrefabInstance,
    revert = false
): PrefabUpdate {
    const definition = validatePrefab(prefab);
    if (definition.id !== original.prefabId)
        throw new Error('Prefab ID does not match this instance.');
    if (definition.rootId !== original.baseline.rootId)
        throw new Error('Prefab root identity cannot change; unpack and create a new instance.');
    const next = cloneScene(scene);
    const instance = structuredClone(original);
    const warnings: string[] = [];
    const rootParent = next.nodes[instance.rootId]?.parent ?? null;
    for (const [sourceId, value] of Object.entries(definition.materials)) {
        const mapped =
            instance.materialMap[sourceId] ?? unique(`${instance.id}-${sourceId}`, next.materials);
        instance.materialMap[sourceId] = mapped;
        const baseline = original.baseline.materials[sourceId];
        const current = next.materials[mapped];
        if (!current || revert || same(current, baseline))
            next.materials[mapped] = structuredClone(value);
        else {
            const merged = { ...current };
            for (const key of new Set([...Object.keys(value), ...Object.keys(baseline ?? {})])) {
                if (same(Reflect.get(current, key), baseline && Reflect.get(baseline, key))) {
                    if (Object.hasOwn(value, key))
                        Reflect.set(merged, key, Reflect.get(value, key));
                    else Reflect.deleteProperty(merged, key);
                }
            }
            next.materials[mapped] = merged;
        }
    }
    for (const sourceId of Object.keys(definition.nodes)) {
        instance.nodeMap[sourceId] ??= unique(`${instance.id}-${sourceId}`, {
            ...next.nodes,
            ...Object.fromEntries(Object.values(instance.nodeMap).map(id => [id, true]))
        });
    }
    for (const [sourceId, source] of Object.entries(definition.nodes)) {
        const id = instance.nodeMap[sourceId];
        if (!id) continue;
        const previousSource = original.baseline.nodes[sourceId];
        const current = next.nodes[id];
        if (!current && previousSource && !revert) continue; // Deliberately removed instance child.
        const incoming = mappedNode(source, sourceId, definition, instance);
        if (sourceId === definition.rootId) incoming.parent = rootParent;
        if (!current || !previousSource || revert) next.nodes[id] = incoming;
        else {
            const baseline = mappedNode(previousSource, sourceId, original.baseline, original);
            if (sourceId === original.baseline.rootId) baseline.parent = rootParent;
            const merged = structuredClone(current);
            for (const key of new Set([...Object.keys(incoming), ...Object.keys(baseline)])) {
                if (same(Reflect.get(current, key), Reflect.get(baseline, key))) {
                    if (Object.hasOwn(incoming, key))
                        Reflect.set(merged, key, Reflect.get(incoming, key));
                    else Reflect.deleteProperty(merged, key);
                } else if (key === 'transform') {
                    for (const group of ['position', 'rotation', 'scale'] as const)
                        for (const axis of ['x', 'y', 'z'] as const) {
                            if (current.transform[group][axis] === baseline.transform[group][axis])
                                merged.transform[group][axis] = incoming.transform[group][axis];
                        }
                }
            }
            next.nodes[id] = merged;
        }
    }
    const removed = new Set<string>();
    for (const [sourceId, id] of Object.entries(original.nodeMap)) {
        if (definition.nodes[sourceId]) continue;
        const current = next.nodes[id];
        const oldSource = original.baseline.nodes[sourceId];
        if (
            current &&
            oldSource &&
            !revert &&
            !same(current, mappedNode(oldSource, sourceId, original.baseline, original))
        ) {
            warnings.push(`Kept overridden object ${current.name} as an unpacked local object.`);
        } else removed.add(id);
        Reflect.deleteProperty(instance.nodeMap, sourceId);
    }
    // Keep locally added descendants, reparenting them if their template parent disappeared.
    for (const node of Object.values(next.nodes))
        if (node.parent && removed.has(node.parent)) node.parent = original.rootId;
    next.nodes = Object.fromEntries(Object.entries(next.nodes).filter(([id]) => !removed.has(id)));
    instance.materialMap = Object.fromEntries(
        Object.entries(instance.materialMap).filter(([id]) =>
            Object.hasOwn(definition.materials, id)
        )
    );
    instance.baseline = structuredClone(definition);
    instance.rootId = instance.nodeMap[definition.rootId] ?? instance.rootId;
    return { scene: cloneScene(next), instance, warnings };
}

/** Apply a concrete instance back to its template, remapping references into template identity. */
export function prefabFromInstance(
    scene: SceneDocument,
    instance: PrefabInstance
): PrefabDefinition {
    const captured = createPrefab(
        scene,
        instance.rootId,
        instance.prefabId,
        instance.baseline.name
    );
    const inverseNodes = Object.fromEntries(
        Object.entries(instance.nodeMap).map(([source, id]) => [id, source])
    );
    const inverseMaterials = Object.fromEntries(
        Object.entries(instance.materialMap).map(([source, id]) => [id, source])
    );
    const nodes: Record<string, SceneNode> = {};
    const materials: Record<string, SceneMaterial> = {};
    for (const [id, value] of Object.entries(captured.materials)) {
        const mapped =
            inverseMaterials[id] ??
            unique(id, {
                ...materials,
                ...Object.fromEntries(Object.values(inverseMaterials).map(key => [key, true]))
            });
        inverseMaterials[id] = mapped;
        materials[mapped] = value;
    }
    for (const id of Object.keys(captured.nodes))
        inverseNodes[id] ??= unique(id, {
            ...nodes,
            ...Object.fromEntries(Object.values(inverseNodes).map(key => [key, true]))
        });
    for (const [id, value] of Object.entries(captured.nodes)) {
        const node = structuredClone(value);
        node.parent = node.parent ? (inverseNodes[node.parent] ?? null) : null;
        if (node.material) node.material = inverseMaterials[node.material] ?? node.material;
        nodes[inverseNodes[id] ?? id] = node;
    }
    return validatePrefab({
        id: instance.prefabId,
        name: captured.name,
        rootId: inverseNodes[instance.rootId] ?? instance.rootId,
        nodes,
        materials
    });
}
