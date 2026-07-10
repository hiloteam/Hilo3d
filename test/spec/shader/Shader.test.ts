const Shader = Hilo3d.Shader;
const ShaderMaterial = Hilo3d.ShaderMaterial;

describe('Shader', () => {
    Shader.init(testEnv.renderer);

    it('create', () => {
        const shader = new Shader;
        shader.isShader.should.be.true();
        shader.className.should.equal('Shader');
    });

    it('getHeaderKey', () => {
        const {
            mesh,
            material,
            renderer,
            geometry,
            fog
        } = testEnv;
        const lightManager = renderer.lightManager;
        const key = Shader.getHeaderKey(mesh, material, lightManager, fog);
        key.should.equal(`header_${material.id}_${lightManager.lightInfo.uid}_fog_${fog.mode}_${geometry.getShaderKey()}`);
    });

    it('getHeader', () => {
        const {
            mesh,
            material,
            renderer,
            geometry,
            fog
        } = testEnv;
        const lightManager = renderer.lightManager;
        const header = Shader.getHeader(mesh, material, lightManager, fog);
        header.should.equal(`#define SHADER_NAME Material
#define HILO_LIGHT_TYPE_NONE 1
#define HILO_SIDE 1028
#define HILO_PREMULTIPLY_ALPHA 1
#define HILO_RECEIVE_SHADOWS 1
#define HILO_CAST_SHADOWS 1
#define HILO_HAS_FOG 1
#define HILO_FOG_LINEAR 1
`);
        const shaderMaterialHeader = Shader.getHeader(mesh, new ShaderMaterial({
            getCustomRenderOption(options){
                options.CUSTUM_1 = 1;
                options.CUSTUM_2 = 0;
                return options;
            }
        }), lightManager, fog);
        shaderMaterialHeader.should.equal(`#define SHADER_NAME ShaderMaterial
#define HILO_LIGHT_TYPE_NONE 1
#define HILO_SIDE 1028
#define HILO_PREMULTIPLY_ALPHA 1
#define HILO_RECEIVE_SHADOWS 1
#define HILO_CAST_SHADOWS 1
#define CUSTUM_1 1
#define CUSTUM_2 0
#define HILO_HAS_FOG 1
#define HILO_FOG_LINEAR 1
`);
    });

    it('getCustomShader', () => {
        const shader = Shader.getCustomShader('void main(){}', 'void main(){}', '#define HILO_LIGHT_TYPE_NONE 1\n');
        shader.vs.should.equal(`
#define HILO_MAX_PRECISION highp
#define HILO_MAX_VERTEX_PRECISION highp
#define HILO_MAX_FRAGMENT_PRECISION highp
#define HILO_LIGHT_TYPE_NONE 1
void main(){}`);

        shader.fs.should.equal(`
#define HILO_MAX_PRECISION highp
#define HILO_MAX_VERTEX_PRECISION highp
#define HILO_MAX_FRAGMENT_PRECISION highp
#define HILO_LIGHT_TYPE_NONE 1
void main(){}`);
    });

    it('getBasicShader', () => {
        const shader = Shader.getBasicShader(testEnv.material, false, '#define HILO_LIGHT_TYPE_NONE 1');
        shader.fs.should.be.String();
        shader.vs.should.be.String();
    });

    it('cache', () => {
        const shader = Shader.getCustomShader('', '', '', 'testCustomId');
        Shader.cache.get('testCustomId').should.equal(shader);
        Shader.reset();
        should(Shader.cache.get('testCustomId')).be.undefined();
    });
});