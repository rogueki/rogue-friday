import { COMMON_FRAG_FUNCS, COMMON_FUNCS, COMMON_UNIFORMS } from "./common";
/**
 * VoiceReactionGroup + attention rings on one camera-facing billboard (local coordinates in orb units via `uHalf`).
 * Compile-time modes: INPUT (microphone wave ring that opens from the core), OUTPUT (TTS wave ring + outgoing waves),
 * RADIAL (expanding pulse rings triggered by audio peaks), FOCUS (slow amber focus ring while waiting for approval),
 * WARN (very slow amber pulse while operation is degraded).
 */
export const voiceFragmentShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
${COMMON_FRAG_FUNCS}
uniform float uHalf;
uniform float uOpen;
uniform float uLevel;
uniform vec4 uWaveBands;
uniform float uAmt;
uniform float uPulseAge[6];
uniform float uPulseAmp[6];
varying vec2 vP;

const float PI = 3.14159265;

float ringLine(float d, float w) {
  return exp(-d * d / (w * w));
}

void main() {
  vec2 p = vP * uHalf;
  float r = length(p);
  float th = atan(p.y, p.x);
  float intensity = 0.0;
  vec3 col = ORB_HOT;

  #if defined(MODE_INPUT) || defined(MODE_OUTPUT)
    float open = smoothstep(0.0, 1.0, uOpen);
    float amp = (0.025 + 0.13 * uLevel) * (1.0 - 0.45 * uCalm);
    float wave = uWaveBands.x * sin(th * 3.0 + uTime * 1.4)
               + uWaveBands.y * 0.75 * sin(th * 8.0 - uTime * 2.3 + 1.7)
               + uWaveBands.z * 0.55 * sin(th * 17.0 + uTime * 3.7 + 0.6);
    #ifdef MODE_INPUT
      float R0 = mix(0.32, 2.02, open);
    #else
      float R0 = 1.92 + 0.22 * uLevel;
    #endif
    float R = R0 + wave * amp;
    float w = 0.0085 + 0.007 * uLevel;
    // the ring is built from fine arcs; each cell shimmers slowly on its own
    float cell = floor((th + PI) / (2.0 * PI) * 120.0);
    float seg = 0.5 + 0.5 * hash11(cell * 1.7 + floor(uTime * 0.6 + cell * 0.13));
    float line = ringLine(r - R, w) * seg;
    float echo = ringLine(r - (R * 0.9 + wave * amp * 0.4), w * 2.0) * 0.3 + ringLine(r - R * 1.045, w * 1.4) * 0.22;
    intensity = (line * 0.95 + echo * 0.8) * open * (0.3 + 1.3 * uLevel);
    #ifdef MODE_OUTPUT
      // waves leave the core and travel outwards; low band makes them heavier
      for (int k = 0; k < 3; k++) {
        float ph = fract(uTime * 0.42 + float(k) / 3.0);
        float rr = mix(0.26, 2.2, ph);
        intensity += ringLine(r - rr, 0.014 + 0.022 * ph) * pow(1.0 - ph, 1.4) * (0.12 + 0.9 * uLevel + 0.4 * uWaveBands.x) * open;
      }
      col = mix(ORB_GOLD * 1.25, ORB_HOT, 0.55);
    #else
      col = mix(ORB_HOT, vec3(0.45, 0.95, 1.0), 0.2);
    #endif
  #endif

  #ifdef MODE_RADIAL
    for (int i = 0; i < 6; i++) {
      float age = uPulseAge[i];
      if (age >= 0.0) {
        float rr = mix(0.2, 2.35, 1.0 - (1.0 - age) * (1.0 - age));
        intensity += ringLine(r - rr, 0.02 + 0.05 * age) * pow(1.0 - age, 1.3) * uPulseAmp[i] * 1.6;
      }
    }
    col = mix(ORB_GOLD * 1.2, ORB_HOT, 0.6);
  #endif

  #ifdef MODE_FOCUS
    float ph1 = fract(uTime * 0.3);
    float ph2 = fract(uTime * 0.3 + 0.5);
    intensity += ringLine(r - mix(0.5, 2.3, ph1), 0.026 + 0.03 * ph1) * pow(1.0 - ph1, 1.2) * uAmt * 0.6;
    intensity += ringLine(r - mix(0.5, 2.3, ph2), 0.026 + 0.03 * ph2) * pow(1.0 - ph2, 1.2) * uAmt * 0.3;
    col = vec3(1.0, 0.62, 0.05) * 1.2;
  #endif

  #ifdef MODE_WARN
    float ph = fract(uTime * 0.19 + 0.1);
    intensity += ringLine(r - mix(0.4, 2.45, ph), 0.05 + 0.06 * ph) * pow(1.0 - ph, 1.5) * uAmt * 0.65;
    col = vec3(1.0, 0.42, 0.05) * 1.15;
  #endif

  float a = clamp(intensity * uEmission * edgeFadeFrag(), 0.0, 1.0);
  if (a < 0.003) discard;
  col = applySaturation(col);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/**
 * ScanGroup billboard. Compile-time modes: RADIAL (rotating wedge + leading edge, transcribing), ANALYSIS (contracting
 * arc rings and two narrow counter-rotating sweeps, thinking), SYNC (two counter-rotating comet rings, syncing).
 */
export const sweepFragmentShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
${COMMON_FRAG_FUNCS}
uniform float uHalf;
uniform float uAmt;
varying vec2 vP;

const float PI = 3.14159265;
const float TAU = 6.2831853;

float ringLine(float d, float w) {
  return exp(-d * d / (w * w));
}

float wedge(float th, float head, float len) {
  float d = mod(head - th, TAU);
  return d < len ? pow(1.0 - d / len, 2.2) : 0.0;
}

void main() {
  vec2 p = vP * uHalf;
  float r = length(p);
  float th = atan(p.y, p.x);
  float intensity = 0.0;
  vec3 col = ORB_HOT;

  #ifdef MODE_RADIAL
    float head = -uTime * 1.5;
    float d = mod(th - head, TAU);
    float tail = d < 1.2 ? pow(1.0 - d / 1.2, 2.2) : 0.0;
    float edge = exp(-d * d / 0.0016);
    float mask = smoothstep(0.22, 0.38, r) * (1.0 - smoothstep(1.85, 2.12, r));
    intensity = (tail * 0.26 + edge * 0.85) * mask * uAmt;
    col = mix(ORB_GOLD * 1.2, vec3(0.45, 0.95, 1.0), 0.4);
  #endif

  #ifdef MODE_ANALYSIS
    for (int k = 0; k < 3; k++) {
      float ph = fract(uTime * 0.27 + float(k) / 3.0);
      float rr = mix(1.95, 0.34, pow(ph, 1.15));
      float gate = smoothstep(0.25, 0.55, fract(th / TAU * 6.0 + uTime * 0.12 * (float(k) + 1.0) + float(k) * 0.37));
      intensity += ringLine(r - rr, 0.02 + 0.015 * (1.0 - ph)) * sin(PI * ph) * gate * 1.1;
    }
    float s1 = wedge(th, uTime * 1.1, 0.5);
    float s2 = wedge(th, PI - uTime * 0.8, 0.5);
    float band = smoothstep(0.35, 0.5, r) * (1.0 - smoothstep(1.6, 1.85, r));
    intensity += (s1 + s2) * band * 0.38;
    intensity *= uAmt;
    col = mix(ORB_GOLD * 1.15, vec3(0.62, 0.42, 1.0), 0.28);
  #endif

  #ifdef MODE_SYNC
    float a1 = wedge(th, -uTime * 0.9, 2.2);
    float a2 = wedge(th, uTime * 0.7 + 1.0, 2.2);
    float dash1 = 0.45 + 0.55 * step(0.35, fract(th / TAU * 28.0));
    float dash2 = 0.45 + 0.55 * step(0.35, fract(th / TAU * 36.0 + 0.2));
    intensity += ringLine(r - 1.62, 0.016) * (0.16 + a1 * 1.2) * dash1;
    intensity += ringLine(r - 1.94, 0.016) * (0.16 + a2 * 1.2) * dash2;
    intensity *= uAmt;
    col = mix(ORB_GOLD * 1.15, vec3(0.45, 0.95, 1.0), 0.3);
  #endif

  float a = clamp(intensity * uEmission * edgeFadeFrag(), 0.0, 1.0);
  if (a < 0.003) discard;
  col = applySaturation(col);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/** Core energy noise: turbulence inside the core, swirling inwards while thinking, driven by the core audio drive. */
export const coreNoiseFragmentShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
uniform float uNoise;
uniform float uCoreLevel;
uniform float uDrive;
uniform float uSwirl;
varying vec2 vP;

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash11(i.x * 57.0 + i.y * 131.0);
  float b = hash11((i.x + 1.0) * 57.0 + i.y * 131.0);
  float c = hash11(i.x * 57.0 + (i.y + 1.0) * 131.0);
  float d = hash11((i.x + 1.0) * 57.0 + (i.y + 1.0) * 131.0);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = rot2(0.7) * p * 2.03;
    a *= 0.5;
  }
  return s;
}

void main() {
  float r = length(vP);
  vec2 q = vP * 3.4;
  float spin = uTime * (0.22 + 0.55 * uSwirl) + r * (1.4 + 2.6 * uSwirl);
  q = rot2(spin) * q;
  vec2 inward = r > 1e-3 ? normalize(vP) * uTime * 0.7 * uSwirl : vec2(0.0);
  float n = fbm(q + vec2(uTime * 0.16, -uTime * 0.11) - inward);
  float mask = exp(-r * r * 5.0) * (1.0 - smoothstep(0.65, 1.0, r));
  float k = mask * (0.2 + 0.8 * n) * uNoise * (0.4 + 0.6 * uCoreLevel + uDrive * 0.8);
  vec3 col = mix(ORB_GOLD * 1.3, ORB_HOT * 1.4, smoothstep(0.35, 0.85, n));
  col = applySaturation(col);
  float a = clamp(k * 0.6 * uEmission, 0.0, 0.8);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
