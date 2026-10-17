import { COMMON_FUNCS, COMMON_UNIFORMS } from "./common";

/** Data plates: instanced tangent quads; the chip graphics are drawn procedurally in the fragment shader. */
export const plateVertexShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
attribute vec3 iCenter;
attribute vec3 iU;
attribute vec3 iV;
attribute vec2 iSize;
attribute vec3 iMeta;

uniform float uRevealStart;
uniform float uOpacity;
uniform float uBase;

varying vec2 vUv;
varying vec2 vSize;
varying vec3 vMeta;
varying float vFade;
varying float vReveal;
varying float vAperture;

void main() {
  float seed = iMeta.x;
  float h1 = hash11(seed * 13.37 + 1.0);
  float h2 = hash11(seed * 7.77 + 3.0);
  vec3 radial = normalize(iCenter);
  vec3 d = radial * (uRadialOffset * (0.4 + h1 * 1.4) * step(0.45, h2) + sin(uTime * (0.3 + h2 * 0.7) + seed * 30.0) * 0.022 * uShellActivity);
  // Individual floating: own phase, a small radial and tangential drift and a minimal rotation inside the plate plane.
  float fl = sin(uTime * (0.11 + h2 * 0.16) + seed * 37.0);
  vec3 drift = radial * fl * 0.035 * (0.5 + h1) + iU * sin(uTime * (0.07 + h1 * 0.09) + seed * 13.0) * 0.02;
  float rot = 0.12 * sin(uTime * (0.05 + h2 * 0.08) + seed * 29.0);
  vec2 q = vec2(cos(rot) * position.x - sin(rot) * position.y, sin(rot) * position.x + cos(rot) * position.y);
  vec3 pos = iCenter + d + drift + iU * q.x * iSize.x + iV * q.y * iSize.y;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float centerZ = modelViewMatrix[3].z;
  mv.z = mix(mv.z, centerZ, uAlign * 0.32);
  gl_Position = projectionMatrix * mv;
  float edge = edgeFadeNdc(gl_Position.xy / gl_Position.w);
  vUv = position.xy + 0.5;
  vSize = iSize;
  vMeta = iMeta;
  vFade = depthFade(mv.z, centerZ) * edge;
  vAperture = aperture(mv.xy - modelViewMatrix[3].xy);
  vReveal = revealVisibility(length(iCenter), uRevealStart);
}
`;

export const plateFragmentShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
uniform float uOpacity;
uniform float uBase;
varying vec2 vUv;
varying vec2 vSize;
varying vec3 vMeta;
varying float vFade;
varying float vReveal;
varying float vAperture;

float lineAt(float d, float w) {
  return 1.0 - smoothstep(w * 0.45, w * 1.1, abs(d));
}

void main() {
  float seed = vMeta.x;
  int kind = int(vMeta.y + 0.5);
  float bright = vMeta.z;
  vec2 uv = vUv;
  vec2 fw = fwidth(uv);
  // Edge-on plates make fwidth huge; clamp so outlines never flood the whole quad with white.
  vec2 lw = min(fw * max(1.15, uPixelRatio * 0.95), vec2(0.1));
  float h1 = hash11(seed * 13.37 + 1.0);
  float h2 = hash11(seed * 7.77 + 3.0);
  float h3 = hash11(seed * 5.13 + 9.0);

  float m = kind == 1 ? 0.2 : 0.06;
  vec2 e = abs(uv - 0.5) - (0.5 - m);
  float inBoxX = step(e.x, lw.x * 0.6);
  float inBoxY = step(e.y, lw.y * 0.6);
  float outline = max(lineAt(e.x, lw.x) * inBoxY, lineAt(e.y, lw.y) * inBoxX);
  float inside = step(e.x, 0.0) * step(e.y, 0.0);
  vec2 iuv = (uv - m) / (1.0 - 2.0 * m);

  float detail = 0.0;
  if (kind == 0) {
    float rows = 3.0 + floor(h1 * 5.0);
    float row = floor(iuv.y * rows);
    float rowSeed = hash11(row * 3.7 + seed * 11.0);
    float x0 = rowSeed * 0.4;
    float len = 0.2 + hash11(row * 5.1 + seed * 3.0) * 0.6;
    float fy = fract(iuv.y * rows);
    float bar = step(abs(fy - 0.5), 0.2) * step(x0, iuv.x) * step(iuv.x, x0 + len);
    detail = bar * inside * 0.5;
  } else if (kind == 1) {
    float pins = 4.0 + floor(h1 * 6.0);
    float py = fract(uv.y * pins);
    float pinLine = step(abs(py - 0.5), 0.17);
    float leftPin = step(uv.x, m + lw.x * 0.5) * pinLine;
    float rightPin = step(1.0 - m - lw.x * 0.5, uv.x) * pinLine;
    float core = step(abs(e.x + (0.5 - m) - 0.28), 0.0) * 0.0;
    float bodyBars = step(abs(fract(iuv.y * 3.0) - 0.5), 0.1) * step(0.2, iuv.x) * step(iuv.x, 0.8);
    detail = (leftPin + rightPin) * 0.85 + bodyBars * inside * 0.45 + core;
  } else if (kind == 2) {
    vec2 cells = vec2(2.0 + floor(h1 * 4.0), 2.0 + floor(h2 * 5.0));
    vec2 g = abs(fract(iuv * cells) - 0.5);
    float gridLine = max(lineAt(0.5 - g.x, lw.x * cells.x), lineAt(0.5 - g.y, lw.y * cells.y));
    float lit = step(0.8, hash11(floor(iuv.x * cells.x) * 7.0 + floor(iuv.y * cells.y) * 13.0 + seed * 19.0));
    detail = gridLine * inside * 0.5 + lit * inside * 0.22;
  } else if (kind == 3) {
    float cx = abs(uv.x - 0.5);
    float stem = lineAt(cx, lw.x * 1.2);
    float ticks = step(0.3, cx) * step(cx, 0.5) * step(abs(fract(uv.y * (10.0 + floor(h1 * 14.0))) - 0.5), 0.09);
    float headPos = fract(uTime * (0.1 + h2 * 0.2) + h3);
    float head = exp(-pow((uv.y - headPos) * 9.0, 2.0));
    detail = stem * 0.6 + ticks * 0.45 + head * 0.55;
    outline *= 0.35;
  } else {
    vec2 cells = vec2(3.0 + floor(h1 * 3.0), 3.0 + floor(h2 * 3.0));
    vec2 f = fract(iuv * cells) - 0.5;
    float dots = 1.0 - smoothstep(0.1, 0.22, length(f));
    float onDot = step(0.5, hash11(floor(iuv.x * cells.x) * 5.0 + floor(iuv.y * cells.y) * 9.0 + seed * 23.0));
    detail = dots * onDot * inside;
  }

  // slow scan band moving over the plate
  float band = exp(-pow((uv.y - fract(uTime * (0.08 + h2 * 0.12) + h1)) * 6.0, 2.0)) * 0.35 * (0.4 + uShellActivity);
  float fill = inside * (0.03 + 0.035 * bright);
  float shape = outline * 0.95 + detail + fill + band * inside;
  float twinkle = 0.8 + 0.2 * sin(uTime * (0.6 + h3 * 2.0) + seed * 40.0);
  float hot = smoothstep(0.9, 0.98, h2);
  float intensity = min(shape, 1.1) * (0.3 + 0.7 * bright + hot * 0.35) * twinkle;
  if (kind == 3) intensity *= 0.5; // tall streaks stay a quiet accent instead of single white flashes

  vec3 col = orbPalette(seed + 0.31, hot * 0.8 + band);
  col = applySaturation(col);
  col = applyAccent(col, seed);
  col = depthTint(col, vFade);
  col *= 1.0 + hot * 0.3;

  float a = clamp(intensity * uBase * vFade * vReveal * vAperture * uOpacity * uEmission, 0.0, 0.7);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
