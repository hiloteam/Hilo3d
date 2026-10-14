import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import SkinnedMesh from '../../../src/core/SkinnedMesh';
import Skeleton from '../../../src/core/Skeleton';
import MorphGeometry from '../../../src/geometry/MorphGeometry';
import GeometryData from '../../../src/geometry/GeometryData';
import { getTransformHistoryRevision } from '../../../src/core/TransformHistory';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Matrix4 from '../../../src/math/Matrix4';
import Vector3 from '../../../src/math/Vector3';
import BuiltInUniformBlockManager from '../../../src/render/BuiltInUniformBlockManager';
import { DecalProjector } from '../../../src/render/decals/DecalProjector';
import { getMaterialDecalHistoryRevision } from '../../../src/render/decals/DecalMaterialBinding';
import Texture from '../../../src/texture/Texture';

function fixture(): {
    material: PBRMaterial;
    projector: DecalProjector;
    atlases: readonly Texture<Uint8Array>[];
    meshes: readonly Mesh[];
    camera: PerspectiveCamera;
} {
    const atlases = Array.from(
        { length: 3 },
        () =>
            new Texture({
                width: 1,
                height: 1,
                image: new Uint8Array([255, 255, 255, 255]),
                isImageCanRelease: true
            })
    );
    const [baseColorAtlas, normalAtlas, roughnessAtlas] = atlases;
    if (!baseColorAtlas || !normalAtlas || !roughnessAtlas) throw new Error('Missing test atlases');
    const projector = new DecalProjector();
    const material = new PBRMaterial({
        decals: { projectors: [projector], baseColorAtlas, normalAtlas, roughnessAtlas }
    });
    const meshes = [
        new Mesh({ geometry: new BoxGeometry(), material }),
        new Mesh({ geometry: new BoxGeometry(), material })
    ];
    for (const mesh of meshes) mesh.updateMatrixWorld(true);
    const camera = new PerspectiveCamera();
    camera.updateViewProjectionMatrix();
    return { material, projector, atlases, meshes, camera };
}

function stage(
    manager: BuiltInUniformBlockManager,
    scene: ReturnType<typeof fixture>,
    instanced = false
): boolean[] {
    manager.beginFrame(scene.camera);
    return scene.meshes.map(mesh => {
        manager.markMotionVectorParticipation(mesh);
        if (instanced)
            return manager.writeInstanceModelMatrices(
                mesh,
                new Float32Array(16),
                new Float32Array(16),
                0
            );
        const block = manager.resolveUniformBlock('ModelBlock', mesh, scene.material);
        const field = block.layout.fields['u_modelHistoryParams'];
        if (!field) throw new Error('Missing motion validity field');
        return new DataView(block.data).getFloat32(field.offset, true) === 1;
    });
}

describe('decal submission-owned temporal history', () => {
    it('keeps static decal defaults at zero and honors authored reactive factors', () => {
        const scene = fixture();
        expect(scene.material.temporalReactiveFactor).toBe(0);
        if (scene.material.decals === null) throw new Error('Missing test decals');
        for (const temporalReactiveFactor of [0, 0.35, 1]) {
            const material = new PBRMaterial({
                decals: scene.material.decals,
                temporalReactiveFactor
            });
            expect(material.temporalReactiveFactor).toBe(temporalReactiveFactor);
        }
        scene.material.temporalReactiveFactor = 0.65;
        expect(scene.material.temporalReactiveFactor).toBe(0.65);
    });

    it.each([false, true])(
        'retains eight static frames, rejects changed projectors and retries failed submissions (instanced: %s)',
        instanced => {
            const scene = fixture();
            const manager = new BuiltInUniformBlockManager({ width: 32, height: 32 });
            expect(stage(manager, scene, instanced)).toEqual([false, false]);
            manager.commit({} as never);
            for (let frame = 0; frame < 8; frame++) {
                expect(stage(manager, scene, instanced)).toEqual([true, true]);
                manager.commit({} as never);
            }
            const moved = new Matrix4();
            moved.elements[12] = 2;
            scene.projector.update({ transform: moved });
            // A color/depth pass may synchronize DecalBlock before motion preparation.
            expect(scene.material.uniformBlocks['DecalBlock']).toBeDefined();
            expect(stage(manager, scene, instanced)).toEqual([false, false]);
            manager.rollback();
            expect(stage(manager, scene, instanced)).toEqual([false, false]);
            manager.commit({} as never);
            expect(stage(manager, scene, instanced)).toEqual([true, true]);
            manager.commit({} as never);
            scene.projector.update({ enabled: false });
            expect(stage(manager, scene, instanced)).toEqual([false, false]);
            manager.commit({} as never);
            expect(stage(manager, scene, instanced)).toEqual([true, true]);
        }
    );

    it('keeps shared-material history independent for each renderer and observes all three atlases', () => {
        const scene = fixture();
        const first = new BuiltInUniformBlockManager({ width: 32, height: 32 });
        const second = new BuiltInUniformBlockManager({ width: 32, height: 32 });
        stage(first, scene);
        first.commit({} as never);
        stage(second, scene);
        second.commit({} as never);
        for (const atlas of scene.atlases) {
            atlas.image = new Uint8Array([128, 64, 32, 255]);
            expect(stage(first, scene)).toEqual([false, false]);
            first.commit({} as never);
            expect(stage(second, scene)).toEqual([false, false]);
            second.rollback();
            expect(stage(first, scene)).toEqual([true, true]);
            first.commit({} as never);
            expect(stage(second, scene)).toEqual([false, false]);
            second.commit({} as never);
            expect(stage(second, scene)).toEqual([true, true]);
            second.commit({} as never);
        }
    });

    it('observes mip source replacement and safely stabilizes released texture backing', () => {
        const scene = fixture();
        const atlas = scene.atlases[0];
        if (!atlas) throw new Error('Missing test atlas');
        const first = getMaterialDecalHistoryRevision(scene.material);
        atlas.mipmaps = [{ width: 1, height: 1, data: new Uint8Array([128, 0, 0, 255]) }];
        const changed = getMaterialDecalHistoryRevision(scene.material);
        expect(changed).toBeGreaterThan(first);
        expect(getMaterialDecalHistoryRevision(scene.material)).toBe(changed);
        atlas.releaseImageIfAllowed();
        expect(atlas.isImageReleased).toBe(true);
        const released = getMaterialDecalHistoryRevision(scene.material);
        expect(getMaterialDecalHistoryRevision(scene.material)).toBe(released);
    });

    it('rejects continuously updated atlases until their dynamic update policy is disabled', () => {
        const scene = fixture();
        const atlas = scene.atlases[0];
        if (!atlas) throw new Error('Missing test atlas');
        atlas.autoUpdate = true;
        const manager = new BuiltInUniformBlockManager({ width: 32, height: 32 });
        for (let frame = 0; frame < 3; frame++) {
            expect(stage(manager, scene)).toEqual([false, false]);
            manager.commit({} as never);
        }
        atlas.autoUpdate = false;
        expect(stage(manager, scene)).toEqual([false, false]);
        manager.commit({} as never);
        expect(stage(manager, scene)).toEqual([true, true]);
    });
    it.each([false, true])(
        'rejects small receiver motion without changing decal content or treating forced matrix refresh as motion (instanced: %s)',
        instanced => {
            const scene = fixture();
            const mesh = scene.meshes[0];
            if (!mesh) throw new Error('Missing receiver');
            const manager = new BuiltInUniformBlockManager({ width: 32, height: 32 });
            stage(manager, scene, instanced);
            manager.commit({} as never);
            mesh.updateMatrixWorld(true);
            expect(stage(manager, scene, instanced)).toEqual([true, true]);
            manager.commit({} as never);
            const content = getMaterialDecalHistoryRevision(scene.material);
            const cut = getTransformHistoryRevision(mesh);
            mesh.x += 0.02;
            mesh.updateMatrixWorld(true);
            expect(getMaterialDecalHistoryRevision(scene.material)).toBe(content);
            expect(getTransformHistoryRevision(mesh)).toBe(cut);
            expect(stage(manager, scene, instanced)).toEqual([false, true]);
            manager.rollback();
            expect(stage(manager, scene, instanced)).toEqual([false, true]);
            manager.commit({} as never);
            expect(stage(manager, scene, instanced)).toEqual([true, true]);
            manager.commit({} as never);
            mesh.rotationY += 0.1;
            mesh.updateMatrixWorld(true);
            expect(stage(manager, scene, instanced)).toEqual([false, true]);
            manager.commit({} as never);
            expect(stage(manager, scene, instanced)).toEqual([true, true]);
        }
    );

    it('preserves stationary world-space decals across camera-relative origin changes', () => {
        const scene = fixture();
        const manager = new BuiltInUniformBlockManager({
            width: 32,
            height: 32,
            cameraRelative: true
        });
        scene.camera.setPosition(100_000, 2, 3).updateMatrixWorld(true);
        scene.camera.updateViewProjectionMatrix();
        stage(manager, scene);
        manager.commit({} as never);
        scene.camera.x += 0.05;
        scene.camera.updateMatrixWorld(true);
        scene.camera.updateViewProjectionMatrix();
        for (const mesh of scene.meshes) mesh.updateMatrixWorld(true);
        expect(stage(manager, scene)).toEqual([true, true]);
    });

    it('tracks changed receiver vertex streams and decode matrices without scanning vertex data', () => {
        const scene = fixture();
        const mesh = scene.meshes[0];
        const geometry = mesh?.geometry;
        if (!geometry?.vertices) throw new Error('Missing receiver vertices');
        const manager = new BuiltInUniformBlockManager({ width: 32, height: 32 });
        stage(manager, scene);
        manager.commit({} as never);
        geometry.vertices.set(0, new Vector3(0.02, 0, 0));
        expect(stage(manager, scene)).toEqual([false, true]);
        manager.commit({} as never);
        expect(stage(manager, scene)).toEqual([true, true]);
        manager.commit({} as never);
        geometry.positionDecodeMat = Array.from(new Matrix4().elements);
        expect(stage(manager, scene)).toEqual([false, true]);
        manager.commit({} as never);
        geometry.positionDecodeMat[12] = 0.02;
        expect(stage(manager, scene)).toEqual([false, true]);
        manager.commit({} as never);
        expect(stage(manager, scene)).toEqual([true, true]);
    });

    it.each([false, true])(
        'rejects canonical skin pose edits independently of block resolution order (skin first: %s)',
        skinFirst => {
            const scene = fixture();
            const joint = new Node();
            joint.updateMatrixWorld(true);
            const mesh = new SkinnedMesh({
                geometry: new BoxGeometry(),
                material: scene.material,
                skeleton: new Skeleton({
                    jointNodeList: [joint],
                    jointNames: ['root'],
                    inverseBindMatrices: [new Matrix4()]
                })
            });
            mesh.updateMatrixWorld(true);
            const manager = new BuiltInUniformBlockManager({ width: 32, height: 32 });
            const draw = (): boolean => {
                manager.beginFrame(scene.camera);
                manager.markMotionVectorParticipation(mesh);
                if (skinFirst) manager.resolveUniformBlock('SkinningBlock', mesh, scene.material);
                const model = manager.resolveUniformBlock('ModelBlock', mesh, scene.material);
                if (!skinFirst) manager.resolveUniformBlock('SkinningBlock', mesh, scene.material);
                const field = model.layout.fields['u_modelHistoryParams'];
                if (!field) throw new Error('Missing model history');
                return new DataView(model.data).getFloat32(field.offset, true) === 1;
            };
            expect(draw()).toBe(false);
            manager.commit({} as never);
            expect(draw()).toBe(true);
            manager.commit({} as never);
            joint.x += 0.02;
            joint.updateMatrixWorld(true);
            expect(draw()).toBe(false);
            manager.rollback();
            expect(draw()).toBe(false);
            manager.commit({} as never);
            expect(draw()).toBe(true);
        }
    );

    it.each([false, true])(
        'rejects morph weights, active target remapping and target uploads (morph first: %s)',
        morphFirst => {
            const scene = fixture();
            const base = new BoxGeometry();
            const count = base.vertices?.count ?? 0;
            const first = new GeometryData(new Float32Array(count * 3).fill(0.01), 3);
            const second = new GeometryData(new Float32Array(count * 3).fill(0.02), 3);
            const geometry = new MorphGeometry({
                vertices: base.vertices,
                normals: base.normals,
                indices: base.indices,
                weights: new Float32Array([0.1, 0]),
                targets: { vertices: [first, second] }
            });
            const mesh = new Mesh({ geometry, material: scene.material });
            mesh.updateMatrixWorld(true);
            const manager = new BuiltInUniformBlockManager({ width: 32, height: 32 });
            const draw = (): boolean => {
                manager.beginFrame(scene.camera);
                manager.markMotionVectorParticipation(mesh);
                if (morphFirst) manager.resolveUniformBlock('MorphBlock', mesh, scene.material);
                const model = manager.resolveUniformBlock('ModelBlock', mesh, scene.material);
                if (!morphFirst) manager.resolveUniformBlock('MorphBlock', mesh, scene.material);
                const field = model.layout.fields['u_modelHistoryParams'];
                if (!field) throw new Error('Missing model history');
                return new DataView(model.data).getFloat32(field.offset, true) === 1;
            };
            draw();
            manager.commit({} as never);
            expect(draw()).toBe(true);
            manager.commit({} as never);
            geometry.weights[0] = 0.2;
            expect(draw()).toBe(false);
            manager.rollback();
            expect(draw()).toBe(false);
            manager.commit({} as never);
            expect(draw()).toBe(true);
            manager.commit({} as never);
            geometry.update(geometry.weights, [1, 0]);
            expect(draw()).toBe(false);
            manager.commit({} as never);
            expect(draw()).toBe(true);
            manager.commit({} as never);
            second.data[0] = (second.data[0] ?? 0) + 0.02;
            second.isDirty = true;
            expect(draw()).toBe(false);
            manager.commit({} as never);
            expect(draw()).toBe(true);
        }
    );
});
