#ifdef HILO_MOTION_VECTOR_PASS
    #include "../method/portableCoordinates.glsl"

    in vec4 v_currentClipPosition;
    in vec4 v_previousClipPosition;
    in float v_currentViewDepth;
    in float v_previousViewDepth;
    flat in float v_motionHistoryValid;

    #ifdef HILO_TEMPORAL_REACTIVE_MASK
        layout(location = 1) out highp float hilo_ReactiveMask;
    #endif

    vec4 hiloMotionData() {
        float currentLogDepth = log2(1.0 + max(v_currentViewDepth, 0.0));
        if (
            v_motionHistoryValid < 0.5 ||
            v_currentClipPosition.w <= 1e-6 ||
            v_previousClipPosition.w <= 1e-6
        ) {
            return vec4(0.0, 0.0, -1.0, currentLogDepth);
        }
        vec2 currentUV = hiloRenderTargetUV(
            v_currentClipPosition.xy / v_currentClipPosition.w * 0.5 + 0.5
        );
        vec2 previousUV = hiloRenderTargetUV(
            v_previousClipPosition.xy / v_previousClipPosition.w * 0.5 + 0.5
        );
        return vec4(
            currentUV - previousUV,
            log2(1.0 + max(v_previousViewDepth, 0.0)),
            currentLogDepth
        );
    }

    void hiloWriteTemporalReactiveMask() {
        #ifdef HILO_TEMPORAL_REACTIVE_MASK
            #ifdef HILO_TEMPORAL_FORCE_REACTIVE
                hilo_ReactiveMask = 1.0;
            #else
                hilo_ReactiveMask = clamp(u_temporalReactiveFactor, 0.0, 1.0);
            #endif
        #endif
    }
#endif
