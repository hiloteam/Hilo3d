const Matrix4 = Hilo3d.Matrix4;

describe('Matrix4', function() {
    var matA, matB, matC, matD, identity;
    beforeEach(() => {
        matA = new Matrix4();
        matB = new Matrix4();
        matC = new Matrix4();
        matD = new Matrix4();
        identity = new Matrix4();

        matA.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1);
        matB.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1);
        matC.set(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
        matD.set(0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30);
    });

    it('create', () => {
        identity.isMatrix4.should.be.true();
        identity.className.should.equal('Matrix4');
    });

    it('copy', () => {
        new Matrix4().copy(matC).elements.should.equalishValues(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
    });

    it('clone', () => {
        matC.clone().elements.should.equalishValues(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
    });

    it('toArray', () => {
        var arr = [];
        matC.toArray(arr, 3);
        arr[3].should.equal(0);
        arr[4].should.equal(1);
        arr[5].should.equal(2);
    });

    it('fromArray', () => {
        identity.fromArray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], 3).elements.should.equalishValues(3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18);
    });

    it('set', () => {
        identity.set(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15).elements.should.equalishValues(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
    });

    it('identity', () => {
        matC.identity().elements.should.equalishValues(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    });

    it('transpose', () => {
        matC.transpose().elements.should.equalishValues(0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15);
    });

    it('invert', () => {
        identity.invert(matA).elements.should.equalishValues(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -2, -3, 1);
        matA.invert().elements.should.equalishValues(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -2, -3, 1);
    });

    it('adjoint', () => {
        identity.adjoint(matA).elements.should.equalishValues(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -2, -3, 1);
        matA.adjoint().elements.should.equalishValues(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -2, -3, 1);
    });

    it('determinant', () => {
        matA.determinant().should.equalish(1);
    });

    it('multiply', () => {
        identity.multiply(matA, matB).elements.should.equalishValues( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 7, 9, 1);
        matA.multiply(matB).elements.should.equalishValues( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 7, 9, 1);
    });

    it('premultiply', () => {
        matB.premultiply(matA).elements.should.equalishValues( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 7, 9, 1);
    });

    it('translate', () => {
        matA.translate(new Hilo3d.Vector3(4, 5, 6)).elements.should.equalishValues(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 7, 9, 1);
    });

    it('rotate', () => {
        var rad = Math.PI * 0.5;
        matA.rotate(rad, new Hilo3d.Vector3(1, 0, 0)).elements.should.equalishValues( 1, 0, 0, 0, 0, Math.cos(rad), Math.sin(rad), 0, 0, -Math.sin(rad), Math.cos(rad), 0, 1, 2, 3, 1);
    });

    it('rotateX', () => {
        var rad = Math.PI * 0.5;
        matA.rotateX(rad).elements.should.equalishValues( 1, 0, 0, 0, 0, Math.cos(rad), Math.sin(rad), 0, 0, -Math.sin(rad), Math.cos(rad), 0, 1, 2, 3, 1);
    });

    it('rotateY', () => {
        var rad = Math.PI * 0.5;
        matA.rotateY(rad).elements.should.equalishValues( Math.cos(rad), 0, -Math.sin(rad), 0, 0, 1, 0, 0, Math.sin(rad), 0, Math.cos(rad), 0, 1, 2, 3, 1);
    });

    it('rotateZ', () => {
        var rad = Math.PI * 0.5;
        matA.rotateZ(rad, new Hilo3d.Vector3(1, 0, 0)).elements.should.equalishValues(  Math.cos(rad), Math.sin(rad), 0, 0, -Math.sin(rad), Math.cos(rad), 0, 0, 0, 0, 1, 0, 1, 2, 3, 1);
    });

    it('fromTranslation', () => {
        identity.fromTranslation(new Hilo3d.Vector3(1, 2, 3)).elements.should.equalishValues(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1);
    });

    it('fromScaling', () => {
        identity.fromScaling(new Hilo3d.Vector3(2, 1, 3)).elements.should.equalishValues(2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1);
    });

    it('fromRotation', () => {
        identity.fromRotation(Math.PI*0.5, new Hilo3d.Vector3(0, 1, 0)).elements.should.equalishValues(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
    });

    it('fromXRotation', () => {
        identity.fromXRotation(Math.PI*0.5).elements.should.equalishValues(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    });

    it('fromYRotation', () => {
        identity.fromYRotation(Math.PI*0.5).elements.should.equalishValues(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
    });

    it('fromZRotation', () => {
        identity.fromZRotation(Math.PI*0.5).elements.should.equalishValues( 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    });

    it('fromRotationTranslation', () => {
        identity.fromRotationTranslation(new Hilo3d.Quaternion(0, 0.7071067811865476, 0, 0.7071067811865476), new Hilo3d.Vector3(1, 2, 3)).elements.should.equalishValues(3.422854177870249e-8, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 2, 3, 1);
    });

    it('getTranslation', () => {
        matB.getTranslation().elements.should.equalishValues(4, 5, 6);
    });

    it('getScaling', () => {
        identity.fromScaling(new Hilo3d.Vector3(1, 2, 3)).getScaling().elements.should.equalishValues(1, 2, 3);
    });

    it('getRotation', () => {
        identity.rotateZ(Math.PI*0.5);
        identity.getRotation().elements.should.equalishValues(0, 0, Math.sqrt(2)*0.5, Math.sqrt(2)*0.5);
    });

    it('fromRotationTranslationScale', () => {
        identity.translate(new Hilo3d.Vector3(1, 2, 3));
        identity.scale(new Hilo3d.Vector3(0.1, 2, 5));
        identity.rotate(Math.PI*0.5, new Hilo3d.Vector3(1, 0, 0));

        matA.fromRotationTranslationScale(new Hilo3d.Quaternion(Math.sqrt(2)*0.5, 0, 0, Math.sqrt(2)*0.5), new Hilo3d.Vector3(1, 2, 3), new Hilo3d.Vector3(0.1, 5, 2));
        matA.equals(identity).should.be.true();
    });

    it('fromRotationTranslationScaleOrigin', () => {
        identity.translate(new Hilo3d.Vector3(5, 6, 7));
        identity.translate(new Hilo3d.Vector3(1, 2, 3));
        identity.scale(new Hilo3d.Vector3(0.1, 2, 5));
        identity.rotate(Math.PI*0.5, new Hilo3d.Vector3(1, 0, 0));
        identity.translate(new Hilo3d.Vector3(-5, -6, -7));

        matA.fromRotationTranslationScaleOrigin(new Hilo3d.Quaternion(Math.sqrt(2)*0.5, 0, 0, Math.sqrt(2)*0.5), new Hilo3d.Vector3(1, 2, 3), new Hilo3d.Vector3(0.1, 5, 2), new Hilo3d.Vector3(5, 6, 7));
        matA.equals(identity).should.be.true();
    });

    it('fromQuat', () => {
        identity.fromQuat(new Hilo3d.Quaternion(0, 0.7071067811865476, 0, 0.7071067811865476)).elements.should.equalishValues(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
    });

    it('frustum', () => {
        identity.frustum(-1, 1, -1, 1, -1, 1).elements.should.equalishValues(-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0);
    });

    it('perspective', () => {
        var fovy = Math.PI * 0.5;
        identity.perspective( fovy, 1, 0, 1).elements.should.equalishValues( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0);
    });

    it('perspectiveFromFieldOfView', () => {
        var fov = 45;
        identity.perspectiveFromFieldOfView( {
            upDegrees:fov,
            downDegrees:fov,
            leftDegrees:fov,
            rightDegrees:fov
        }, 0, 1).elements.should.equalishValues( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0);
    });

    it('ortho', () => {
        identity.ortho(-1, 1, -1, 1, -1, 1).elements.should.equalishValues(  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);
    });

    it('lookAt', () => {
        identity.lookAt(new Hilo3d.Vector3(0,2,0), new Hilo3d.Vector3(0,0.6,0), new Hilo3d.Vector3(0,0,-1));
        new Hilo3d.Vector3(1, 2, 0).transformMat4(identity).elements.should.equalishValues(1, 0, 0);
    });

    it('targetTo', () => {
        matB.targetTo(new Hilo3d.Vector3(0, 2, 0), new Hilo3d.Vector3(0, 0.6, 0), new Hilo3d.Vector3(0, 0, -1));
        matB.getScaling().elements.should.equalishValues(1, 1, 1);
        new Hilo3d.Vector3(1, 2, 0).transformMat4(matB).elements.should.equalishValues(1, 2, -2);
    });

    it('frob', () => {
        matA.frob().should.equalish(Math.sqrt(Math.pow(1, 2) + Math.pow(1, 2) + Math.pow(1, 2) + Math.pow(1, 2) + Math.pow(1, 2) + Math.pow(2, 2) + Math.pow(3, 2)));
    });

    it('add', () => {
        identity.add(matC, matD).elements.should.equalishValues(0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45);
        matD.add(matC).elements.should.equalishValues(0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45);
    });

    it('subtract', () => {
        identity.subtract(matC, matD).elements.should.equalishValues(0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12, -13, -14, -15);
        matD.subtract(matC).elements.should.equalishValues(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
    });

    it('exactEquals', () => {
        var mat = matA.clone();
        mat.exactEquals(matA).should.be.true();
    });

    it('equals', () => {
        var mat = matA.clone();
        mat.elements[0] = 1.000001;
        mat.exactEquals(matA).should.be.false();
        mat.equals(matA).should.be.true();
    });

    it('compose', () => {
        identity.translate(new Hilo3d.Vector3(1, 2, 3));
        identity.scale(new Hilo3d.Vector3(0.1, 2, 5));
        identity.rotate(Math.PI*0.5, new Hilo3d.Vector3(1, 0, 0));

        matA.compose(new Hilo3d.Quaternion(Math.sqrt(2)*0.5, 0, 0, Math.sqrt(2)*0.5), new Hilo3d.Vector3(1, 2, 3), new Hilo3d.Vector3(0.1, 5, 2));
        matA.equals(identity).should.be.true();
    });

    it('decompose', () => {
        identity.translate(new Hilo3d.Vector3(1, 2, 3));
        identity.scale(new Hilo3d.Vector3(0.1, 2, 5));
        identity.rotate(Math.PI*0.5, new Hilo3d.Vector3(1, 0, 0));

        var pos = new Hilo3d.Vector3();
        var scale = new Hilo3d.Vector3();
        var quat = new Hilo3d.Quaternion();
        identity.decompose(quat, pos, scale);

        pos.elements.should.equalishValues(1, 2, 3);
        scale.elements.should.equalishValues(0.1, 5, 2);
        quat.elements.should.equalishValues(Math.sqrt(2)*0.5, 0, 0, Math.sqrt(2)*0.5);
    });
});