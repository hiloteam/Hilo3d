const Matrix3 = Hilo3d.Matrix3;

describe('Matrix3', function() {
    var matA, matB, matC, matD, identity;
    beforeEach(() => {
        matA = new Matrix3();
        matB = new Matrix3();
        matC = new Matrix3();
        matD = new Matrix3();
        identity = new Matrix3();

        matA.set(1, 0, 0, 0, 1, 0, 1, 2, 1);
        matB.set(1, 0, 0, 0, 1, 0, 3, 4, 1);
        matC.set(0, 1, 2, 3, 4, 5, 6, 7, 8);
        matD.set(0, 2, 4, 6, 8, 10, 12, 14, 16);
    });

    it('create', () => {
        identity.isMatrix3.should.be.true();
        identity.className.should.equal('Matrix3');
    });

    it('copy', () => {
        new Matrix3().copy(matC).elements.should.equalishValues(0, 1, 2, 3, 4, 5, 6, 7, 8);
    });

    it('clone', () => {
        matC.clone().elements.should.equalishValues(0, 1, 2, 3, 4, 5, 6, 7, 8);
    });

    it('toArray', () => {
        var arr = [];
        matC.toArray(arr, 3);
        arr[3].should.equal(0);
        arr[4].should.equal(1);
        arr[5].should.equal(2);
    });

    it('fromArray', () => {
        identity.fromArray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3).elements.should.equalishValues(3, 4, 5, 6, 7, 8, 9, 10, 11);
    });

    it('set', () => {
        identity.set(0, 1, 2, 3, 4, 5, 6, 7, 8).elements.should.equalishValues(0, 1, 2, 3, 4, 5, 6, 7, 8);
    });

    it('identity', () => {
        matC.identity().elements.should.equalishValues(1, 0, 0, 0, 1, 0, 0, 0, 1);
    });

    it('transpose', () => {
        matC.transpose().elements.should.equalishValues(0, 3, 6, 1, 4, 7, 2, 5, 8);
    });

    it('invert', () => {
        identity.invert(matA).elements.should.equalishValues(1, 0, 0, 0, 1, 0, -1, -2, 1);
        matA.invert().elements.should.equalishValues(1, 0, 0, 0, 1, 0, -1, -2, 1);
    });

    it('adjoint', () => {
        identity.adjoint(matA).elements.should.equalishValues(1, 0, 0, 0, 1, 0, -1, -2, 1);
        matA.adjoint().elements.should.equalishValues(1, 0, 0, 0, 1, 0, -1, -2, 1);
    });

    it('determinant', () => {
        matA.determinant().should.equalish(1);
    });

    it('multiply', () => {
        identity.multiply(matA, matB).elements.should.equalishValues( 1, 0, 0, 0, 1, 0, 4, 6, 1);
        matA.multiply(matB).elements.should.equalishValues( 1, 0, 0, 0, 1, 0, 4, 6, 1);
    });

    it('premultiply', () => {
        matB.premultiply(matA).elements.should.equalishValues( 1, 0, 0, 0, 1, 0, 4, 6, 1);
    });

    it('translate', () => {
        matA.translate(new Hilo3d.Vector2(1, 1)).elements.should.equalishValues(1, 0, 0, 0, 1, 0, 2, 3, 1);
    });

    it('rotate', () => {
        matA.rotate(Math.PI * 0.5).elements.should.equalishValues(0, 1, 0, -1, 0, 0, 1, 2, 1);
    });

    it('scale', () => {
        matA.scale(new Hilo3d.Vector2(0.5, 2)).elements.should.equalishValues(0.5, 0, 0, 0, 2, 0, 1, 2, 1);
    });

    it('fromTranslation', () => {
        identity.fromTranslation(new Hilo3d.Vector2(1, 2)).elements.should.equalishValues(1, 0, 0, 0, 1, 0, 1, 2, 1);
    });

    it('fromRotation', () => {
        identity.fromRotation(Math.PI * .5).elements.should.equalishValues(0, 1, 0, -1, 0, 0, 0, 0, 1);
    });

    it('fromScaling', () => {
        matC.fromScaling(new Hilo3d.Vector2(2, 1)).elements.should.equalishValues(2, 0, 0, 0, 1, 0, 0, 0, 1);
    });

    it('fromQuat', () => {
        matC.fromQuat(new Hilo3d.Quaternion( 0, -0.7071067811865475, 0, 0.7071067811865475)).elements.should.equalishValues(0, 0, 1, 0, 1, 0, -1, 0, 0);
    });

    it('normalFromMat4', () => {
        mat = new Hilo3d.Matrix4();
        mat.translate(new Hilo3d.Vector3(2, 4, 6));
        mat.rotateX(Math.PI / 2);
        matA.normalFromMat4(mat).elements.should.equalishValues(1, 0, 0, 0, 0, 1, 0,-1, 0);
    });

    it('fromMat4', () => {
        mat = new Hilo3d.Matrix4();
        mat.translate(new Hilo3d.Vector3(2, 4, 6));
        mat.rotateX(Math.PI / 2);
        matA.fromMat4(mat).elements.should.equalishValues(1, 0, 0, 0, 0, 1, 0,-1, 0);
    });

    it('frob', () => {
        matA.frob().should.equalish(Math.sqrt(Math.pow(1, 2) + Math.pow(0, 2) + Math.pow(0, 2) + Math.pow(0, 2) + Math.pow(1, 2) + Math.pow(0, 2) + Math.pow(1, 2) + Math.pow(2, 2) + Math.pow(1, 2)));
    });

    it('add', () => {
        identity.add(matC, matD).elements.should.equalishValues(0, 3, 6, 9, 12, 15, 18, 21, 24);
        matD.add(matC).elements.should.equalishValues(0, 3, 6, 9, 12, 15, 18, 21, 24);
    });

    it('subtract', () => {
        identity.subtract(matC, matD).elements.should.equalishValues(0, -1, -2, -3, -4, -5, -6, -7, -8);
        matD.subtract(matC).elements.should.equalishValues(0, 1, 2, 3, 4, 5, 6, 7, 8);
    });

    it('exactEquals', () => {
        matD.set(0, 1, 2, 3, 4, 5, 6, 7, 8);
        matC.exactEquals(matD).should.be.true();
    });

    it('equals', () => {
        matD.set(0, 1, 2, 3, 4, 5, 6, 7, 8.000001);
        matC.exactEquals(matD).should.be.false();
        matC.equals(matD).should.be.true();
    });

    it('fromRotationTranslationScale', () => {
        matB.fromRotationTranslationScale(Math.PI*0.5, 2, 1, 0.1, 2).elements.should.equalishValues(0, -2, 0, 0.1, 0, 0, 2, 1, 1);
    });
});