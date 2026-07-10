const CubeTextureLoader = Hilo3d.CubeTextureLoader;

describe('CubeTextureLoader', () => {
    it('create', () => {
        const loader = new CubeTextureLoader;
        loader.isCubeTextureLoader.should.be.true();
        loader.className.should.equal('CubeTextureLoader');
    });
});