const Euler = Hilo3d.Euler;

describe('Euler', function() {
    var eulerA, identity;

    beforeEach(() => {
        eulerA = new Euler(1, 2, 3);
        eulerA.order = 'XYZ';

        identity = new Euler();
    });

    it('create', () => {
        eulerA.isEuler.should.be.true();
        eulerA.className.should.equal('Euler');
        eulerA.elements.should.equalishValues(1, 2, 3);
        eulerA.x.should.equal(1);
        eulerA.y.should.equal(2);
        eulerA.z.should.equal(3);
    });

    it('clone', () => {
        var euler = eulerA.clone();
        euler.order.should.equal(eulerA.order);
        euler.x.should.equal(eulerA.x);
        euler.y.should.equal(eulerA.y);
        euler.z.should.equal(eulerA.z);
    });

    it('copy', () => {
        identity.copy(eulerA);
        identity.order.should.equal(eulerA.order);
        identity.x.should.equal(eulerA.x);
        identity.y.should.equal(eulerA.y);
        identity.z.should.equal(eulerA.z);
    });

    it('set', () => {
        identity.set(1, 2, 3);
        identity.elements.should.equalishValues(1, 2, 3);
    });

    it('fromArray', () => {
        identity.fromArray([0, 0, 1, 2, 3], 2);
        identity.elements.should.equalishValues(1, 2, 3);
    });

    it('toArray', () => {
        var arr = [];
        eulerA.toArray(arr, 2);
        arr[2].should.equal(1);
        arr[3].should.equal(2);
        arr[4].should.equal(3);
    }); 

    it('fromMat4', () => {
        identity.fromMat4(new Hilo3d.Matrix4().rotateX(Math.PI*0.5));
        identity.elements.should.equalishValues(Math.PI*0.5, 0, 0);
    });

    it('fromQuat', () => {
        identity.fromQuat(new Hilo3d.Quaternion(Math.sin(Math.PI*0.25), 0, 0, Math.cos(Math.PI*0.25)));
        identity.elements.should.equalishValues(Math.PI*0.5, 0, 0);
    });
});