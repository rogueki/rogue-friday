import { COMMON_FUNCS, COMMON_UNIFORMS } from "./common";

/**
 * Screen-space line material. One instance = one segment (iA, iB); the quad corner (side, end) sits in position.xy.
 * Roles (compile-time defines) specialise the same code: MID, OUTER, REACTOR, RING, TELEMETRY, PROGRESS, BARS, ARCS,
 * FRACTURE, OVERLAY, SCAN.
 */
export const lineVertexShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
attribute vec3 iA;
attribute vec3 iB;
attribute vec2 iT;
attribute vec2 iMeta;

uniform float uWidth;
uniform float uOpacity;
uniform float uBase;
uniform float uRevealStart;
uniform float uFlowAmount;
uniform vec3 uTint;
uniform float uTintMix;
uniform float uLevel;
uniform float uProgress;
uniform float uProgressMode;
uniform float uGap;
uniform float uHaloCyan;
uniform float uHaloFreeze;

varying vec3 vColor;
varying float vAlpha;
varying float vDist;
varying float vHalf;

void main() {
  float side = position.x;
  float endK = position.y;
  float seed = iMeta.x;
  float kind = iMeta.y;
  float h1 = hash11(seed * 13.37 + 1.0);
  float h2 = hash11(seed * 7.77 + 3.0);
  float h3 = hash11(seed * 5.13 + 9.0);

  vec3 pA = iA;
  vec3 pB = iB;
  vec3 mid = 0.5 * (pA + pB);
  float rmid = length(mid);
  vec3 radial = mid / max(rmid, 1e-3);

  #ifdef ROLE_BARS
    // Audio bars: length follows the smoothed level with a per-bar pseudo spectrum (no jitter, only seeded shape).
    float bin = iT.x;
    float spectrum = 0.35 + 0.65 * abs(sin(bin * 23.0 + seed * 6.0) * cos(bin * 7.0 - uTime * 0.35 * (1.0 - uHaloFreeze)));
    float lvl = uLevel * (0.2 + 0.8 * spectrum) * (0.55 + 0.9 * uAudio);
    float breathe = 0.12 + 0.05 * sin(uTime * 0.8 + seed * 20.0) * (1.0 - uHaloFreeze);
    // Bar length: ~0.05 at silence, ~0.22 at full level (orb units); the base geometry is 0.42 long.
    float lenScale = clamp(0.12 + breathe * 0.25 + lvl * 0.4, 0.1, 0.55);
    pB = pA + (iB - iA) * lenScale;
  #endif

  vec3 d = vec3(0.0);
  #if defined(ROLE_OUTER) || defined(ROLE_MID)
    #ifdef ROLE_OUTER
      float pushK = 1.0;
    #else
      float pushK = 0.22;
    #endif
    d += radial * uRadialOffset * pushK * (0.25 + h1 * 1.2);
    d += radial * sin(uTime * (0.35 + h2 * 0.9) + seed * 40.0) * 0.02 * uShellActivity * pushK;
  #endif
  #ifdef ROLE_FRACTURE
    vec3 tang = normalize(cross(radial, vec3(0.0, 0.0, 1.0)) + vec3(1e-4));
    float fr = uFracture + uImpulse * 0.9;
    d += radial * (h1 - 0.35) * 0.3 * fr + tang * (h2 - 0.5) * 0.26 * fr;
  #endif
  pA += d;
  pB += d;

  vec4 mvA = modelViewMatrix * vec4(pA, 1.0);
  vec4 mvB = modelViewMatrix * vec4(pB, 1.0);
  float centerZ = modelViewMatrix[3].z;
  #if defined(ROLE_OUTER) || defined(ROLE_MID)
    float flatK = uAlign * 0.32;
    mvA.z = mix(mvA.z, centerZ, flatK);
    mvB.z = mix(mvB.z, centerZ, flatK);
  #endif
  vec4 cA = projectionMatrix * mvA;
  vec4 cB = projectionMatrix * mvB;
  vec2 sA = cA.xy / cA.w * 0.5 * uViewport;
  vec2 sB = cB.xy / cB.w * 0.5 * uViewport;
  vec2 dir = sB - sA;
  float len = length(dir);
  dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);

  float wPx = uWidth * (0.8 + 0.5 * h3) * uPixelRatio;
  float hw = wPx * 0.5;
  float pad = 0.9;
  vec4 c = mix(cA, cB, endK);
  vec4 mv = mix(mvA, mvB, endK);
  vec2 off = nrm * side * (hw + pad) + dir * (endK * 2.0 - 1.0) * (hw * 0.7 + pad * 0.5);
  c.xy += off / (0.5 * uViewport) * c.w;
  gl_Position = c;
  vDist = side * (hw + pad);
  vHalf = hw;

  float t = mix(iT.x, iT.y, endK);
  float fade = depthFade(mv.z, centerZ);

  float twinkle = 0.8 + 0.2 * sin(uTime * (0.7 + h2 * 2.4) + seed * 50.0);
  float bright = 0.2 + 0.8 * h3 * h3 * h3 + 0.12;
  float hot = smoothstep(0.935, 0.985, h2);

  float flow = 0.0;
  #if defined(ROLE_MID) || defined(ROLE_OUTER) || defined(ROLE_REACTOR)
    float act = step(h1, uFlowDensity);
    float head = fract(uTime * uFlowSpeed * (0.45 + h2 * 1.3) + h3 * 9.0);
    float behind = fract(head - t);
    flow = act * (behind < 0.3 ? pow(1.0 - behind / 0.3, 2.2) : 0.0) * uFlowAmount;
  #endif

  float intensity = (bright + hot * 1.1) * twinkle + flow * 1.7;
  float vis = 1.0;
  #if defined(ROLE_MID) || defined(ROLE_OUTER)
    vis *= aperture(mv.xy - modelViewMatrix[3].xy);
    intensity *= 0.55 + 1.15 * smoothstep(0.35, 0.8, kind);
  #endif

  #ifdef ROLE_TELEMETRY
    float g0 = abs(fract(t - 0.07 + 0.5) - 0.5);
    float g1 = abs(fract(t - 0.31 + 0.5) - 0.5);
    float g2 = abs(fract(t - 0.58 + 0.5) - 0.5);
    float g3 = abs(fract(t - 0.83 + 0.5) - 0.5);
    float gapD = min(min(g0, g1), min(g2, g3));
    vis *= smoothstep(uGap * 0.5, uGap * 0.5 + 0.012, gapD);
    intensity = 0.55 + 0.45 * bright + 0.5 * kind * smoothstep(0.7, 0.9, kind);
  #endif
  #ifdef ROLE_PROGRESS
    float track = 0.12;
    float lit = 0.0;
    if (uProgressMode < 1.5) {
      lit = t <= uProgress ? 1.0 : 0.0;
      float headGlow = exp(-pow((t - uProgress) * 70.0, 2.0));
      lit = max(lit * 0.85, headGlow * 1.8) * step(0.002, uProgress + 0.0);
    } else {
      float headC = fract(uTime * 0.32);
      float behindC = fract(headC - t);
      lit = behindC < 0.34 ? pow(1.0 - behindC / 0.34, 1.6) * 1.6 : 0.0;
    }
    intensity = mix(track, 1.0, clamp(lit, 0.0, 1.0)) + lit * 0.9;
    vis *= step(0.5, uProgressMode);
  #endif
  #ifdef ROLE_BARS
    intensity = 0.55 + 0.6 * lenScale + uLevel * 0.35;
    vis *= smoothstep(0.0, 0.05, uLevel + 0.001);
  #endif
  #ifdef ROLE_ARCS
    float dirT = mix(t, 1.0 - t, uConverge);
    float headA = fract(uTime * (0.25 + h2 * 0.35) + h3 * 5.0);
    float behindA = fract(headA - dirT);
    float pulse = behindA < 0.45 ? pow(1.0 - behindA / 0.45, 1.8) : 0.0;
    intensity = 0.1 + pulse * 2.2;
    vis *= smoothstep(0.0, 0.08, uLevel);
  #endif
  #ifdef ROLE_SCAN
    intensity = 0.9 + 0.5 * h3;
  #endif
  #ifdef ROLE_OVERLAY
    intensity = 0.6 + 0.8 * bright;
  #endif
  #ifdef ROLE_FRACTURE
    intensity = 0.7 + 0.9 * bright + uImpulse * 1.4;
  #endif

  vec3 col = orbPalette(seed, hot + flow * 0.5);
  col = applySaturation(col);
  col = applyAccent(col, seed);
  col = mix(col, uTint, uTintMix);
  #ifdef ROLE_BARS
    vec3 cyan = vec3(0.12, 0.62, 0.82);
    vec3 goldW = mix(ORB_GOLD, ORB_HOT, 0.35 + 0.3 * uLevel);
    col = mix(goldW, cyan, uHaloCyan);
    col = applySaturation(col);
  #endif
  col = depthTint(col, fade);
  col *= 1.0 + hot * 0.4 + flow * 0.5;

  float rv = revealVisibility(rmid, uRevealStart);
  vAlpha = clamp(intensity * uBase * fade * rv * vis * uOpacity * uEmission, 0.0, 1.0);
  vColor = col;
  // thin strokes lose energy instead of aliasing: scale by (width / 1.3px)
  vAlpha *= clamp(wPx / 1.3, 0.35, 1.0);
}
`;

export const lineFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vDist;
varying float vHalf;

void main() {
  float cov = clamp(vHalf + 0.5 - abs(vDist), 0.0, 1.0);
  float a = vAlpha * cov;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;
