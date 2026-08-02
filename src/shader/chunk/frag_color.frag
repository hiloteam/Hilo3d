#ifdef HILO_IGNORE_TRANSPARENT
color.a = 1.0;
#endif

#include "./fog_main.frag"

#ifdef HILO_PREMULTIPLY_ALPHA
    color.rgb *= color.a;
#endif

hilo_FragColor = color;
