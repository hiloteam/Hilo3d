const Frustum =  Hilo3d.Frustum;

describe('Frustum', () => {
    var frustumA, identity;
    beforeEach(() => {
        frustumA = new Frustum();
        identity = new Frustum();

        frustumA.fromMatrix(new Hilo3d.Matrix4().perspective(Math.PI/2, 1, 0.01, 10));
    });

    it('create', () => {
        frustumA.isFrustum.should.be.true();
        frustumA.className.should.equal('Frustum');
    });

    it('copy', () => {
        identity.copy(frustumA);
        identity.planes.forEach((plane, index) => {
            plane.normal.equals(frustumA.planes[index].normal);
            plane.distance.should.equal(frustumA.planes[index].distance);
        });
    });

    it('clone', () => {
        var frustum = frustumA.clone();
        frustum.planes.forEach((plane, index) => {
            plane.normal.equals(frustumA.planes[index].normal);
            plane.distance.should.equal(frustumA.planes[index].distance);
        });
    });

    it('fromMatrix', () => {
        identity.fromMatrix(new Hilo3d.Matrix4().frustum(-1, 1, -1, 1, -1, 1));
        var planes = identity.planes;
        var sqrt5 = Math.sqrt(0.5);
        planes[0].normal.elements.should.equalishValues(sqrt5, 0, -sqrt5);
        planes[1].normal.elements.should.equalishValues(-sqrt5, 0, -sqrt5);
        planes[2].normal.elements.should.equalishValues(0, -sqrt5, -sqrt5);
        planes[3].normal.elements.should.equalishValues(0, sqrt5, -sqrt5);
        planes[4].normal.elements.should.equalishValues(0, 0, -1);
        planes[5].normal.elements.should.equalishValues(0, 0, -1);

        planes[0].distance.should.equal(0);
        planes[1].distance.should.equal(0);
        planes[2].distance.should.equal(0);
        planes[3].distance.should.equal(0);
        planes[4].distance.should.equal(-1);
        planes[5].distance.should.equal(1);
    });

    it('intersectsSphere', () => {
        identity.fromMatrix(new Hilo3d.Matrix4().frustum(-1, 1, -1, 1, -1, 1));
        
        identity.intersectsSphere(new Hilo3d.Sphere({
            center:new Hilo3d.Vector3(),
            radius:2
        })).should.be.true();
        
        identity.intersectsSphere(new Hilo3d.Sphere({
            center:new Hilo3d.Vector3(),
            radius:0.1
        })).should.be.false();
    });
});