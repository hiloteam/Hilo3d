const Ray =  Hilo3d.Ray;
const Vector3 =  Hilo3d.Vector3;

describe('Ray', () => {
    var rayA, identity;
    beforeEach(() => {
        rayA = new Ray({
            origin:new Vector3(1, 2, 3),
            direction:new Vector3(1, 0, 0)
        });

        identity = new Ray();
    });

    it('create', () => {
        rayA.isRay.should.be.true();
        rayA.className.should.equal('Ray');
        rayA.origin.elements.should.equalishValues(1, 2, 3);
        rayA.direction.elements.should.equalishValues(1, 0, 0);
    });

    it('set', () => {
        identity.set(new Vector3(1, 2, 3), new Vector3(1, 0, 0));
        identity.origin.elements.should.equalishValues(1, 2, 3);
        identity.direction.elements.should.equalishValues(1, 0, 0);
    });

    it('copy', () => {
        identity.copy(rayA);
        identity.origin.elements.should.equalishValues(1, 2, 3);
        identity.direction.elements.should.equalishValues(1, 0, 0);
    });

    it('clone', () => {
        var ray = rayA.clone();
        ray.origin.elements.should.equalishValues(1, 2, 3);
        ray.direction.elements.should.equalishValues(1, 0, 0);
    });

    it('fromCamera', () => {
        var camera = new Hilo3d.PerspectiveCamera({
            z:10,
            rotationX:90,
            rotationY:30
        }).lookAt(new Vector3(0, 1, 2)).updateViewProjectionMatrix();

        identity.fromCamera(camera, 1, 2, 3, 4);
        identity.origin.elements.should.equalishValues(0, 0, 10);
        identity.direction.elements.should.equalishValues(-0.15359194576740265, 0.12256336212158203, -0.9805037975311279);

        var camera = new Hilo3d.OrthographicCamera({
            z:10,
            rotationX:90
        }).lookAt(new Vector3(0, 1, 2)).updateViewProjectionMatrix();

        identity.fromCamera(camera, 1, 2, 3, 4);
        identity.origin.elements.should.equalishValues(-0.3333333432674408, -3.19604644971605e-8, 10);
        identity.direction.elements.should.equalishValues( 0, 0.12403473258018494, -0.9922778606414795);
    });

    it('transformMat4', () => {
        rayA.transformMat4(new Hilo3d.Matrix4().translate(new Vector3(1, 2, 3)).rotateY(Math.PI/2));
        rayA.origin.elements.should.equalishValues(4, 4, 2);
        rayA.direction.elements.should.equalishValues(0, 0, -1);
    }); 

    it('sortPoints', () => {
        var points = [new Vector3(0, 0, 0), new Vector3(3, 4, 6), new Vector3(1, 2, 3)];
        rayA.sortPoints(points);
        points[0].elements.should.equalishValues(1, 2, 3);
        points[1].elements.should.equalishValues(0, 0, 0);
        points[2].elements.should.equalishValues(3, 4, 6);

        var points = [{point:new Vector3(0, 0, 0)}, {point:new Vector3(3, 4, 6)}, {point:new Vector3(1, 2, 3)}];
        rayA.sortPoints(points, 'point');
        points[0].point.elements.should.equalishValues(1, 2, 3);
        points[1].point.elements.should.equalishValues(0, 0, 0);
        points[2].point.elements.should.equalishValues(3, 4, 6);
    });

    it('squaredDistance', () => {
        rayA.squaredDistance(new Vector3(1, 0, 0)).should.equalish(13);
    });

    it('distance', () => {
        rayA.distance(new Vector3(1, 0, 0)).should.equalish(Math.sqrt(13));
    });

    it('intersectsSphere', () => {
        identity.intersectsSphere([0, 0, 0], 5).elements.should.equalishValues(0, 0, 5);
        should(identity.intersectsSphere([0, 0, 6], 5)).be.null();
    });

    it('intersectsPlane', () => {
        identity.intersectsPlane([0, 0, 1], 5).elements.should.equalishValues(0, 0, -5);
        should(identity.intersectsPlane([0, 0, 1], -5)).be.null();
    });

    it('intersectsTriangle', () => {
        identity.intersectsTriangle([[-0.5, -0.289, 0], [0.5, -0.289, 0], [0, 0, 0.9]]).elements.should.equalishValues(0, 0, 0.9);
    });

    it('intersectsBox', () => {
        identity.intersectsBox([[-1, -1, -1], [1, 1, 1]]).elements.should.equalishValues(0, 0, 1);
    });

    it('intersectsTriangleCell', () => {
        identity.intersectsTriangleCell([0, 1, 2], [[-0.5, -0.289, 0], [0.5, -0.289, 0], [0, 0, 0.9]]).elements.should.equalishValues(0, 0, 0.9);
    });

    it('_getRes', () => {
        should(rayA._getRes()).be.null();
        rayA._getRes([1, 2, 3]).elements.should.equalishValues(1, 2, 3);
    });
});