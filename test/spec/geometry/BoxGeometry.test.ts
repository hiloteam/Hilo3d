const BoxGeometry = Hilo3d.BoxGeometry;

describe('BoxGeometry', () => {
    it('create', () => {
        const geometry = new BoxGeometry;
        geometry.isBoxGeometry.should.be.true();
        geometry.className.should.equal('BoxGeometry');
    });
});