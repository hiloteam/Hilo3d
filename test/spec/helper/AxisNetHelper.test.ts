const AxisNetHelper = Hilo3d.AxisNetHelper;

describe('AxisNetHelper', () => {
    it('create', () => {
        const helper = new AxisNetHelper;
        helper.isAxisNetHelper.should.be.true();
        helper.className.should.equal('AxisNetHelper');
    });
});