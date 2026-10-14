/** GLSL building blocks shared by every orb material. All colours are linear HDR (values > 1 feed the bloom). */

export const COMMON_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uEmission;
uniform float uSaturation;
uniform vec3 uAccent;
uniform float uAccentMix;
uniform float uFlowSpeed;
uniform float uFlowDensity;
uniform float uRadialOffset;
uniform float uShellActivity;
uniform float uAlign;
uniform float uFracture;
uniform float uImpulse;
uniform float uReveal;
uniform float uConverge;
uniform float uAudio;
uniform float uBackFade;
`;

export const COMMON_FUNCS = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

// Linear-space equivalents of #ff8a1a (orange), #ffb52e (amber-gold) and #fff2ba (white-gold hotspots).
const vec3 ORB_ORANGE = vec3(1.0, 0.25, 0.01);
const vec3 ORB_GOLD = vec3(1.0, 0.46, 0.03);
const vec3 ORB_HOT = vec3(1.0, 0.8, 0.36);

// Warm palette: orange -> gold by seed, white-hot highlights by 'hot'.
vec3 orbPalette(float seed, float hot) {
  float g = pow(hash11(seed * 31.7 + 2.0), 1.1);
  vec3 col = mix(ORB_ORANGE, ORB_GOLD, g);
  return mix(col, ORB_HOT, clamp(hot, 0.0, 1.0));
}

// Offline/paused: bronze desaturation instead of grey.
vec3 applySaturation(vec3 col) {
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 bronze = vec3(0.62, 0.40, 0.22) * l * 1.35;
  return mix(bronze, col, uSaturation);
}

// Status accent only recolours a seeded subset of strokes; the base stays gold.
vec3 applyAccent(vec3 col, float seed) {
  float pick = step(hash11(seed * 17.3 + 5.0), 0.38);
  return mix(col, uAccent * (0.8 + 0.5 * dot(col, vec3(0.33))), pick * min(1.0, uAccentMix * 2.3));
}

// 1 on the camera-facing side of the orb, uBackFade on the far side.
float depthFade(float viewZ, float centerZ) {
  float d = clamp(0.5 + 0.5 * (viewZ - centerZ) / 2.3, 0.0, 1.0);
  return mix(uBackFade, 1.0, smoothstep(0.05, 0.95, d));
}

// Far side reads slightly redder/dimmer, which adds depth without a second pass.
vec3 depthTint(vec3 col, float fade) {
  float k = smoothstep(uBackFade, 1.0, fade);
  return col * mix(vec3(1.0, 0.72, 0.5), vec3(1.0), k);
}

float revealVisibility(float r, float start) {
  float k = clamp((uReveal - start) / max(1.0 - start, 1e-3), 0.0, 1.0);
  float edge = k * 3.6;
  return smoothstep(edge, edge - 0.6, r) * step(0.001, k);
}

// Keeps a calmer aperture around the core so the reactor stays readable; the rim carries the density.
float aperture(vec2 relXY) {
  float r = length(relXY) / 1.75;
  return mix(0.2, 1.0, smoothstep(0.08, 0.78, r));
}

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}
`;
