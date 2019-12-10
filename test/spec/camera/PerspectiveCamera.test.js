const PerspectiveCamera = Hilo3d.PerspectiveCamera;

describe('PerspectiveCamera', () => {
    it('create', () => {
        const camera = new PerspectiveCamera;
        camera.isPerspectiveCamera.should.be.true();
        camera.className.should.equal('PerspectiveCamera');
    });
});