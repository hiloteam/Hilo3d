const Camera = Hilo3d.Camera;
const Matrix4 = Hilo3d.Matrix4;
const Frustum = Hilo3d.Frustum;

describe('Camera', () => {
    it('create', () => {
        const camera = new Camera;
        camera.isCamera.should.be.true();
        camera.className.should.equal('Camera');
        camera.viewMatrix.should.instanceof(Matrix4);
        camera.projectionMatrix.should.instanceof(Matrix4);
        camera.viewProjectionMatrix.should.instanceof(Matrix4);
        camera._frustum.should.instanceof(Frustum);
    });
});