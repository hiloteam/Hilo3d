const CubeTexture = Hilo3d.CubeTexture;

describe('CubeTexture', () => {
    it('create', () => {
        const texture = new CubeTexture();
        texture.isCubeTexture.should.be.true();
        texture.className.should.equal('CubeTexture');
    });

    it('images', () => {
        const texture = new CubeTexture({
            image:[
                new Image,
                new Image,
                new Image,
                new Image,
                new Image,
                new Image,
            ]
        });

        texture.right.should.equal(texture.image[0]);
        texture.left.should.equal(texture.image[1]);
        texture.top.should.equal(texture.image[2]);
        texture.bottom.should.equal(texture.image[3]);
        texture.front.should.equal(texture.image[4]);
        texture.back.should.equal(texture.image[5]);
    });
});