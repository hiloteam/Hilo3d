const Vector4 = Hilo3d.Vector4;

describe('Vector4', function() {
    it('create', () => {
        const vec = new Vector4(1, 2, 3, 4);
        vec.isVector4.should.be.true();
        vec.className.should.equal('Vector4');

        vec.x.should.equal(1);
        vec.y.should.equal(2);
        vec.z.should.equal(3);
        vec.w.should.equal(4);
    });

    it('copy', () => {
        const v = new Vector4(1, 2, 3, 4);
        new Vector4().copy(v).elements.should.deepEqual(v.elements);
    });

    it('clone', () => {
        const v = new Vector4(1, 2, 3, 4);
        v.clone().elements.should.deepEqual(v.elements);
    });

    it('toArray', () => {
        const res = [];
        new Vector4(1, 2, 3, 4).toArray(res, 5);
        res[5].should.equal(1);
        res[6].should.equal(2);
        res[7].should.equal(3);
        res[8].should.equal(4);
    });

    it('fromArray', () => {
        const res = [0, 0, 0, 1, 2, 3, 4];
        new Vector4().fromArray(res, 2).elements.should.equalishValues(0, 1, 2, 3);
    });

    it('set', () => {
        new Vector4().set(1, 2, 3, 4).elements.should.equalishValues(1, 2, 3, 4);
    });

    it('add', () => {
        new Vector4(1, 2, 3, 4).add(new Vector4(3, 4, 5, 6)).elements.should.equalishValues(4, 6, 8, 10);
        new Vector4(1, 2, 3, 4).add(new Vector4(3, 4, 5, 6), new Vector4(1, 0, 1, 2)).elements.should.equalishValues(4, 4, 6, 8);
    });

    it('subtract', () => {
        new Vector4(1, 2, 3, 4).subtract(new Vector4(3, 4, 5, 7)).elements.should.equalishValues(-2, -2, -2, -3);
        new Vector4(1, 2, 3, 4).subtract(new Vector4(3, 4, 5, 6), new Vector4(1, 0, 1, 3)).elements.should.equalishValues(2, 4, 4, 3);
    });

    it('multiply', () => {
        new Vector4(1, 2, 3, 4).multiply(new Vector4(3, 4, 5, 6)).elements.should.equalishValues(3, 8, 15, 24);
        new Vector4(1, 2, 3, 4).multiply(new Vector4(3, 4, 5, 6), new Vector4(1, 0, 1, 2)).elements.should.equalishValues(3, 0, 5, 12);
    });

    it('divide', () => {
        new Vector4(6, 2, 7, 1).divide(new Vector4(3, 4, 7, 1)).elements.should.equalishValues(2, 0.5, 1, 1);
        new Vector4(1, 2, 3, 10).divide(new Vector4(3, 4, 7, 8), new Vector4(1, 2, 1, 4)).elements.should.equalishValues(3, 2, 7, 2);
    });

    it('ceil', () => {
        new Vector4(1.1, 2.9, 1.2, 5).ceil().elements.should.equalishValues(2, 3, 2, 5);
    });

    it('floor', () => {
        new Vector4(1.1, 2.9, 2.1, 2.8).floor().elements.should.equalishValues(1, 2, 2, 2);
    });

    it('min', () => {
        new Vector4(6, 2, 1, 10).min(new Vector4(3, 4, 2, 1.2)).elements.should.equalishValues(3, 2, 1, 1.2);
        new Vector4(1, 2, 1, 0).min(new Vector4(3, 4, 1, 2.3), new Vector4(1, 2, 1, 2.2)).elements.should.equalishValues(1, 2, 1, 2.2);
    });

    it('max', () => {
        new Vector4(6, 2, 1, 1).max(new Vector4(3, 4, 2, 0)).elements.should.equalishValues(6, 4, 2, 1);
        new Vector4(1, 2, 1, 2).max(new Vector4(3, 4, 1, 2), new Vector4(1, 2, 1, 22)).elements.should.equalishValues(3, 4, 1, 22);
    });

    it('round', () => {
        new Vector4(1.2, 2.5, 3.1, 3.5).round().elements.should.equalishValues(1, 3, 3, 4);
    });

    it('scale', () => {
        new Vector4(1.2, 2.5, 0.8, 1.1).scale(2).elements.should.equalishValues(2.4, 5, 1.6, 2.2);
    });

    it('scaleAndAdd', () => {
        new Vector4(6, 2, 1, 0).scaleAndAdd(2, new Vector4(3, 4, 0, 1)).elements.should.equalishValues(12, 10, 1, 2);
        new Vector4(1, 2, 1, 0).scaleAndAdd(2, new Vector4(3, 4, 1, 1), new Vector4(1, 2, 1, 3)).elements.should.equalishValues(5, 8, 3, 7);
    });

    it('distance', () => {
        new Vector4(6, 1, 2, 3).distance(new Vector4(3, 1, 6, 3)).should.equal(5);
        new Vector4(1, 1, 2, 3).distance(new Vector4(3, 1, 4, 4), new Vector4(0, 1, 0, 4)).should.equal(5);
    });

    it('squaredDistance', () => {
        new Vector4(1, 6, 2, 1).squaredDistance(new Vector4(1, 3, 6, 1)).should.equal(25);
        new Vector4(1, 1, 2, 2).squaredDistance(new Vector4(1, 3, 4, 2), new Vector4(1, 0, 0, 2)).should.equal(25);
    });

    it('length', () => {
        new Vector4(3, 0, -4, 0).length().should.equal(5);
    });

    it('squaredLength', () => {
        new Vector4(3, -4, 0, 1).squaredLength().should.equal(26);
    });

    it('negate', () => {
        new Vector4(0.5, -0.25, 1, -1).negate().elements.should.equalishValues(-0.5, 0.25, -1, 1);
    });

    it('inverse', () => {
        new Vector4(0.5, -0.25, 1, -1).inverse().elements.should.equalishValues(2, -4, 1, -1);
        new Vector4(0.5, -0.25, 1, -1).inverse(new Vector4(0.5, -0.25, 1, -2)).elements.should.equalishValues(2, -4, 1, -0.5);
    });

    it('normalize', () => {
        new Vector4(3, 0, -4, 0).normalize().elements.should.equalishValues(0.6, 0, -0.8, 0);
    });

    it('dot', () => {
        new Vector4(1, 2, 1, 3).dot(new Vector4(3, 4, 2, 5)).should.equal(28);
    });

    it('lerp', () => {
        new Vector4(1, 2, 3, 4).lerp(new Vector4(3, 4, 5, 6), 0.5).elements.should.equalishValues(2, 3, 4, 5);
    });

    it('random', () => {
        new Vector4(1, 2, 3, 5).random(0.4).length().should.be.equalish(0.4);
    }); 

    it('transformMat4', () => {
        const mat4 = new Hilo3d.Matrix4().scale(new Hilo3d.Vector3(2, 0.5, 3));
        new Vector4(2, 1, 3, 1).transformMat4(mat4).elements.should.equalishValues(4, 0.5, 9, 1);
    });

    it('transformQuat', () => {
        new Vector4(1, 0, 0, 2).transformQuat(new Hilo3d.Quaternion(0, 0, 1, 0)).elements.should.equalishValues(-1, 0, 0, 2);
    });

    it('equals & exactEquals', () => {
        new Vector4(2, 1.001, 2.009, 2).exactEquals(new Vector4(2, 1.001, 2.009, 2)).should.be.True();

        new Vector4(2, 1.001, 2.009, 2).exactEquals(new Vector4(2, 1.001001, 2.009, 2)).should.be.False();
        new Vector4(2, 1.001, 2.009, 2).equals(new Vector4(2, 1.001001, 2.009, 2)).should.be.True();
    });
});