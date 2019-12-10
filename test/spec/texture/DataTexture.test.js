const DataTexture = Hilo3d.DataTexture;

describe('DataTexture', () => {
    it('create', () => {
        const texture = new DataTexture();
        texture.isDataTexture.should.be.true();
        texture.className.should.equal('DataTexture');
    });

    it('resetSize', () => {
        const texture = new DataTexture();
        texture.resetSize(100);
        texture.width.should.equal(4);
        texture.height.should.equal(8);

        texture.resetSize(200);
        texture.width.should.equal(8);
        texture.height.should.equal(8);
    });

    it('data', () => {
        const texture = new DataTexture({
            data:new Float32Array(100)
        });
        texture.width.should.equal(4);
        texture.height.should.equal(8);
        texture.image.length.should.equal(128);
    });
});