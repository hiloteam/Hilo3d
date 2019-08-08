(function(){
    var postProcess = {
        passes: [],
        texture: null,
        init: function(renderer, framebufferOption) {
            var that = this;
            that.renderer = renderer;
            renderer.useFramebuffer = true;
            if (renderer.isInit) {
                that._init(framebufferOption);
            } else {
                renderer.on('init', function() {
                    that._init(framebufferOption);
                }, true);
            }
        },
        _init(framebufferOption) {
            var renderer = this.renderer;
            this.state = renderer.state;
            this.gl = renderer.gl;

            var bufferParams = {
                width: renderer.width,
                height: renderer.height
            };
            Object.assign(bufferParams, framebufferOption||{});
            this.frontBuffer = new Hilo3d.Framebuffer(renderer, bufferParams);
            this.backBuffer = new Hilo3d.Framebuffer(renderer, bufferParams);
        },
        resize(){
            if(this.frontBuffer){
                this.frontBuffer.resize(this.renderer.width, this.renderer.height);
            }

            if(this.backBuffer){
                this.backBuffer.resize(this.renderer.width, this.renderer.height);
            }
        },
        /**
         * @param {Object} params
         * @param {String} params.vert
         * @param {String} params.frag
         * @param {Object} params.uniforms
         */
        addPass(params, uid) {
            var pass = Object.assign({}, params);
            pass.id = uid||Hilo3d.math.generateUUID('pass');
            this.passes.push(pass);
            return pass;
        },
        /**
         * @param {Array} kernel
         */
        addKernelPass(kernel, uid) {
            var renderer = this.renderer;
            var frag = '\n\
                precision HILO_MAX_FRAGMENT_PRECISION float;\n\
                varying vec2 v_texcoord0;\n\
                uniform sampler2D u_diffuse;\n\
                uniform vec2 u_textureSize;\n\
                uniform float u_kernel[9];\n\
                uniform float u_kernelWeight;\n\
                void main(void) {  \n\
                    vec2 onePixel = vec2(1.0, 1.0) / u_textureSize;\n\
                    vec4 colorSum =\n\
                    texture2D(u_diffuse, v_texcoord0 + onePixel * vec2(-1, -1)) * u_kernel[0] +\n\
                    texture2D(u_diffuse, v_texcoord0 + onePixel * vec2( 0, -1)) * u_kernel[1] +\n\
                    texture2D(u_diffuse, v_texcoord0 + onePixel * vec2( 1, -1)) * u_kernel[2] +\n\
                    texture2D(u_diffuse, v_texcoord0 + onePixel * vec2(-1,  0)) * u_kernel[3] +\n\
                    texture2D(u_diffuse, v_texcoord0 + onePixel * vec2( 0,  0)) * u_kernel[4] +\n\
                    texture2D(u_diffuse, v_texcoord0 + onePixel * vec2( 1,  0)) * u_kernel[5] +\n\
                    texture2D(u_diffuse, v_texcoord0 + onePixel * vec2(-1,  1)) * u_kernel[6] +\n\
                    texture2D(u_diffuse, v_texcoord0 + onePixel * vec2( 0,  1)) * u_kernel[7] +\n\
                    texture2D(u_diffuse, v_texcoord0 + onePixel * vec2( 1,  1)) * u_kernel[8] ;\n\
                    gl_FragColor = colorSum/u_kernelWeight;\n\
                }';

            var u_textureSize = new Float32Array([0, 0]);
            var u_kernel = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);

            var uniforms = {
                u_textureSize: {
                    get: function() {
                        u_textureSize[0] = renderer.width;
                        u_textureSize[1] = renderer.height;
                        return u_textureSize;
                    }
                },
                u_kernelWeight: {
                    get: function() {
                        return Math.max(1, pass.kernel.reduce(function(prev, curr) {
                            return prev + curr;
                        }));
                    }
                },
                u_kernel: {
                    get: function() {
                        var kernel = pass.kernel;
                        for (var i = 0; i < 9; i++) {
                            u_kernel[i] = kernel[i];
                        }

                        return u_kernel;
                    }
                }
            };

            var pass = this.addPass({
                kernel: kernel,
                frag: frag,
                uniforms: uniforms
            }, uid);

            return pass;
        },
        render() {
            var that = this;
            var renderer = that.renderer;
            var state = that.state;
            var passes = that.passes;
            var lastIndex = passes.length - 1;
            var frontBuffer = this.frontBuffer;
            var backBuffer = this.backBuffer;

            if (!this._firstTexture) {
                this._firstTexture = renderer.framebuffer.texture;
            }

            if (passes.length === 1) {
                that.draw(this._firstTexture, passes[0]);
            } else {
                var texture = this._firstTexture;
                var tempBuffer;
                passes.forEach(function(pass, index) {
                    if (index === lastIndex) {
                        state.bindSystemFramebuffer()
                    } else {
                        frontBuffer.bind();
                    }

                    that.draw(texture, pass);
                    texture = frontBuffer.texture;
                    tempBuffer = frontBuffer;
                    frontBuffer = backBuffer;
                    backBuffer = tempBuffer;
                });
            }
        },
        draw: function(texture, pass) {
            var clearColor = pass.clearColor;
            var screenVert = pass.vert || Hilo3d.Shader.shaders['screen.vert'];
            var screenFrag = pass.frag || Hilo3d.Shader.shaders['screen.frag'];
            var uniforms = pass.uniforms || {};

            var state = this.state;
            var gl = this.gl;
            state.disable(Hilo3d.constants.DEPTH_TEST);
            state.disable(Hilo3d.constants.CULL_FACE);
            state.disable(Hilo3d.constants.BLEND);
            if (clearColor) {
                gl.clearColor(clearColor.r, clearColor.g, clearColor.b, clearColor.a);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }

            var shader = Hilo3d.Shader.getCustomShader(screenVert, screenFrag, '', pass.id);
            var program = Hilo3d.Program.getProgram(shader, state);
            program.useProgram();

            var vaoId = program.id;
            var vao = Hilo3d.VertexArrayObject.getVao(gl, vaoId, {
                mode: Hilo3d.constants.TRIANGLE_STRIP
            });

            var x = 0,
                y = 0,
                width = 1,
                height = 1;
            if (vao.isDirty) {
                vao.isDirty = false;
                x = x * 2 - 1;
                y = 1 - y * 2;
                width *= 2;
                height *= 2;
                var vertices = [x, y, x + width, y, x, y - height, x + width, y - height];
                vao.addAttribute(new Hilo3d.GeometryData(new Float32Array(vertices), 2), program.attributes.a_position);
                vao.addAttribute(new Hilo3d.GeometryData(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2), program.attributes.a_texcoord0);
            }

            if(!uniforms.u_diffuse){
                uniforms.u_diffuse = this.uniformTextureGetter(texture);
            }

            for (var name in uniforms) {
                var value = uniforms[name];
                var programInfo = program.uniforms[name];
                if (value && programInfo) {
                    program[name] = value.get ? value.get(null, null, programInfo) : value;
                }
            }
            vao.draw();
        },
        uniformTextureGetter(texture){
            var state = this.state;
            var gl = state.gl;
            return {
                get:function(mesh, material, programInfo){
                    if(texture.isTexture){
                        texture = texture.getGLTexture(state)
                    }
                    return Hilo3d.semantic.handlerGLTexture(Hilo3d.constants.TEXTURE_2D, texture, programInfo.textureIndex);
                }
            };
        },
        kernels: {
            normal: [
                0, 0, 0,
                0, 1, 0,
                0, 0, 0
            ],
            gaussianBlur: [
                0.045, 0.122, 0.045,
                0.122, 0.332, 0.122,
                0.045, 0.122, 0.045
            ],
            gaussianBlur2: [
                1, 2, 1,
                2, 4, 2,
                1, 2, 1
            ],
            gaussianBlur3: [
                0, 1, 0,
                1, 1, 1,
                0, 1, 0
            ],
            unsharpen: [-1, -1, -1, -1, 9, -1, -1, -1, -1],
            sharpness: [
                0, -1, 0, -1, 5, -1,
                0, -1, 0
            ],
            sharpen: [-1, -1, -1, -1, 16, -1, -1, -1, -1],
            edgeDetect: [-0.125, -0.125, -0.125, -0.125, 1, -0.125, -0.125, -0.125, -0.125],
            edgeDetect2: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
            edgeDetect3: [-5, 0, 0,
                0, 0, 0,
                0, 0, 5
            ],
            edgeDetect4: [-1, -1, -1,
                0, 0, 0,
                1, 1, 1
            ],
            edgeDetect5: [-1, -1, -1,
                2, 2, 2, -1, -1, -1
            ],
            edgeDetect6: [-5, -5, -5, -5, 39, -5, -5, -5, -5],
            sobelHorizontal: [
                1, 2, 1,
                0, 0, 0, -1, -2, -1
            ],
            sobelVertical: [
                1, 0, -1,
                2, 0, -2,
                1, 0, -1
            ],
            previtHorizontal: [
                1, 1, 1,
                0, 0, 0, -1, -1, -1
            ],
            previtVertical: [
                1, 0, -1,
                1, 0, -1,
                1, 0, -1
            ],
            boxBlur: [
                0.111, 0.111, 0.111,
                0.111, 0.111, 0.111,
                0.111, 0.111, 0.111
            ],
            triangleBlur: [
                0.0625, 0.125, 0.0625,
                0.125, 0.25, 0.125,
                0.0625, 0.125, 0.0625
            ],
            emboss: [-2, -1, 0, -1, 1, 1,
                0, 1, 2
            ]
        }
    };

    if(typeof module !== 'undefined'){
        module.exports = postProcess;
    }

    if(typeof window !== 'undefined'){
        window.postProcess = postProcess;
    }
})();