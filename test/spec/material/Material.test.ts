const Material = Hilo3d.Material;
const constants = Hilo3d.constants;

describe('Material', () => {
    it('create', () => {
        const material = new Material();
        material.isMaterial.should.be.true();
        material.className.should.equal('Material');
    });

    it('clone', () => {
        const material = new Material({
            diffuse:new Hilo3d.Color(),
            transparent:true
        });

        const clonedMaterial = material.clone();
        clonedMaterial.diffuse.elements.should.equal(material.diffuse.elements);
        clonedMaterial.transparent.should.equal(material.transparent);
    });

    it('side & cullFace', () => {
        const material = new Material;

        material.side = constants.FRONT;
        material.cullFace.should.be.true();
        material.cullFaceType.should.equal(constants.BACK);

        material.side = constants.FRONT_AND_BACK;
        material.cullFace.should.be.false();

        material.side = constants.BACK;
        material.cullFace.should.be.true();
        material.cullFaceType.should.equal(constants.FRONT);

        material.cullFaceType = constants.BACK;
        material.side.should.equal(constants.FRONT);

        material.cullFace = false;
        material.side.should.equal(constants.FRONT_AND_BACK);
    });

    it('transparent', () => {
        const material = new Material;

        material.transparent = true;
        material.blend.should.be.true();
        material.blendSrc.should.equal(constants.ONE);
        material.blendDst.should.equal(constants.ONE_MINUS_SRC_ALPHA);
        material.blendSrcAlpha.should.equal(constants.ONE);
        material.blendDstAlpha.should.equal(constants.ONE_MINUS_SRC_ALPHA);
        material.depthMask.should.be.false();

        material.transparent = false;
        material.blend.should.be.false();
        material.depthMask.should.be.true();
    });

    it('getRenderOption', () => {
        const material = new Material({
            normalMap:new Hilo3d.Texture({
                uv:1
            }),
            alphaCutoff:0.8
        });

        const option = material.getRenderOption({
            HAS_LIGHT:1
        });
        option.NORMAL_MAP.should.equal(1);
        option.HAS_TEXCOORD1.should.equal(1);
        should(option.HAS_TEXCOORD0).be.undefined();
        option.ALPHA_CUTOFF.should.equal(1);
    });

    it('gammaCorrection', () => {
        let material = new Material();

        material.gammaCorrection.should.be.false();
        material.gammaOutput.should.be.false();
        should(material.getRenderOption().GAMMA_CORRECTION).be.undefined();

        material.gammaCorrection = true;
        material.gammaOutput.should.be.true();
        should(material.getRenderOption().GAMMA_CORRECTION).be.equal(1);

        material.gammaOutput = false;
        material.gammaCorrection.should.be.false();
        should(material.getRenderOption().GAMMA_CORRECTION).be.undefined();
    });
});