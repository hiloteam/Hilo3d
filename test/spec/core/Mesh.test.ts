const Mesh = Hilo3d.Mesh;

describe('Mesh', () => {
    it('create', () => {
        const mesh = new Mesh();
        mesh.isMesh.should.be.true();
        mesh.className.should.equal('Mesh');
    });

    it('clone', () => {
        const mesh = new Mesh({
            geometry: new Hilo3d.BoxGeometry,
            material: new Hilo3d.Material
        });

        const clonedMesh = mesh.clone();
        clonedMesh.geometry.should.equal(mesh.geometry);
        clonedMesh.material.should.equal(mesh.material);
    });

    it('raycast', () => {
        const material = new Hilo3d.Material;
        const mesh = new Mesh({
            geometry: new Hilo3d.PlaneGeometry,
            material: material,
            side: Hilo3d.constants.FRONT
        });

        const ray = new Hilo3d.Ray({
            origin: new Hilo3d.Vector3(0, 0, 1),
            direction: new Hilo3d.Vector3(0, 0, -1)
        });

        mesh.raycast(ray)[0].elements.should.deepEqual(new Float32Array([0, 0, 0]));

        material.side = Hilo3d.constants.BACK;
        should(mesh.raycast(ray)).be.null();

        ray.origin.z = -1;
        ray. direction.z = 1;
        mesh.raycast(ray)[0].elements.should.deepEqual(new Float32Array([0, 0, 0]));
    });
});