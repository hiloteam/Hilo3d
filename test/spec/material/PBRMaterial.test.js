const PBRMaterial = Hilo3d.PBRMaterial;

describe('PBRMaterial', () => {
    it('create', () => {
        const material = new PBRMaterial();
        material.isPBRMaterial.should.be.true();
        material.className.should.equal('PBRMaterial');
    });

    it('getRenderOption', () => {
        const material = new PBRMaterial({
            metallicRoughnessMap:new Hilo3d.Texture({
                uv:0
            }),
            baseColorMap:new Hilo3d.Texture({
                uv:1
            }),
            specularEnvMap:new Hilo3d.Texture,
            isSpecularGlossiness:true
        });

        const option = material.getRenderOption();
        option.HAS_TEXCOORD0.should.equal(1);
        option.METALLIC_ROUGHNESS_MAP.should.equal(0);

        option.HAS_TEXCOORD1.should.equal(1);
        option.BASE_COLOR_MAP.should.equal(1);

        option.PBR_SPECULAR_GLOSSINESS.should.equal(1);
        should(option.SPECULAR_ENV_MAP).be.undefined();

        material.brdfLUT = new Hilo3d.Texture;
        material.getRenderOption().SPECULAR_ENV_MAP.should.equal(0);
        should(material.getRenderOption().SPECULAR_ENV_MAP_CUBE).be.undefined();

        material.specularEnvMap = new Hilo3d.CubeTexture;
        material.getRenderOption().SPECULAR_ENV_MAP_CUBE.should.equal(1);
    });

    it('gammaCorrection', () => {
        let material = new PBRMaterial();

        material.gammaCorrection.should.be.true();
        material.gammaOutput.should.be.true();
        should(material.getRenderOption().GAMMA_CORRECTION).be.equal(1);

        material.gammaOutput = false;
        material.gammaCorrection.should.be.false();
        should(material.getRenderOption().GAMMA_CORRECTION).be.undefined();

        material.gammaCorrection = true;
        material.gammaOutput.should.be.true();
        should(material.getRenderOption().GAMMA_CORRECTION).be.equal(1);
    });
});