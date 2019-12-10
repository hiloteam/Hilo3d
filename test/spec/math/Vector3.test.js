const Vector3 = Hilo3d.Vector3;

describe('Vector3', function() {
    it('create', () => {
        const vec = new Vector3(1, 2, 3);
        vec.isVector3.should.be.true();
        vec.className.should.equal('Vector3');

        vec.x.should.equal(1);
        vec.y.should.equal(2);
        vec.z.should.equal(3);
    });

    it('copy', () => {
        const v = new Vector3(1, 2, 3);
        new Vector3().copy(v).elements.should.deepEqual(v.elements);
    });

    it('clone', () => {
        const v = new Vector3(1, 2, 3);
        v.clone().elements.should.deepEqual(v.elements);
    });

    it('toArray', () => {
        const res = [];
        new Vector3(1, 2, 3).toArray(res, 5);
        res[5].should.equal(1);
        res[6].should.equal(2);
        res[7].should.equal(3);
    });

    it('fromArray', () => {
        const res = [0, 0, 0, 1, 2, 3];
        new Vector3().fromArray(res, 2).elements.should.equalishValues(0, 1, 2);
    });

    it('set', () => {
        new Vector3().set(1, 2, 3).elements.should.equalishValues(1, 2, 3);
    });

    it('add', () => {
        new Vector3(1, 2, 3).add(new Vector3(3, 4, 5)).elements.should.equalishValues(4, 6, 8);
        new Vector3(1, 2, 3).add(new Vector3(3, 4, 5), new Vector3(1, 0, 1)).elements.should.equalishValues(4, 4, 6);
    });

    it('subtract', () => {
        new Vector3(1, 2, 3).subtract(new Vector3(3, 4, 5)).elements.should.equalishValues(-2, -2, -2);
        new Vector3(1, 2, 3).subtract(new Vector3(3, 4, 5), new Vector3(1, 0, 1)).elements.should.equalishValues(2, 4, 4);
    });

    it('multiply', () => {
        new Vector3(1, 2, 3).multiply(new Vector3(3, 4, 5)).elements.should.equalishValues(3, 8, 15);
        new Vector3(1, 2, 3).multiply(new Vector3(3, 4, 5), new Vector3(1, 0, 1)).elements.should.equalishValues(3, 0, 5);
    });

    it('divide', () => {
        new Vector3(6, 2, 7).divide(new Vector3(3, 4, 7)).elements.should.equalishValues(2, 0.5, 1);
        new Vector3(1, 2, 3).divide(new Vector3(3, 4, 7), new Vector3(1, 2, 1)).elements.should.equalishValues(3, 2, 7);
    });

    it('ceil', () => {
        new Vector3(1.1, 2.9, 1.2).ceil().elements.should.equalishValues(2, 3, 2);
    });

    it('floor', () => {
        new Vector3(1.1, 2.9, 2.1).floor().elements.should.equalishValues(1, 2, 2);
    });

    it('min', () => {
        new Vector3(6, 2, 1).min(new Vector3(3, 4, 2)).elements.should.equalishValues(3, 2, 1);
        new Vector3(1, 2, 1).min(new Vector3(3, 4, 1), new Vector3(1, 2, 1)).elements.should.equalishValues(1, 2, 1);
    });

    it('max', () => {
        new Vector3(6, 2, 1).max(new Vector3(3, 4, 2)).elements.should.equalishValues(6, 4, 2);
        new Vector3(1, 2, 1).max(new Vector3(3, 4, 1), new Vector3(1, 2, 1)).elements.should.equalishValues(3, 4, 1);
    });

    it('round', () => {
        new Vector3(1.2, 2.5, 3.1).round().elements.should.equalishValues(1, 3, 3);
    });

    it('scale', () => {
        new Vector3(1.2, 2.5, 0.8).scale(2).elements.should.equalishValues(2.4, 5, 1.6);
    });

    it('scaleAndAdd', () => {
        new Vector3(6, 2, 1).scaleAndAdd(2, new Vector3(3, 4, 0)).elements.should.equalishValues(12, 10, 1);
        new Vector3(1, 2, 1).scaleAndAdd(2, new Vector3(3, 4, 1), new Vector3(1, 2, 1)).elements.should.equalishValues(5, 8, 3);
    });

    it('distance', () => {
        new Vector3(6, 2, 3).distance(new Vector3(3, 6, 3)).should.equal(5);
        new Vector3(1, 2, 3).distance(new Vector3(3, 4, 4), new Vector3(0, 0, 4)).should.equal(5);
    });

    it('squaredDistance', () => {
        new Vector3(6, 2, 1).squaredDistance(new Vector3(3, 6, 1)).should.equal(25);
        new Vector3(1, 2, 2).squaredDistance(new Vector3(3, 4, 2), new Vector3(0, 0, 2)).should.equal(25);
    });

    it('length', () => {
        new Vector3(3, -4, 0).length().should.equal(5);
    });

    it('squaredLength', () => {
        new Vector3(3, -4, 0).squaredLength().should.equal(25);
    });

    it('negate', () => {
        new Vector3(0.5, -0.25, 1).negate().elements.should.equalishValues(-0.5, 0.25, -1);
    });

    it('inverse', () => {
        new Vector3(0.5, -0.25, 1).inverse().elements.should.equalishValues(2, -4, 1);
        new Vector3(0.5, -0.25, 1).inverse(new Vector3(0.5, -0.25, 0.5)).elements.should.equalishValues(2, -4, 2);
    });

    it('normalize', () => {
        new Vector3(3, -4, 0).normalize().elements.should.equalishValues(0.6, -0.8, 0);
    });

    it('dot', () => {
        new Vector3(1, 2, 1).dot(new Vector3(3, 4, 2)).should.equal(13);
    });

    it('cross', () => {
        new Vector3(1, 2, 0).cross(new Vector3(3, 4, 0)).elements.should.equalishValues(0, 0, -2);
        new Vector3(2, 4, 0).cross(new Vector3(1, 2, 0), new Vector3(3, 4, 0)).elements.should.equalishValues(0, 0, -2);
    });

    it('lerp', () => {
        new Vector3(1, 2, 3).lerp(new Vector3(3, 4, 5), 0.5).elements.should.equalishValues(2, 3, 4);
    });

    it('hermite', () => {
        new Vector3().hermite(new Vector3(0, 0, 0), new Vector3(0, 1, 0), new Vector3(1, 1, 0), new Vector3(2, 0, 0), 0.6).elements.should.equalishValues(1.152, -0.048, 0);
    });

    it('bezier', () => {
        new Vector3().bezier(new Vector3(0, 0, 0), new Vector3(0, 1, 0), new Vector3(1, 1, 0), new Vector3(2, 0, 0), 0.6).elements.should.equalishValues(0.864, 0.72, 0);
    });

    it('random', () => {
        const len = new Vector3(1, 2).random(0.4).length();
        len.should.be.within(0, 0.40001);
    }); 

    it('transformMat3', () => {
        const mat3 = new Hilo3d.Matrix3().fromMat4(new Hilo3d.Matrix4().scale(new Vector3(2, 0.5, 3)));
        new Vector3(2, 1, 5).transformMat3(mat3).elements.should.equalishValues(4, 0.5, 15);
    });

    it('transformMat4', () => {
        const mat4 = new Hilo3d.Matrix4().scale(new Hilo3d.Vector3(2, 0.5, 3));
        new Vector3(2, 1, 3).transformMat4(mat4).elements.should.equalishValues(4, 0.5, 9);
    });

    it('transformQuat', () => {
        new Vector3(1, 0, 0).transformQuat(new Hilo3d.Quaternion(0, 0, 1, 0)).elements.should.equalishValues(-1, 0, 0);
    });

    it('transformDirection', () => {
        const mat4 = new Hilo3d.Matrix4().scale(new Hilo3d.Vector3(2, 0.5, 3)).translate(new Hilo3d.Vector3(1, -2, 0));
        new Vector3(1, 0, 0).transformDirection(mat4).elements.should.equalishValues(2, 0, 0)
    });

    it('rotateX', () => {
        new Vector3(2, 7, 0).rotateX(new Vector3(2, 5, 0), Math.PI).elements.should.equalishValues(2, 3, 0);
    });

    it('rotateY', () => {
        new Vector3(1, 0, 0).rotateY(new Vector3(0, 0, 0), Math.PI).elements.should.equalishValues(-1, 0, 0);
    });

    it('rotateZ', () => {
        new Vector3(0, 6, -5).rotateZ(new Vector3(0, 0, -5), Math.PI).elements.should.equalishValues(0, -6, -5);
    });

    it('equals & exactEquals', () => {
        new Vector3(1.001, 2.009, 2).exactEquals(new Vector3(1.001, 2.009, 2)).should.be.True();

        new Vector3(1.001, 2.009, 2).exactEquals(new Vector3(1.001001, 2.009, 2)).should.be.False();
        new Vector3(1.001, 2.009, 2).equals(new Vector3(1.001001, 2.009, 2)).should.be.True();
    });
});