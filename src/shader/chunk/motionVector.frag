#ifdef HILO_MOTION_VECTOR_PASS
    #include "../method/portableCoordinates.glsl"

    in vec4 v_currentClipPosition;
    in vec4 v_previousClipPosition;
    flat in float v_motionHistoryValid;

    vec2 hiloMotionVector() {
        if (
            v_motionHistoryValid < 0.5 ||
            abs(v_currentClipPosition.w) < 1e-6 ||
            abs(v_previousClipPosition.w) < 1e-6
        ) {
            return vec2(0.0);
        }
        vec2 currentUV = hiloRenderTargetUV(
            v_currentClipPosition.xy / v_currentClipPosition.w * 0.5 + 0.5
        );
        vec2 previousUV = hiloRenderTargetUV(
            v_previousClipPosition.xy / v_previousClipPosition.w * 0.5 + 0.5
        );
        return currentUV - previousUV;
    }
#endif
