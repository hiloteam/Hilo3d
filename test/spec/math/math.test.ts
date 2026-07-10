const math = Hilo3d.math;

describe('math', function() {
    it('generateUUID', () => {
        math.generateUUID().should.not.equal(math.generateUUID());
        math.generateUUID().should.be.String();
    });

    it('clamp', () => {
        math.clamp(1, 1, 2).should.equalish(1);
        math.clamp(2, 1, 2).should.equalish(2);
        math.clamp(-1, 1, 2).should.equalish(1);
        math.clamp(3, 1, 2).should.equalish(2);
        math.clamp(1.5, 1, 2).should.equalish(1.5);
    });

    it('degToRad', () => {
        math.DEG2RAD.should.equalish(Math.PI/180);
        math.degToRad(90).should.equalish(Math.PI/2);
    });

    it('radToDeg', () => {
        math.RAD2DEG.should.equalish(180/Math.PI);
        math.radToDeg(Math.PI/3).should.equalish(60);
    });

    it('isPowerOfTwo', () => {
        math.isPowerOfTwo(2).should.be.true();
        math.isPowerOfTwo(256).should.be.true();
        math.isPowerOfTwo(238).should.be.false();
    });

    it('nearestPowerOfTwo', () => {
        math.nearestPowerOfTwo(2).should.equalish(2);
        math.nearestPowerOfTwo(9).should.equalish(8);
        math.nearestPowerOfTwo(15).should.equalish(16);
    });

    it('nextPowerOfTwo', () => {
        math.nextPowerOfTwo(9).should.equalish(16);
        math.nextPowerOfTwo(2).should.equalish(2);
    });
});