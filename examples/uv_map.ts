// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

const texMesh = new Hilo3d.Mesh({
            geometry: new Hilo3d.PlaneGeometry(),
            material: new Hilo3d.ShaderMaterial({
                vs: `
                    attribute vec3 a_position;
                    attribute vec2 a_texcoord0;
                    varying vec2 v_uv;
                    void main(void) {
                        v_uv = a_texcoord0;
                        gl_Position = vec4(a_position * 2.0, 1.0);
                    }`,
                fs: `
                    ${Hilo3d.Shader.shaders['chunk/precision.frag']}
                    uniform sampler2D u_diffuse;
                    varying vec2 v_uv;
                    void main(void) {
                        gl_FragColor = texture2D(u_diffuse, v_uv);
                        // gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
                    }`,
                uniforms: {
                    u_diffuse: 'DIFFUSE'
                }
            })
        });

        const uvMaterial = new Hilo3d.ShaderMaterial({
            wireframe: true,
            vs: `
                attribute vec2 a_texcoord0;
                varying vec2 v_uv;
                void main(void) {
                    v_uv = a_texcoord0;
                    gl_Position = vec4(a_texcoord0 * 2.0 - 1.0, 0.0, 1.0);
                }`,
            fs: `
                ${Hilo3d.Shader.shaders['chunk/precision.frag']}
                varying vec2 v_uv;
                void main(void) {
                    gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0);
                }`
        });
        const loader = new Hilo3d.GLTFLoader();
        loader.load({
            src: './models/Tmall/Tmall.gltf',
        }).then(function(model) {
            const m = model.meshes[0];
            texMesh.material.diffuse = m.material.diffuse || m.material.baseColorMap;
            m.material = uvMaterial;

            stage.addChild(texMesh);
            stage.addChild(m);
        });
