#ifdef GL_ES
precision highp float;
#endif
uniform sampler2D u_diffuse;
// uniform vec4 u_diffuse;
varying vec2 v_uv;
void main(void) {
    gl_FragColor = texture2D(u_diffuse, v_uv);
    // gl_FragColor = u_diffuse;
}