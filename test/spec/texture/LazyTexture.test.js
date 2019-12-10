const LazyTexture = Hilo3d.LazyTexture;

describe('LazyTexture', () => {
    it('create', () => {
        const texture = new LazyTexture();
        texture.isLazyTexture.should.be.true();
        texture.className.should.equal('LazyTexture');
    });

    it('load', (done) => {
        const texture = new LazyTexture({
            src:'./asset/images/logo.png'
        });

        texture.on('load', () => {
            texture.image.width.should.equal(600);
            done();
        });

        texture.on('error', () => {
            done(new Error('load error!'));
        })
    });
});