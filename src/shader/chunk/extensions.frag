layout(location = 0) out highp vec4 hilo_FragColor;
#ifdef HILO_MATERIAL_ROLE_WEIGHTED_ACCUMULATION
layout(location = 1) out highp vec4 hilo_WeightedMiddle;
layout(location = 2) out highp vec4 hilo_WeightedHigh;
layout(std140) uniform WeightedTransparencyBlock { highp vec4 u_weightedTransparency; };
#endif
