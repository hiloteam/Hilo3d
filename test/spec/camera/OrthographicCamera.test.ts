const OrthographicCamera = Hilo3d.OrthographicCamera;

describe('OrthographicCamera', () => {
    it('create', () => {
        const camera = new OrthographicCamera;
        camera.isOrthographicCamera.should.be.true();
        camera.className.should.equal('OrthographicCamera');
    });
});