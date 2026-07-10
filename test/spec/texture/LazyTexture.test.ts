const LazyTexture = Hilo3d.LazyTexture;

describe('LazyTexture', () => {
    it('create', () => {
        const texture = new LazyTexture();
        texture.isLazyTexture.should.be.true();
        texture.className.should.equal('LazyTexture');
    });

    it('load', () => {
        return new Promise<void>((resolve, reject) => {
            const texture = new LazyTexture({
                src: '/test/asset/images/logo.png'
            });

            texture.on('load', () => {
                texture.image.width.should.equal(600);
                resolve();
            });

            texture.on('error', () => {
                reject(new Error('load error!'));
            });
        });
    });
});
