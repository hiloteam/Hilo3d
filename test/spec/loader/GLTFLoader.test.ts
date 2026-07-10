const GLTFLoader = Hilo3d.GLTFLoader;

describe('GLTFLoader', () => {
    it('create', () => {
        const loader = new GLTFLoader;
        loader.isGLTFLoader.should.be.true();
        loader.className.should.equal('GLTFLoader');
    });
});