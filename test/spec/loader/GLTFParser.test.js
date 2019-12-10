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
            parse(){

            }
        });
        should(parser.getExtensionHandler('hello')).not.be.undefined();
        should(parser.getExtensionHandler('hello2')).be.undefined();
        
        GLTFParser.unregisterExtensionHandler('hello');
        should(parser.getExtensionHandler('hello')).be.undefined();
    });
});