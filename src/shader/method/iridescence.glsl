const mat3 HILO_XYZ_TO_REC709 = mat3(
    3.2404542, -0.9692660, 0.0556434,
    -1.5371385, 1.8760108, -0.2040259,
    -0.4985314, 0.0415560, 1.0572252
);

float hiloThinFilmSquare(float value) {
    return value * value;
}

vec3 hiloThinFilmFresnel0ToIor(vec3 fresnel0) {
    vec3 sqrtF0 = sqrt(clamp(fresnel0, vec3(0.0), vec3(0.9999)));
    return (vec3(1.0) + sqrtF0) / max(vec3(1.0) - sqrtF0, vec3(1e-4));
}

vec3 hiloThinFilmIorToFresnel0(vec3 transmittedIor, float incidentIor) {
    vec3 incident = vec3(incidentIor);
    vec3 ratio = (transmittedIor - incident) /
        max(transmittedIor + incident, vec3(1e-4));
    return ratio * ratio;
}

float hiloThinFilmIorToFresnel0Scalar(float transmittedIor, float incidentIor) {
    float ratio = (transmittedIor - incidentIor) /
        max(transmittedIor + incidentIor, 1e-4);
    return ratio * ratio;
}

float hiloThinFilmSchlick(float f0, float cosTheta) {
    float oneMinusCos = clamp(1.0 - cosTheta, 0.0, 1.0);
    float oneMinusCos2 = oneMinusCos * oneMinusCos;
    return f0 + (1.0 - f0) * oneMinusCos * oneMinusCos2 * oneMinusCos2;
}

vec3 hiloThinFilmSchlick3(vec3 f0, float cosTheta) {
    float oneMinusCos = clamp(1.0 - cosTheta, 0.0, 1.0);
    float oneMinusCos2 = oneMinusCos * oneMinusCos;
    return f0 + (vec3(1.0) - f0) *
        oneMinusCos * oneMinusCos2 * oneMinusCos2;
}

vec3 hiloEvaluateSpectralSensitivity(float opticalPathDifference, vec3 shift) {
    float phase = 2.0 * HILO_PI * opticalPathDifference * 1.0e-9;
    vec3 amplitude = vec3(5.4856e-13, 4.4201e-13, 5.2481e-13);
    vec3 frequency = vec3(1.6810e+06, 1.7953e+06, 2.2084e+06);
    vec3 variance = vec3(4.3278e+09, 9.3046e+09, 6.6121e+09);
    vec3 xyz = amplitude * sqrt(2.0 * HILO_PI * variance) *
        cos(frequency * phase + shift) *
        exp(-phase * phase * variance);
    xyz.r += 9.7470e-14 * sqrt(2.0 * HILO_PI * 4.5282e+09) *
        cos(2.2399e+06 * phase + shift.r) *
        exp(-4.5282e+09 * phase * phase);
    xyz /= 1.0685e-7;
    return HILO_XYZ_TO_REC709 * xyz;
}

vec3 hiloEvaluateIridescence(
    float outsideIor,
    float filmIor,
    float cosTheta1,
    float thickness,
    vec3 baseF0
) {
    float effectiveFilmIor = mix(
        outsideIor,
        filmIor,
        smoothstep(0.0, 0.03, thickness)
    );
    float iorRatio = outsideIor / max(effectiveFilmIor, 1e-4);
    float sinTheta2Squared = hiloThinFilmSquare(iorRatio) *
        (1.0 - hiloThinFilmSquare(cosTheta1));
    float cosTheta2Squared = 1.0 - sinTheta2Squared;
    if (cosTheta2Squared < 0.0) return vec3(1.0);
    float cosTheta2 = sqrt(cosTheta2Squared);

    float interfaceF0 = hiloThinFilmIorToFresnel0Scalar(effectiveFilmIor, outsideIor);
    float reflectance12 = hiloThinFilmSchlick(interfaceF0, cosTheta1);
    float transmittance121 = 1.0 - reflectance12;
    float phase12 = effectiveFilmIor < outsideIor ? HILO_PI : 0.0;
    float phase21 = HILO_PI - phase12;

    vec3 baseIor = hiloThinFilmFresnel0ToIor(baseF0);
    vec3 interfaceBaseF0 = hiloThinFilmIorToFresnel0(baseIor, effectiveFilmIor);
    vec3 reflectance23 = hiloThinFilmSchlick3(interfaceBaseF0, cosTheta2);
    vec3 phase23 = vec3(
        baseIor.r < effectiveFilmIor ? HILO_PI : 0.0,
        baseIor.g < effectiveFilmIor ? HILO_PI : 0.0,
        baseIor.b < effectiveFilmIor ? HILO_PI : 0.0
    );

    float opticalPathDifference =
        2.0 * effectiveFilmIor * thickness * cosTheta2;
    vec3 phaseShift = vec3(phase21) + phase23;
    vec3 compoundReflectance = clamp(
        reflectance12 * reflectance23,
        vec3(1e-5),
        vec3(0.9999)
    );
    vec3 compoundAmplitude = sqrt(compoundReflectance);
    vec3 reflectedSeries = hiloThinFilmSquare(transmittance121) * reflectance23 /
        max(vec3(1.0) - compoundReflectance, vec3(1e-4));
    vec3 result = vec3(reflectance12) + reflectedSeries;
    vec3 seriesCoefficient = reflectedSeries - vec3(transmittance121);
    for (int order = 1; order <= 2; order++) {
        seriesCoefficient *= compoundAmplitude;
        vec3 sensitivity = 2.0 * hiloEvaluateSpectralSensitivity(
            float(order) * opticalPathDifference,
            float(order) * phaseShift
        );
        result += seriesCoefficient * sensitivity;
    }
    return max(result, vec3(0.0));
}
