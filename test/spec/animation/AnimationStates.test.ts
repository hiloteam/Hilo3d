const AnimationStates = Hilo3d.AnimationStates;

describe('AnimationStates', () => {
    it('create', () => {
        const animationStates = new AnimationStates;
        animationStates.isAnimationStates.should.be.true();
        animationStates.className.should.equal('AnimationStates');
    });
});