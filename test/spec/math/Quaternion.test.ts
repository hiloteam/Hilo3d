const Quaternion = Hilo3d.Quaternion;

describe('Quaternion', function() {
    var quatA, quatB, identity, out, deg90;
    beforeEach(() => {
        quatA = new Quaternion(1, 2, 3, 4);
        quatB = new Quaternion(5, 6, 7, 8);
        identity = new Quaternion(0, 0, 0, 1);
        out = new Quaternion(0, 0, 0, 0);
        deg90 = Math.PI * 0.5;
    });

    it('create', () => {
        quatA.isQuaternion.should.be.true();
        quatA.className.should.equal('Quaternion');
        quatA.x.should.equal(1);
        quatA.y.should.equal(2);
        quatA.z.should.equal(3);
        quatA.w.should.equal(4);
    });

    it('copy', () => {
        identity.copy(quatA).elements.should.equalishValues(1, 2, 3, 4);
    });

    it('clone', () => {    
        quatA.clone().elements.should.equalishValues(1, 2, 3, 4);
    });

    it('toArray', () => {
        var result = [];
        quatA.toArray(result, 2);
        result[2].should.equal(1);
        result[3].should.equal(2);
        result[4].should.equal(3);
        result[5].should.equal(4);
    });

    it('fromArray', () => {
        identity.fromArray([0, 0, 1, 2, 3, 4], 2).elements.should.equalishValues(1, 2, 3, 4);
    });

    it('set', () => {
        identity.set(1, 2, 3, 4).elements.should.equalishValues(1, 2, 3, 4);
    });

    it('identity', () => {
        quatA.identity().elements.should.equalishValues(0, 0, 0, 1);
    });

    it('rotationTo', () => {
        identity.rotationTo(new Hilo3d.Vector3(0, 1, 0), new Hilo3d.Vector3(1, 0, 0)).elements.should.equalishValues(0, 0, -Math.sqrt(0.5), Math.sqrt(0.5));
    });

    it('setAxes', () => {
        identity.setAxes(new Hilo3d.Vector3(-1, 0, 0), new Hilo3d.Vector3(0, 0, -1), new Hilo3d.Vector3(0, 1, 0)).elements.should.equalishValues(0, -Math.sqrt(0.5), 0, Math.sqrt(0.5));
        new Hilo3d.Vector3(0, 0, -1).transformQuat(identity).elements.should.equalishValues(1, 0, 0);
    });

    it('setAxisAngle', () => {
        identity.setAxisAngle(new Hilo3d.Vector3(1, 0, 0), Math.PI * 0.5).elements.should.equalishValues(Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    });

    it('getAxisAngle', () => {
        identity.setAxisAngle(new Hilo3d.Vector3(1, 0, 0), 0.7778);
        var axis = new Hilo3d.Vector3();
        identity.getAxisAngle(axis).should.equalish(0.7778);
        axis.elements.should.equalishValues(1, 0, 0);
    });

    it('add', () => {
        quatA.add(quatB).elements.should.equalishValues(6, 8, 10, 12);
    });

    it('multiply', () => {
        quatA.multiply(quatB).elements.should.equalishValues(24, 48, 48, -6);
    });

    it('premultiply', () => {
        quatB.premultiply(quatA).elements.should.equalishValues(24, 48, 48, -6);
    });

    it('scale', () => {
        quatA.scale(2).elements.should.equalishValues(2, 4, 6, 8);
    });

    it('rotateX', () => {
        identity.rotateX(deg90);
        new Hilo3d.Vector3(0, 0, -1).transformQuat(identity).elements.should.equalishValues(0, 1, 0);
    });

    it('rotateY', () => {
        identity.rotateY(deg90);
        new Hilo3d.Vector3(0, 0, -1).transformQuat(identity).elements.should.equalishValues(-1, 0, 0);
    });

    it('rotateZ', () => {
        identity.rotateZ(deg90);
        new Hilo3d.Vector3(0, 1, 0).transformQuat(identity).elements.should.equalishValues(-1, 0, 0);
    });

    it('calculateW', () => {
        quatA.calculateW().elements.should.equalishValues(1, 2, 3, Math.sqrt(Math.abs(1.0 -  1 - 4 - 9)));
    });

    it('dot', () => {
        quatA.dot(quatB).should.equalish(70);
    });

    it('lerp', () => {
        quatA.lerp(quatB, 0.5).elements.should.equalishValues(3, 4, 5, 6);
    }); 

    it('slerp', () => {
        quatA.set(1, 0, 0, 0);
        quatA.rotateX(Math.PI);
        new Quaternion(1, 0, 0, 0).slerp(quatA, 1).elements.should.equalishValues(0, 0, 0, -1);
        new Quaternion(1, 0, 0, 0).slerp(new Quaternion(-1, 0, 0, 0), 0.5).elements.should.equalishValues(1, 0, 0, 0);
        identity.slerp(new Quaternion(0, 1, 0, 0), 0.5).elements.should.equalishValues(0, Math.sqrt(0.5), 0, Math.sqrt(0.5));
    });

    it('sqlerp', () => {
        identity.sqlerp(quatA, quatB, new Quaternion(4, 5, 6, 7), new Quaternion(2, 4, 3, 4), 0.5).elements.should.equalishValues(3, 4.25, 4.75, 5.75);
    });

    it('invert', () => {
        quatA.invert().elements.should.equalishValues(-0.03333333, -0.066666670143, -0.1, 0.13333333);
    });

    it('conjugate', () => {
        quatA.conjugate().elements.should.equalishValues(-1, -2, -3, 4);
    });

    it('length', () => {
        quatA.length().should.equalish(Math.sqrt(30));
    });

    it('squaredLength', () => {
        quatA.squaredLength().should.equalish(30);
    });

    it('normalize', () => {
        quatA.set(5, 0, 0, 0).normalize().elements.should.equalishValues(1, 0, 0, 0);
    });

    it('fromMat3', () => {
        var mat = new Hilo3d.Matrix3().set(1, 0,  0, 0, 0, -1, 0, 1,  0 );
        identity.fromMat3(mat).elements.should.equalishValues(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    });

    it('fromMat4', () => {
        var mat = new Hilo3d.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 1, 2, 3, 1 );
        identity.fromMat4(mat).elements.should.equalishValues(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    });

    it('exactEquals', () => {
        quatA.clone().exactEquals(quatA).should.be.true();
    });

    it('equals', () => {
        var quat = quatA.clone();
        quat.x += 0.0000001;
        quat.exactEquals(quatA).should.be.false();
        quat.equals(quatA).should.be.true();
    });

    it('fromEuler', () => {
        identity.fromEuler(new Hilo3d.Euler(-deg90, 0, 0)).elements.should.equalishValues(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    });
});