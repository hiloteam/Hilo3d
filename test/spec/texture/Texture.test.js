const Texture = Hilo3d.Texture;

describe('Texture', () => {
    it('create', () => {
        const texture = new Texture();
        texture.isTexture.should.be.true();
        texture.className.should.equal('Texture');
    });

    it('isImgPowerOfTwo', () => {
        const texture = new Texture();
        const img = new Image;
        img.width = 100;
        img.height = 100;

        texture.isImgPowerOfTwo(img).should.be.false();
        img.width = 512;
        texture.isImgPowerOfTwo(img).should.be.false();
        img.height = 1024;
        texture.isImgPowerOfTwo(img).should.be.true();
    });

    it('resizeImgToPowerOfTwo', (done) => {
        const texture = new Texture();
        const img = new Image;
        img.onload = () => {
            texture.isImgPowerOfTwo(img).should.be.false();
            texture.isImgPowerOfTwo(texture.resizeImgToPowerOfTwo(img)).should.be.true();
            done();
        };
        img.src='./asset/images/logo.png';
    });

    it('getSupportSize', () => {
        const texture = new Texture();
        let img = {width:1024000, height:2040};
        const originMaxTextureSize = Hilo3d.capabilities.MAX_TEXTURE_SIZE;
        let size;

        Hilo3d.capabilities.MAX_TEXTURE_SIZE = null;
        size = texture.getSupportSize(img);
        size.width.should.equal(img.width);
        size.height.should.equal(img.height);

        Hilo3d.capabilities.MAX_TEXTURE_SIZE = 4096;
        size = texture.getSupportSize(img);
        size.width.should.equal(4096);
        size.height.should.equal(2040);

        Hilo3d.capabilities.MAX_TEXTURE_SIZE = 4096;
        size = texture.getSupportSize(img, true);
        size.width.should.equal(4096);
        size.height.should.equal(2048);

        img.width = 4097;
        img.height = 4097;
        Hilo3d.capabilities.MAX_TEXTURE_SIZE = 4096;
        size = texture.getSupportSize(img, true);
        size.width.should.equal(4096);
        size.height.should.equal(4096);

        img.width = 4097;
        img.height = 19999;
        Hilo3d.capabilities.MAX_TEXTURE_SIZE = 20000;
        size = texture.getSupportSize(img, true);
        size.width.should.equal(8192);
        size.height.should.equal(20000);

        Hilo3d.capabilities.MAX_TEXTURE_SIZE = originMaxTextureSize;
    });
});