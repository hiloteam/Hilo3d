const Sphere =  Hilo3d.Sphere;

describe('Sphere', () => {
    var sphereA, identity;
    beforeEach(() => {
        sphereA = new Sphere({
            center:new Hilo3d.Vector3(1, 2, 3),
            radius:1
        });

        identity = new Sphere();
    });

    it('create', () => {
        sphereA.isSphere.should.be.true();
        sphereA.className.should.equal('Sphere');
        sphereA.center.elements.should.equalishValues(1, 2, 3);
        sphereA.radius.should.equal(1);
    });

    it('clone', () => {
        var sphere = sphereA.clone();
        sphere.center.equals(sphereA.center).should.be.true();
        sphere.radius.should.equal(sphereA.radius);
    });

    it('copy', () => {
        identity.copy(sphereA);
        identity.center.equals(sphereA.center).should.be.true();
        identity.radius.should.equal(sphereA.radius);
    });

    it('fromPoints', () => {
        sphereA.fromPoints([
            1, 2, 3,
            1, 2, 6,
        ]);
        sphereA.radius.should.equal(3);

        sphereA.fromPoints([
            1, 5, -1,
            1, 2, 6,
        ]);
        sphereA.radius.should.equal(5);
    });

    it('transformMat4', () => {
        sphereA.transformMat4(new Hilo3d.Matrix4().scale(new Hilo3d.Vector3(2, 1, 1)).translate(new Hilo3d.Vector3(1, 2, 3)));
        sphereA.radius.should.equal(2);
        sphereA.center.elements.should.equalishValues(4, 4, 6);
    });
});