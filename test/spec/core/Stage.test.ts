const Stage = Hilo3d.Stage;
const WebGLRenderer = Hilo3d.WebGLRenderer;

describe('Stage', () => {
    it('create', () => {
        const stage = new Stage({});
        stage.isStage.should.be.true();
        stage.className.should.equal('Stage');
        stage.width.should.equal(innerWidth);
        stage.height.should.equal(innerHeight);
        stage.pixelRatio.should.aboveOrEqual(1);
        stage.pixelRatio.should.belowOrEqual(2);
        stage.renderer.should.instanceOf(WebGLRenderer);
    });

    it('resize', () => {
        const stage = new Stage({
            width: 800,
            height: 600
        });

        stage.resize(1000, 800, 2);
        stage.width.should.equal(1000);
        stage.height.should.equal(800);
        stage.pixelRatio.should.equal(2);
        stage.rendererWidth.should.equal(2000);
        stage.rendererHeight.should.equal(1600);
        stage.canvas.style.width.should.equal('1000px');
        stage.canvas.style.height.should.equal('800px');
    });
});