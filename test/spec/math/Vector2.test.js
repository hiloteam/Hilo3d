const Vector2 = Hilo3d.Vector2;

describe('Vector2', function() {
    it('create', () => {
        const vec = new Vector2(1, 2);
        vec.isVector2.should.be.true();
        vec.className.should.equal('Vector2');

        vec.x.should.equal(1);
        vec.y.should.equal(2);
    });

    it('copy', () => {
        const v = new Vector2(1, 2);
        new Vector2().copy(v).elements.should.deepEqual(v.elements);
    });

    it('clone', () => {
        const v = new Vector2(1, 2);
        v.clone().elements.should.deepEqual(v.elements);
    });

    it('toArray', () => {
        const res = [];
        new Vector2(1, 2).toArray(res, 5);
        res[5].should.equal(1);
        res[6].should.equal(2);
    });

    it('fromArray', () => {
        const res = [0, 0, 0, 1, 2, 3];
        new Vector2().fromArray(res, 2).elements.should.equalishValues(0, 1);
    });

    it('set', () => {
        new Vector2().set(1, 2).elements.should.equalishValues(1, 2);
    });

    it('add', () => {
        new Vector2(1, 2).add(new Vector2(3, 4)).elements.should.equalishValues(4, 6);
        new Vector2(1, 2).add(new Vector2(3, 4), new Vector2(1, 0)).elements.should.equalishValues(4, 4);
    });

    it('subtract', () => {
        new Vector2(1, 2).subtract(new Vector2(3, 4)).elements.should.equalishValues(-2, -2);
        new Vector2(1, 2).subtract(new Vector2(3, 4), new Vector2(1, 0)).elements.should.equalishValues(2, 4);
    });

    it('multiply', () => {
        new Vector2(1, 2).multiply(new Vector2(3, 4)).elements.should.equalishValues(3, 8);
        new Vector2(1, 2).multiply(new Vector2(3, 4), new Vector2(1, 0)).elements.should.equalishValues(3, 0);
    });

    it('divide', () => {
        new Vector2(6, 2).divide(new Vector2(3, 4)).elements.should.equalishValues(2, 0.5);
        new Vector2(1, 2).divide(new Vector2(3, 4), new Vector2(1, 2)).elements.should.equalishValues(3, 2);
    });

    it('ceil', () => {
        new Vector2(1.1, 2.9).ceil().elements.should.equalishValues(2, 3);
    });

    it('floor', () => {
        new Vector2(1.1, 2.9).floor().elements.should.equalishValues(1, 2);
    });

    it('min', () => {
        new Vector2(6, 2).min(new Vector2(3, 4)).elements.should.equalishValues(3, 2);
        new Vector2(1, 2).min(new Vector2(3, 4), new Vector2(1, 2)).elements.should.equalishValues(1, 2);
    });

    it('max', () => {
        new Vector2(6, 2).max(new Vector2(3, 4)).elements.should.equalishValues(6, 4);
        new Vector2(1, 2).max(new Vector2(3, 4), new Vector2(1, 2)).elements.should.equalishValues(3, 4);
    });

    it('round', () => {
        new Vector2(1.2, 2.5).round().elements.should.equalishValues(1, 3);
    });

    it('scale', () => {
        new Vector2(1.2, 2.5).scale(2).elements.should.equalishValues(2.4, 5);
    });

    it('scaleAndAdd', () => {
        new Vector2(6, 2).scaleAndAdd(2, new Vector2(3, 4)).elements.should.equalishValues(12, 10);
        new Vector2(1, 2).scaleAndAdd(2, new Vector2(3, 4), new Vector2(1, 2)).elements.should.equalishValues(5, 8);
    });

    it('distance', () => {
        new Vector2(6, 2).distance(new Vector2(3, 6)).should.equal(5);
        new Vector2(1, 2).distance(new Vector2(3, 4), new Vector2(0, 0)).should.equal(5);
    });

    it('squaredDistance', () => {
        new Vector2(6, 2).squaredDistance(new Vector2(3, 6)).should.equal(25);
        new Vector2(1, 2).squaredDistance(new Vector2(3, 4), new Vector2(0, 0)).should.equal(25);
    });

    it('length', () => {
        new Vector2(3, -4).length().should.equal(5);
    });

    it('squaredLength', () => {
        new Vector2(3, -4).squaredLength().should.equal(25);
    });

    it('negate', () => {
        new Vector2(0.5, -0.25).negate().elements.should.equalishValues(-0.5, 0.25);
    });

    it('inverse', () => {
        new Vector2(0.5, -0.25).inverse().elements.should.equalishValues(2, -4);
        new Vector2(0.5, -0.25).inverse(new Vector2(0.5, -0.2)).elements.should.equalishValues(2, -5);
    });

    it('normalize', () => {
        new Vector2(3, -4).normalize().elements.should.equalishValues(0.6, -0.8);
    });

    it('dot', () => {
        new Vector2(1, 2).dot(new Vector2(3, 4)).should.equal(11);
    });

    it('cross', () => {
        new Vector2(1, 2).cross(new Vector2(3, 4)).elements.should.equalishValues(0, 0);
        new Vector2(2, 4).cross(new Vector2(1, 2), new Vector2(3, 4)).elements.should.equalishValues(0, 0);
    });

    it('lerp', () => {
        new Vector2(1, 2).lerp(new Vector2(3, 4), 0.5).elements.should.equalishValues(2, 3);
    });

    it('random', () => {
        const len = new Vector2(1, 2).random(0.4).length();
        len.should.be.within(0, 0.40001);
    }); 

    it('transformMat3', () => {
        const mat3 = new Hilo3d.Matrix3().scale(new Vector2(2, 0.5));
        new Vector2(2, 1).transformMat3(mat3).elements.should.equalishValues(4, 0.5);
    });

    it('transformMat4', () => {
        const mat4 = new Hilo3d.Matrix4().scale(new Hilo3d.Vector3(2, 0.5, 1));
        new Vector2(2, 1).transformMat4(mat4).elements.should.equalishValues(4, 0.5);
    });

    it('equals & exactEquals', () => {
        new Vector2(1.001, 2.009).exactEquals(new Vector2(1.001, 2.009)).should.be.True();

        new Vector2(1.001, 2.009).exactEquals(new Vector2(1.001001, 2.009)).should.be.False();
        new Vector2(1.001, 2.009).equals(new Vector2(1.001001, 2.009)).should.be.True();
    });
});