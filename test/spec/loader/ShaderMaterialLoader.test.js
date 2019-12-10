const ShaderMaterialLoader = Hilo3d.ShaderMaterialLoader;

describe('ShaderMaterialLoader', () => {
    it('create', () => {
        const loader = new ShaderMaterialLoader;
        loader.isShaderMaterialLoader.should.be.true();
        loader.className.should.equal('ShaderMaterialLoader');
    });
});