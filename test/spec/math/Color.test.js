var Color = Hilo3d.Color;

describe('Color', () => {
    var colorA;
    beforeEach(() => {
        colorA = new Color(1, 2, 3, 4);
    });

    it('create', () => {
        colorA.isColor.should.be.true();
        colorA.className.should.equal('Color');
        colorA.r.should.equal(1);
        colorA.g.should.equal(2);
        colorA.b.should.equal(3);
        colorA.a.should.equal(4);
    });

    it('toRGBArray', () => {
        var arr = [];
        colorA.toRGBArray(arr, 2);
        arr[2].should.equal(1);
        arr[3].should.equal(2);
        arr[4].should.equal(3);
    });

    it('fromUintArray', () => {
        var arr = [0, 0, 255, 128, 255, 128];
        colorA.fromUintArray(arr, 2).elements.should.equalishValues(1, 128/255, 1, 128/255);
    });

    it('fromHEX', () => {
        new Color().fromHEX(16750950).elements.should.equalishValues(1, 0.6, 0.4, 1);
        new Color().fromHEX(0xff9966).elements.should.equalishValues(1, 0.6, 0.4, 1);
        new Color().fromHEX(0x0000ff).elements.should.equalishValues(0, 0, 1, 1);
        new Color().fromHEX(0x006699).elements.should.equalishValues(0, 0.4, 0.6, 1);
        new Color().fromHEX('#ff9966').elements.should.equalishValues(1, 0.6, 0.4, 1);
        new Color().fromHEX('#f96').elements.should.equalishValues(1, 0.6, 0.4, 1);
        new Color().fromHEX('ff9966').elements.should.equalishValues(1, 0.6, 0.4, 1);
        new Color().fromHEX('f96').elements.should.equalishValues(1, 0.6, 0.4, 1);
    });

    it('toHEX', () => {
        new Color(1, 0.6, 0.4, 1).toHEX().should.equal('ff9966');
    });
});