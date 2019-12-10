const Animation = Hilo3d.Animation;

describe('Animation', () => {
    it('create', () => {
        const animation = new Animation;
        animation.isAnimation.should.be.true();
        animation.className.should.equal('Animation');
    });
});