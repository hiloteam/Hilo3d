const HDRLoader = Hilo3d.HDRLoader;

describe('HDRLoader', () => {
    it('create', () => {
        const loader = new HDRLoader;
        loader.isHDRLoader.should.be.true();
        loader.className.should.equal('HDRLoader');
    });
});