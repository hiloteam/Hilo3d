const ShaderMaterial = Hilo3d.ShaderMaterial;

describe('ShaderMaterial', () => {
    it('create', () => {
        const material = new ShaderMaterial();
        material.isShaderMaterial.should.be.true();
        material.className.should.equal('ShaderMaterial');
        material.vs.should.be.String();
        material.fs.should.be.String();
    });

    it('getRenderOption', () => {
        const material = new ShaderMaterial({
            getCustomRenderOption:function(option){
                return Object.assign(option, {
                    TEST:1
                });
            }
        });

        const options = {
            INIT:1
        };
        material.getRenderOption(options);

        options.INIT.should.equal(1);
        options.HILO_CUSTUM_OPTION_TEST.should.equal(1);
    });
});