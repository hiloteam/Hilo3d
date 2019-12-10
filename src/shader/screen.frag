#pragma glslify: import('./chunk/extensions.frag');
#pragma glslify: import('./chunk/baseDefine.glsl');
#pragma glslify: import('./chunk/precision.frag');

varying vec2 v_texcoord0;
uniform sampler2D u_diffuse;

void main(void) {  
    gl_FragColor = texture2D(u_diffuse, v_texcoord0);
}