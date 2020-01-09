const GLTFParser = Hilo3d.GLTFParser;

describe('GLTFParser', () => {
    it('create', () => {
        const parser = new GLTFParser;
        parser.isGLTFParser.should.be.true();
        parser.className.should.equal('GLTFParser');
    });

    it('register & unregister ExtensionHandler', () => {
        const parser = new GLTFParser;
        should(parser.getExtensionHandler('hello')).be.undefined();

        GLTFParser.registerExtensionHandler('hello', {
            parse() {

            }
        });
        should(parser.getExtensionHandler('hello')).not.be.undefined();
        should(parser.getExtensionHandler('hello2')).be.undefined();

        GLTFParser.unregisterExtensionHandler('hello');
        should(parser.getExtensionHandler('hello')).be.undefined();
    });

    it('getImageType', () => {
        const parser = new GLTFParser();
        parser.json = {
            images: [{
                mimeType: 'image/jpeg'
            }, {
                mimeType: 'image/ktx'
            }, {
                mimeType: 'image/hdr'
            }, {}, null]
        };
        parser.getImageType(0).should.equal('');
        parser.getImageType(1).should.equal('ktx');
        parser.getImageType(2).should.equal('');
        parser.getImageType(3).should.equal('');
        parser.getImageType(4).should.equal('');
    });
});