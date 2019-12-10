const CameraHelper = Hilo3d.CameraHelper;

describe('CameraHelper', () => {
    it('create', () => {
        const helper = new CameraHelper;
        helper.isCameraHelper.should.be.true();
        helper.className.should.equal('CameraHelper');
    });
});