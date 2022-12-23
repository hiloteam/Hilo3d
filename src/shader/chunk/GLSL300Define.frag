#version 300 es
#define HILO_IS_WEBGL2
#define varying in
#define texture2D texture
#define textureCube texture
#define texture2DLodEXT textureLod
#define textureCubeLodEXT textureLod
#define gl_FragColor hilo_FragData0
#define gl_FragDepthEXT gl_FragDepth
layout(location = 0) out highp vec4 hilo_FragData0;