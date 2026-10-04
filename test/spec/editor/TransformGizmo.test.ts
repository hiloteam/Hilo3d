import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Ray, Vector3 } from '../../../src/Hilo3d';
import {
    applyTransformOperation,
    createTransformSnapshot,
    dragAxisParameter,
    dragPlanePoint,
    snapTransformValue,
    transformRoots,
    TransformGizmo
} from '../../../editor/transform-gizmo';
import { createDefaultScene, type SceneDocument, type SceneNode } from '../../../editor/scene';

function node(parent: string | null = null): SceneNode {
    return {
        name: 'Object',
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
function fixture(nodes: Record<string, SceneNode>): SceneDocument {
    return { ...createDefaultScene(), nodes };
}
function required(value: SceneNode['transform'] | undefined): SceneNode['transform'] {
    if (!value) throw new Error('Expected transformed node.');
    return value;
}

describe('editor transform gestures', () => {
    it('hides inactive handles even when application button CSS overrides the hidden attribute', () => {
        const container = document.createElement('div');
        container.className = 'gizmo-css-test';
        container.style.cssText = 'position:absolute;width:640px;height:480px;left:0;top:0';
        const style = document.createElement('style');
        style.textContent = '.gizmo-css-test button { display: flex; }';
        document.body.append(container, style);
        const camera = new PerspectiveCamera({ x: 4, y: 3, z: 5, aspect: 640 / 480 });
        camera.lookAt(new Vector3());
        const gizmo = new TransformGizmo({
            container,
            camera,
            onTransform: vi.fn(),
            onActiveChange: vi.fn(),
            onError: vi.fn()
        });
        try {
            gizmo.setScene(fixture({ object: node() }));
            gizmo.select(['object']);
            gizmo.setMode('rotate');
            const plane = container.querySelector<HTMLElement>('[data-transform-handle="xy"]');
            const uniform = container.querySelector<HTMLElement>(
                '[data-transform-handle="uniform"]'
            );
            const axis = container.querySelector<HTMLElement>('[data-transform-handle="y"]');
            expect(plane && getComputedStyle(plane).display).toBe('none');
            expect(uniform && getComputedStyle(uniform).display).toBe('none');
            expect(axis && getComputedStyle(axis).display).toBe('block');
            expect(axis?.getAttribute('aria-label')).toBe('Rotate Y');
            gizmo.setEnabled(false);
            expect(container.querySelector<HTMLElement>('.transform-gizmo')?.style.display).toBe(
                'none'
            );
        } finally {
            gizmo.destroy();
            container.remove();
            style.remove();
        }
    });
    it('filters descendants and honors inherited visibility and locks', () => {
        const parent = node();
        const child = node('parent');
        const sibling = node();
        const scene = fixture({ parent, child, sibling });
        expect(transformRoots(scene, ['child', 'parent', 'sibling', 'sibling', 'missing'])).toEqual(
            ['parent', 'sibling']
        );
        parent.locked = true;
        expect(transformRoots(scene, ['child', 'sibling'])).toEqual(['sibling']);
        parent.locked = false;
        parent.visible = false;
        expect(transformRoots(scene, ['child'])).toEqual([]);
    });

    it('converts world translation through a rotated and scaled parent', () => {
        const parent = node();
        parent.transform.position = { x: 10, y: 2, z: 3 };
        parent.transform.rotation.z = 90;
        parent.transform.scale = { x: 2, y: 3, z: 4 };
        const child = node('parent');
        child.transform.position.x = 1;
        const scene = fixture({ parent, child });
        const snapshot = createTransformSnapshot(scene, ['child'], 'world');
        const result = required(
            applyTransformOperation(snapshot, { mode: 'translate', offset: { x: 3, y: 2, z: 4 } })[
                'child'
            ]
        );
        expect(result.position.x).toBeCloseTo(2, 5);
        expect(result.position.y).toBeCloseTo(-1, 5);
        expect(result.position.z).toBeCloseTo(1, 5);
        expect(result.rotation).toEqual(child.transform.rotation);
        expect(result.scale).toEqual(child.transform.scale);
        expect(child.transform.position.x).toBe(1);
    });

    it('keeps the gesture snapshot independent of transient document previews', () => {
        const object = node();
        const scene = fixture({ object });
        const snapshot = createTransformSnapshot(scene, ['object'], 'world');
        const first = applyTransformOperation(snapshot, {
            mode: 'translate',
            offset: { x: 1, y: 0, z: 0 }
        });
        object.transform.position.x = 100;
        const second = applyTransformOperation(snapshot, {
            mode: 'translate',
            offset: { x: 2, y: 0, z: 0 }
        });
        expect(required(first['object']).position.x).toBe(1);
        expect(required(second['object']).position.x).toBe(2);
        expect(snapshot.targets[0]?.original.position.x).toBe(0);
    });

    it('moves a selected parent once without rewriting the child local transform', () => {
        const scene = fixture({ parent: node(), child: node('parent') });
        const result = applyTransformOperation(
            createTransformSnapshot(scene, ['parent', 'child'], 'world'),
            { mode: 'translate', offset: { x: 2, y: 0, z: 0 } }
        );
        expect(Object.keys(result)).toEqual(['parent']);
        expect(required(result['parent']).position.x).toBe(2);
    });

    it('rotates a multi-selection around the shared world pivot', () => {
        const a = node();
        a.transform.position.x = -2;
        const b = node();
        b.transform.position.x = 2;
        const scene = fixture({ a, b });
        const snapshot = createTransformSnapshot(scene, ['a', 'b'], 'world');
        expect(snapshot.pivot.x).toBe(0);
        const result = applyTransformOperation(snapshot, {
            mode: 'rotate',
            axis: 'z',
            angle: Math.PI / 2
        });
        expect(required(result['a']).position.y).toBeCloseTo(-2, 5);
        expect(required(result['b']).position.y).toBeCloseTo(2, 5);
        expect(required(result['a']).rotation.z).toBeCloseTo(90, 4);
    });

    it('uses the last selected root for the local handle orientation', () => {
        const a = node();
        const b = node();
        b.transform.rotation.z = 90;
        const snapshot = createTransformSnapshot(fixture({ a, b }), ['a', 'b'], 'local');
        expect(snapshot.axes.x.x).toBeCloseTo(0, 6);
        expect(snapshot.axes.x.y).toBeCloseTo(1, 6);
    });

    it('preserves authored transforms exactly for snapped neutral gestures', () => {
        const object = node();
        object.transform.rotation = { x: 18, y: 370, z: -24 };
        const snapshot = createTransformSnapshot(fixture({ object }), ['object'], 'world');
        for (const operation of [
            { mode: 'translate', offset: { x: 0, y: 0, z: 0 } },
            { mode: 'rotate', axis: 'x', angle: 0 },
            { mode: 'scale', axis: 'uniform', factor: 1 }
        ] as const)
            expect(applyTransformOperation(snapshot, operation)['object']).toEqual(
                object.transform
            );
    });

    it('allows local rotation and scale inside a nonuniform parent', () => {
        const parent = node();
        parent.transform.scale = { x: 2, y: 3, z: 4 };
        const child = node('parent');
        child.transform.rotation.z = 35;
        const snapshot = createTransformSnapshot(fixture({ parent, child }), ['child'], 'local');
        const rotated = required(
            applyTransformOperation(snapshot, { mode: 'rotate', axis: 'y', angle: Math.PI / 4 })[
                'child'
            ]
        );
        expect(rotated.scale).toEqual(child.transform.scale);
        expect(Object.values(rotated.rotation).every(Number.isFinite)).toBe(true);
        const scaled = required(
            applyTransformOperation(snapshot, { mode: 'scale', axis: 'x', factor: 2 })['child']
        );
        expect(scaled.scale).toEqual({ x: 2, y: 1, z: 1 });
        expect(scaled.rotation).toEqual(child.transform.rotation);
    });

    it('rejects world scaling that would require unrepresentable shear', () => {
        const object = node();
        object.transform.rotation.z = 45;
        const snapshot = createTransformSnapshot(fixture({ object }), ['object'], 'world');
        expect(() =>
            applyTransformOperation(snapshot, { mode: 'scale', axis: 'x', factor: 2 })
        ).toThrow(/shear/);
        expect(object.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
    });

    it('rejects world rotation through a nonuniform parent without mutating the scene', () => {
        const parent = node();
        parent.transform.scale = { x: 2, y: 3, z: 4 };
        const child = node('parent');
        const snapshot = createTransformSnapshot(fixture({ parent, child }), ['child'], 'world');
        expect(() =>
            applyTransformOperation(snapshot, { mode: 'rotate', axis: 'z', angle: Math.PI / 4 })
        ).toThrow(/Local space/);
        expect(child.transform.rotation).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('allows uniform world scale under nonuniform parents', () => {
        const parent = node();
        parent.transform.scale = { x: 2, y: 3, z: 4 };
        const child = node('parent');
        child.transform.rotation.z = 35;
        const snapshot = createTransformSnapshot(fixture({ parent, child }), ['child'], 'world');
        const result = required(
            applyTransformOperation(snapshot, { mode: 'scale', axis: 'uniform', factor: 1.5 })[
                'child'
            ]
        );
        expect(result.scale.x).toBeCloseTo(1.5, 5);
        expect(result.scale.y).toBeCloseTo(1.5, 5);
        expect(result.scale.z).toBeCloseTo(1.5, 5);
        expect(result.rotation.z).toBeCloseTo(35, 4);
    });

    it('enforces authored positive scale and finite translation limits', () => {
        const snapshot = createTransformSnapshot(fixture({ object: node() }), ['object'], 'local');
        expect(() =>
            applyTransformOperation(snapshot, { mode: 'scale', axis: 'uniform', factor: 0 })
        ).toThrow(/positive/);
        expect(() =>
            applyTransformOperation(snapshot, { mode: 'scale', axis: 'uniform', factor: 0.0001 })
        ).toThrow(/0.001/);
        expect(() =>
            applyTransformOperation(snapshot, {
                mode: 'translate',
                offset: { x: 20_000, y: 0, z: 0 }
            })
        ).toThrow(/10000/);
        expect(() =>
            applyTransformOperation(snapshot, {
                mode: 'translate',
                offset: { x: Number.NaN, y: 0, z: 0 }
            })
        ).toThrow(/Invalid translation/);
    });

    it('snaps translation, rotation and scale without global rounding', () => {
        expect(snapTransformValue(0.74, 0.5, true)).toBe(0.5);
        expect(snapTransformValue(-0.76, 0.5, true)).toBe(-1);
        expect(snapTransformValue(0.74, 0.5, false)).toBe(0.74);
        expect(snapTransformValue((19 * Math.PI) / 180, Math.PI / 12, true)).toBeCloseTo(
            Math.PI / 12
        );
        expect(snapTransformValue(1.26, 0.1, true)).toBeCloseTo(1.3);
    });

    it('solves projected axis drags and rejects almost parallel views', () => {
        const ray = new Ray({
            origin: new Vector3(0, 0, 10),
            direction: new Vector3(1, 0, -10).normalize()
        });
        expect(dragAxisParameter(ray, new Vector3(), new Vector3(1, 0, 0))).toBeCloseTo(1, 5);
        ray.direction.set(1, 0, 0);
        expect(dragAxisParameter(ray, new Vector3(), new Vector3(1, 0, 0))).toBeNull();
    });

    it('rejects planar drags behind the camera and parallel planes', () => {
        const ray = new Ray({ origin: new Vector3(0, 0, 10), direction: new Vector3(0, 0, -1) });
        expect(dragPlanePoint(ray, new Vector3(), new Vector3(0, 0, 1))?.z).toBeCloseTo(0);
        expect(dragPlanePoint(ray, new Vector3(0, 0, 20), new Vector3(0, 0, 1))).toBeNull();
        expect(dragPlanePoint(ray, new Vector3(), new Vector3(1, 0, 0))).toBeNull();
    });

    it('retains orthonormal local handles through nested rotated scale', () => {
        const parent = node();
        parent.transform.rotation.z = 30;
        parent.transform.scale = { x: 2, y: 1, z: 3 };
        const child = node('parent');
        child.transform.rotation.y = 45;
        const snapshot = createTransformSnapshot(fixture({ parent, child }), ['child'], 'local');
        expect(snapshot.axes.x.dot(snapshot.axes.y)).toBeCloseTo(0, 6);
        expect(snapshot.axes.x.length()).toBeCloseTo(1, 6);
    });
});
