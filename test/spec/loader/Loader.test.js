const Loader = Hilo3d.Loader;

describe('Loader', () => {
    it('create', () => {
        const loader = new Loader;
        loader.isLoader.should.be.true();
        loader.className.should.equal('Loader');
    });

    it('preHandlerUrl', () => {
        const loader = new Loader();
        loader.preHandlerUrl = (url) => {
            return url + '?haha=1';
        };

        loader.load({
            src: 'a.jpg'
        });

        should.not.exist(Hilo3d.BasicLoader.cache.get('a.jpg'));
        should.exist(Hilo3d.BasicLoader.cache.get('a.jpg?haha=1'));

        loader.preHandlerUrl = null;
        loader.load({
            src: 'b.png'
        });

        should.exist(Hilo3d.BasicLoader.cache.get('b.png'));
    });

    it('load');
});