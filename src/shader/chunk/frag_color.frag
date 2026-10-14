#ifdef HILO_IGNORE_TRANSPARENT
color.a = 1.0;
#endif

#include "./fog_main.frag"

#ifdef HILO_PREMULTIPLY_ALPHA
    color.rgb *= color.a;
#endif

#if defined(HILO_MATERIAL_ROLE_WEIGHTED_ACCUMULATION)
    // Bounded alpha weighting is independent of native/reversed/logarithmic depth. The shared
    // opaque depth attachment provides visibility; no backend coordinate convention enters OIT.
    float oitAlpha = clamp(color.a, 0.0, 1.0);
    float oitWeight = max(0.01, oitAlpha * oitAlpha * oitAlpha);
    // IEEE exponent inspection is portable through Naga; NaN/Inf and out-of-domain source
    // radiance use a negative high-alpha diagnostic marker, impossible for valid weighted alpha.
    if (any(equal(floatBitsToUint(color) & uvec4(0x7f800000u), uvec4(0x7f800000u))) ||
        any(greaterThan(abs(color.rgb), vec3(65504.0)))) {
        hilo_FragColor = vec4(0.0);
        hilo_WeightedMiddle = vec4(0.0);
        hilo_WeightedHigh = vec4(0.0, 0.0, 0.0, -1.0);
    } else {
        // A common factor improves small-value precision and cancels exactly in RGB/alpha resolve.
        vec4 weighted = vec4(color.rgb * oitAlpha, oitAlpha) * (oitWeight * u_weightedTransparency.w);
        float segmentLimit = u_weightedTransparency.x;
        hilo_FragColor = clamp(weighted, vec4(-segmentLimit), vec4(segmentLimit));
        vec4 remainder = weighted - hilo_FragColor;
        float middleRange = segmentLimit / u_weightedTransparency.y;
        vec4 middle = clamp(remainder, vec4(-middleRange), vec4(middleRange));
        hilo_WeightedMiddle = middle * u_weightedTransparency.y;
        hilo_WeightedHigh = (remainder - middle) * u_weightedTransparency.z;
    }
#elif defined(HILO_MATERIAL_ROLE_WEIGHTED_REVEALAGE)
    float revealAlpha = clamp(color.a, 0.0, 1.0);
    float opticalDepth;
    if (revealAlpha >= 1.0) {
        opticalDepth = 24.0;
    } else if (revealAlpha < 0.01) {
        // -log1p(-a) without the float32 cancellation in 1-a for very small opacity.
        opticalDepth = revealAlpha * (1.0 + revealAlpha * (0.5 + revealAlpha *
            (1.0 / 3.0 + revealAlpha * 0.25)));
    } else {
        opticalDepth = -log(1.0 - revealAlpha);
    }
    hilo_FragColor = vec4(opticalDepth);
#else
    hilo_FragColor = color;
#endif
