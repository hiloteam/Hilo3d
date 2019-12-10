const KTXLoader = Hilo3d.KTXLoader;

describe('KTXLoader', () => {
    it('create', () => {
        const loader = new KTXLoader;
        loader.isKTXLoader.should.be.true();
        loader.className.should.equal('KTXLoader');
    });
});