const RenderInfo = Hilo3d.RenderInfo;

describe('RenderInfo', () => {
    it('create', () => {
        const info = new RenderInfo;
        info.isRenderInfo.should.be.true();
        info.className.should.equal('RenderInfo');
    });

    it('addFaceCount', () => {
        const info = new RenderInfo;
        info.addFaceCount(5);
        info._currentFaceCount.should.equal(5);
        info.addFaceCount(3);
        info._currentFaceCount.should.equal(8);
        info.addFaceCount(0);
        info._currentFaceCount.should.equal(8);
    });

    it('addDrawCount', () => {
        const info = new RenderInfo;
        info.addDrawCount(5);
        info._currentDrawCount.should.equal(5);
        info.addDrawCount(3);
        info._currentDrawCount.should.equal(8);
        info.addDrawCount(0);
        info._currentDrawCount.should.equal(8);
    });

    it('reset', () => {
        const info = new RenderInfo;
        info.addFaceCount(5);
        info.addFaceCount(3.2);
        info.addDrawCount(1);
        info.addDrawCount(3);

        info.reset();

        info._currentFaceCount.should.equal(0);
        info._currentDrawCount.should.equal(0);
        info.faceCount.should.equal(8);
        info.drawCount.should.equal(4);
    });
});