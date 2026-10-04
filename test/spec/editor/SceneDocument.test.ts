import { describe, expect, it } from 'vitest';
import {
    cloneScene,
    createDefaultScene,
    parseScene,
    SceneHistory,
    serializeScene,
    type SceneDocument,
    type SceneNode
} from '../../../editor/scene';

function getNode(scene: SceneDocument, id = 'hero-sphere'): SceneNode {
    const node = scene.nodes[id];
    if (!node) throw new Error(`Missing test node ${id}`);
    return node;
}

function parseEdited(edit: (scene: SceneDocument) => void): SceneDocument {
    const scene = createDefaultScene();
    edit(scene);
    return parseScene(JSON.stringify(scene));
}

function group(parent: string | null): SceneNode {
    return {
        name: 'Group',
        type: 'group',
        parent,
        visible: true,
        transform: {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        }
    };
}

describe('editor scene source', () => {
    it('round trips the complete default composition without introducing runtime data', () => {
        const scene = createDefaultScene();
        const source = serializeScene(scene);
        expect(parseScene(source)).toEqual(scene);
        expect(source.endsWith('\n')).toBe(true);
        expect(Object.values(scene.nodes).filter(node => node.type === 'mesh')).toHaveLength(7);
        expect(getNode(scene).parent).toBe('sculpture');
        expect(getNode(scene, 'key-light').light?.kind).toBe('directional');
        expect(Object.keys(scene)).toEqual([
            'format',
            'version',
            'name',
            'units',
            'environment',
            'materials',
            'nodes'
        ]);
    });

    it('canonicalizes record order, color case and negative zero without losing precision', () => {
        const scene = createDefaultScene();
        const reversed = cloneScene(scene);
        reversed.nodes = Object.fromEntries(Object.entries(scene.nodes).reverse());
        reversed.materials = Object.fromEntries(Object.entries(scene.materials).reverse());
        reversed.environment.background = scene.environment.background.toUpperCase();
        getNode(reversed).transform.rotation.x = -0;
        expect(serializeScene(reversed)).toBe(serializeScene(scene));
        getNode(reversed).transform.position.x = 0.123456789;
        const restored = parseScene(serializeScene(reversed));
        expect(getNode(restored).transform.position.x).toBe(0.123456789);
        expect(serializeScene(restored)).toBe(serializeScene(reversed));
    });

    it('deep clones mutable authoring data and does not share defaults between calls', () => {
        const scene = createDefaultScene();
        const copy = cloneScene(scene);
        getNode(copy).transform.position.x = 42;
        copy.environment.background = '#ffffff';
        expect(getNode(scene).transform.position.x).toBe(0);
        expect(scene.environment.background).toBe('#343639');
        expect(createDefaultScene()).toEqual(scene);
    });

    it('accepts empty scenes and Unicode display names without using names as identity', () => {
        const scene = createDefaultScene();
        scene.name = '陶土 · Étude';
        scene.nodes = {};
        scene.materials = {};
        expect(parseScene(serializeScene(scene))).toEqual(scene);
    });

    it('rejects malformed JSON, unknown fields and unsupported format versions', () => {
        expect(() => parseScene('{')).toThrow('invalid JSON');
        expect(() => parseScene('[]')).toThrow('expected an object');
        expect(() => parseScene(JSON.stringify({ ...createDefaultScene(), version: 99 }))).toThrow(
            'version'
        );
        expect(() =>
            parseScene(JSON.stringify({ ...createDefaultScene(), format: 'other' }))
        ).toThrow('format');
        expect(() =>
            parseScene(JSON.stringify({ ...createDefaultScene(), units: 'feet' }))
        ).toThrow('units');
        expect(() =>
            parseScene(JSON.stringify({ ...createDefaultScene(), scripts: ['alert(1)'] }))
        ).toThrow('unknown field');
        expect(() =>
            parseEdited(scene => {
                Object.assign(getNode(scene).transform.position, { w: 1 });
            })
        ).toThrow('unknown field');
    });

    it('migrates legacy v1 and validates model, camera, texture and script references', () => {
        const scene = createDefaultScene();
        expect(parseScene(JSON.stringify({ ...scene, version: 1 })).version).toBe(2);
        const model: SceneNode = {
            ...group(null),
            type: 'model',
            asset: 'model-car',
            locked: true,
            scripts: ['orbit']
        };
        scene.nodes['car'] = model;
        scene.nodes['camera'] = {
            ...group(null),
            type: 'camera',
            camera: { fov: 50, near: 0.1, far: 100 }
        };
        const material = scene.materials['porcelain'];
        if (!material) throw new Error('Missing material');
        material.baseColorTexture = 'texture-marble';
        expect(parseScene(serializeScene(scene))).toEqual(scene);
        expect(() =>
            parseScene(
                JSON.stringify({ ...scene, nodes: { broken: { ...model, asset: undefined } } })
            )
        ).toThrow('asset');
        expect(() =>
            parseScene(
                JSON.stringify({
                    ...scene,
                    nodes: {
                        camera: {
                            ...group(null),
                            type: 'camera',
                            camera: { fov: 50, near: 10, far: 1 }
                        }
                    }
                })
            )
        ).toThrow('far must');
    });

    it('rejects dangling node/material references and direct or indirect parent cycles', () => {
        expect(() =>
            parseEdited(scene => {
                getNode(scene).parent = 'missing';
            })
        ).toThrow('missing node');
        expect(() =>
            parseEdited(scene => {
                getNode(scene).material = 'missing';
            })
        ).toThrow('missing material');
        expect(() =>
            parseEdited(scene => {
                getNode(scene).parent = 'hero-sphere';
            })
        ).toThrow('cycle');
        expect(() =>
            parseEdited(scene => {
                getNode(scene, 'sculpture').parent = 'hero-sphere';
            })
        ).toThrow('cycle');
    });

    it('rejects fields inconsistent with the node type and incomplete transforms', () => {
        expect(() =>
            parseEdited(scene => {
                delete getNode(scene).geometry;
            })
        ).toThrow('geometry');
        expect(() =>
            parseEdited(scene => {
                delete getNode(scene).material;
            })
        ).toThrow('material');
        expect(() =>
            parseEdited(scene => {
                getNode(scene, 'sculpture').geometry = 'cube';
            })
        ).toThrow('only mesh');
        expect(() =>
            parseEdited(scene => {
                delete getNode(scene, 'key-light').light;
            })
        ).toThrow('expected an object');
        expect(() =>
            parseEdited(scene => {
                getNode(scene).light = { kind: 'ambient', color: '#ffffff', intensity: 1 };
            })
        ).toThrow('only light');
        expect(() =>
            parseEdited(scene => {
                Object.assign(getNode(scene).transform, { rotation: { x: 1, y: 2 } });
            })
        ).toThrow('rotation.z');
    });

    it('rejects nonfinite values and unreasonable transforms or material parameters', () => {
        const scene = createDefaultScene();
        getNode(scene).transform.position.x = Number.NaN;
        expect(() => serializeScene(scene)).toThrow('finite number');
        getNode(scene).transform.position.x = Infinity;
        expect(() => cloneScene(scene)).toThrow('finite number');
        expect(() =>
            parseScene(
                serializeScene(createDefaultScene()).replace(
                    '"ambientIntensity": 0.8',
                    '"ambientIntensity": 1e999'
                )
            )
        ).toThrow('finite number');
        expect(() =>
            parseEdited(value => {
                getNode(value).transform.scale.x = 0;
            })
        ).toThrow('scale.x');
        expect(() =>
            parseEdited(value => {
                getNode(value).transform.position.y = 10001;
            })
        ).toThrow('position.y');
        expect(() =>
            parseEdited(value => {
                getNode(value).transform.rotation.z = 360001;
            })
        ).toThrow('rotation.z');
        expect(() =>
            parseEdited(value => {
                value.materials['bad'] = {
                    name: 'Bad',
                    color: '#ff0000',
                    metallic: 2,
                    roughness: 0.5
                };
            })
        ).toThrow('metallic');
        expect(() =>
            parseEdited(value => {
                value.environment.background = 'red';
            })
        ).toThrow('#RRGGBB');
    });

    it('bounds shadowed directional lights before rendering, including hidden lights', () => {
        const scene = createDefaultScene();
        const key = getNode(scene, 'key-light');
        for (let index = 1; index < 8; index += 1) {
            scene.nodes[`key-light-${String(index)}`] = structuredClone(key);
        }
        expect(parseScene(serializeScene(scene))).toEqual(scene);
        scene.nodes['hidden-ninth-light'] = { ...structuredClone(key), visible: false };
        expect(() => parseScene(JSON.stringify(scene))).toThrow('directional light limit is 8');
        const ninth = getNode(scene, 'hidden-ninth-light');
        if (!ninth.light) throw new Error('Test light is missing');
        ninth.light.kind = 'ambient';
        expect(parseScene(serializeScene(scene))).toEqual(scene);
    });

    it('rejects prototype-like keys and nonsemantic IDs', () => {
        expect(() =>
            parseEdited(scene => {
                Object.assign(scene.nodes, { constructor: group(null) });
            })
        ).toThrow('kebab-case');
        expect(() =>
            parseEdited(scene => {
                scene.nodes['Has spaces'] = group(null);
            })
        ).toThrow('kebab-case');
        const document = serializeScene(createDefaultScene()).replace(
            '"nodes": {',
            '"nodes": { "__proto__": {},'
        );
        expect(() => parseScene(document)).toThrow('kebab-case');
        expect(Object.hasOwn({}, 'polluted')).toBe(false);
    });

    it('bounds input size, scene cardinality and hierarchy depth', () => {
        expect(() => parseScene(' '.repeat(2 * 1024 * 1024 + 1))).toThrow('2 MiB');
        expect(() => parseScene('陶'.repeat(800_000))).toThrow('2 MiB');
        expect(() =>
            parseEdited(scene => {
                scene.nodes = Object.fromEntries(
                    Array.from({ length: 1001 }, (_, index) => [
                        `node-${String(index)}`,
                        group(null)
                    ])
                );
            })
        ).toThrow('limit is 1000');
        expect(() =>
            parseEdited(scene => {
                scene.materials = Object.fromEntries(
                    Array.from({ length: 257 }, (_, index) => [
                        `material-${String(index)}`,
                        { name: 'Material', color: '#ffffff', metallic: 0, roughness: 1 }
                    ])
                );
            })
        ).toThrow('limit is 256');
        expect(() =>
            parseEdited(scene => {
                scene.nodes = Object.fromEntries(
                    Array.from({ length: 65 }, (_, index) => [
                        `node-${String(index)}`,
                        group(index === 0 ? null : `node-${String(index - 1)}`)
                    ])
                );
            })
        ).toThrow('maximum depth');
    });
});

describe('editor scene history', () => {
    it('records atomic changes, restores nested values, and detaches every snapshot', () => {
        const initial = createDefaultScene();
        const history = new SceneHistory(initial);
        const next = history.scene;
        getNode(next).transform.position.x = 4;
        next.name = 'Changed';
        expect(history.commit(next)).toBe(true);
        getNode(next).transform.position.x = 8;
        expect(getNode(history.scene).transform.position.x).toBe(4);
        expect(history.undo()).toEqual(initial);
        expect(history.canUndo).toBe(false);
        expect(history.canRedo).toBe(true);
        const redone = history.redo();
        expect(redone.name).toBe('Changed');
        getNode(redone).transform.position.x = 99;
        expect(getNode(history.scene).transform.position.x).toBe(4);
    });

    it('keeps redo for identical commits and drops it only for a new branch', () => {
        const history = new SceneHistory(createDefaultScene());
        const next = history.scene;
        next.name = 'First';
        history.commit(next);
        next.name = 'Second';
        history.commit(next);
        history.undo();
        expect(history.commit(history.scene)).toBe(false);
        expect(history.canRedo).toBe(true);
        next.name = 'Branch';
        history.commit(next);
        expect(history.canRedo).toBe(false);
        expect(history.redo().name).toBe('Branch');
        expect(history.undo().name).toBe('First');
    });

    it('retains 80 entries and never mutates history on invalid input', () => {
        const history = new SceneHistory(createDefaultScene());
        for (let index = 1; index <= 85; index += 1) {
            const scene = history.scene;
            scene.name = `Version ${String(index)}`;
            history.commit(scene);
        }
        let undos = 0;
        while (history.canUndo) {
            history.undo();
            undos += 1;
        }
        expect(undos).toBe(79);
        expect(history.scene.name).toBe('Version 6');
        const invalid = history.scene;
        getNode(invalid).parent = 'missing';
        expect(() => history.commit(invalid)).toThrow('missing node');
        expect(history.scene.name).toBe('Version 6');
        expect(history.canRedo).toBe(true);
        expect(history.undo().name).toBe('Version 6');
    });
});
