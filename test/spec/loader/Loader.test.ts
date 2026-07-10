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

        void loader.load({
            src: 'a.jpg'
        }).catch(() => undefined);

        should.not.exist(Hilo3d.BasicLoader.cache.get('a.jpg'));
        should.exist(Hilo3d.BasicLoader.cache.get('a.jpg?haha=1'));

        loader.preHandlerUrl = null;
        void loader.load({
            src: 'b.png'
        }).catch(() => undefined);

        should.exist(Hilo3d.BasicLoader.cache.get('b.png'));
    });

    it('load');
});
