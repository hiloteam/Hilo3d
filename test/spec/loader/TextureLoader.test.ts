const TextureLoader = Hilo3d.TextureLoader;

describe('TextureLoader', () => {
    it('create', () => {
        const loader = new TextureLoader;
        loader.isTextureLoader.should.be.true();
        loader.className.should.equal('TextureLoader');
    });
});