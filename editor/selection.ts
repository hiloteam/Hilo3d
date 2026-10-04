import { validateProject, type ProjectDocument } from './project';
import type { SceneDocument } from './scene';

function unique(prefix: string, values: Record<string, unknown>): string {
    const stem = prefix.slice(0, 55).replace(/-+$/u, '');
    let count = 1;
    let id = `${stem}-${String(count)}`;
    while (Object.hasOwn(values, id)) id = `${stem}-${String(++count)}`;
    return id;
}
/** Selected roots prevent an ancestor and its descendant from being duplicated twice. */
export function selectionRoots(scene: SceneDocument, ids: readonly string[]): string[] {
    const selected = new Set(ids.filter(id => Object.hasOwn(scene.nodes, id)));
    return [...selected].filter(id => {
        let parent = scene.nodes[id]?.parent;
        while (parent) {
            if (selected.has(parent)) return false;
            parent = scene.nodes[parent]?.parent;
        }
        return true;
    });
}
export function selectionSubtrees(scene: SceneDocument, ids: readonly string[]): Set<string> {
    const result = new Set(selectionRoots(scene, ids));
    let changed = true;
    while (changed) {
        changed = false;
        for (const [id, node] of Object.entries(scene.nodes))
            if (node.parent && result.has(node.parent) && !result.has(id)) {
                result.add(id);
                changed = true;
            }
    }
    return result;
}
/** Clone complete selected hierarchies, preserving prefab links and animation bindings. */
export function duplicateSelection(
    project: ProjectDocument,
    ids: readonly string[]
): { project: ProjectDocument; selection: string[] } {
    const next = structuredClone(project);
    const scene = next.scenes[next.activeSceneId];
    if (!scene) throw new Error('Active scene is missing.');
    const roots = selectionRoots(scene, ids);
    if (!roots.length) throw new Error('Select objects to duplicate.');
    const included = selectionSubtrees(scene, roots);
    const mapping = new Map<string, string>();
    for (const id of included) {
        const source = scene.nodes[id];
        if (!source) continue;
        const target = unique(`${id}-copy`, scene.nodes);
        mapping.set(id, target);
        scene.nodes[target] = structuredClone(source);
    }
    for (const [id, target] of mapping) {
        const node = scene.nodes[target];
        if (!node) continue;
        if (node.parent) node.parent = mapping.get(node.parent) ?? node.parent;
        if (roots.includes(id)) {
            node.name = `${node.name.slice(0, 115)} copy`;
            node.transform.position.x = Math.min(10000, node.transform.position.x + 0.6);
        }
    }
    for (const instance of Object.values(project.instances)) {
        const rootId = mapping.get(instance.rootId);
        if (instance.sceneId !== next.activeSceneId || !rootId) continue;
        const instanceId = unique('instance-copy', next.instances);
        const copied = structuredClone(instance);
        copied.id = instanceId;
        copied.rootId = rootId;
        copied.nodeMap = Object.fromEntries(
            Object.entries(instance.nodeMap).map(([source, id]) => [
                source,
                mapping.get(id) ?? unique(`${id}-removed`, scene.nodes)
            ])
        );
        for (const [source, materialId] of Object.entries(instance.materialMap)) {
            const material = scene.materials[materialId];
            if (!material) continue;
            const targetId = unique(`${materialId}-copy`, scene.materials);
            scene.materials[targetId] = structuredClone(material);
            copied.materialMap[source] = targetId;
            for (const id of Object.values(copied.nodeMap)) {
                const node = scene.nodes[id];
                if (node?.material === materialId) node.material = targetId;
            }
        }
        next.instances[instanceId] = copied;
    }
    for (const clip of Object.values(next.clips)) {
        if (clip.sceneId !== next.activeSceneId) continue;
        const occupied = Object.fromEntries(clip.tracks.map(track => [track.id, true]));
        const copied = clip.tracks.flatMap(track => {
            const nodeId = mapping.get(track.nodeId);
            if (!nodeId) return [];
            const id = unique(`${track.id}-copy`, occupied);
            occupied[id] = true;
            return [{ ...structuredClone(track), id, nodeId }];
        });
        clip.tracks.push(...copied);
    }
    return {
        project: validateProject(next),
        selection: roots.map(id => mapping.get(id) ?? '').filter(Boolean)
    };
}
