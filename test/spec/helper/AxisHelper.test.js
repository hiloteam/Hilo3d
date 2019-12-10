const AxisHelper = Hilo3d.AxisHelper;

describe('AxisHelper', () => {
    it('create', () => {
        const helper = new AxisHelper;
        helper.isAxisHelper.should.be.true();
        helper.className.should.equal('AxisHelper');
    });
});