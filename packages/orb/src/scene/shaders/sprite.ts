import { COMMON_FUNCS, COMMON_UNIFORMS } from "./common";

/** Screen-space node sprites (circuit node squares/diamonds). Size is in CSS pixels so nodes stay crisp at any depth. */
export const spriteVertexShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
attribute vec3 iPos;
attribute vec4 iInfo;
uniform float uRevealStart;
uniform float uOpacity;
uniform float uBase;
uniform float uNodeBoost;

varying vec2 vCorner;
varying vec4 vInfo;
varying float vFade;
varying float vReveal;
varying float vAperture;

void main() {
  float seed = iInfo.x;
  float h1 = hash11(seed * 13.37 + 1.0);
  vec3 radial = normalize(iPos);
  vec3 p = iPos + radial * uRadialOffset * 0.25 * (0.3 + h1);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float centerZ = modelViewMatrix[3].z;
  mv.z = mix(mv.z, centerZ, uAlign * 0.32);
  vec4 c = projectionMatrix * mv;
  float sizePx = iInfo.y * uPixelRatio * (0.8 + 0.5 * uNodeBoost);
  float ang = iInfo.z > 0.5 && iInfo.z < 1.5 ? 0.785398 : 0.0;
  vec2 corner = position.xy;
  vec2 rc = rot2(ang) * corner;
  c.xy += rc * sizePx / uViewport * c.w;
  gl_Position = c;
  vCorner = corner;
  vInfo = iInfo;
  vFade = depthFade(mv.z, centerZ);
  vAperture = aperture(mv.xy - modelViewMatrix[3].xy);
  vReveal = revealVisibility(length(iPos), uRevealStart);
}
`;

export const spriteFragmentShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
uniform float uOpacity;
uniform float uBase;
varying vec2 vCorner;
varying vec4 vInfo;
varying float vFade;
varying float vReveal;
varying float vAperture;

void main() {
  float seed = vInfo.x;
  int shape = int(vInfo.z + 0.5);
  vec2 p = vCorner;
  float s = 0.0;
  float ring = max(abs(p.x), abs(p.y));
  if (shape == 0) {
    // hollow square with a centre dot
    s = (1.0 - smoothstep(0.62, 0.78, abs(ring - 0.78))) * 0.9;
    s += (1.0 - smoothstep(0.12, 0.3, length(p))) * 0.9;
  } else if (shape == 1) {
    // filled diamond (quad is pre-rotated 45 degrees)
    s = (1.0 - smoothstep(0.55, 0.9, ring)) * 1.0;
  } else {
    // bright core with a soft halo
    s = (1.0 - smoothstep(0.0, 1.0, length(p))) * 0.7 + (1.0 - smoothstep(0.1, 0.4, length(p))) * 1.0;
  }
  float tw = 0.55 + 0.45 * sin(uTime * (1.0 + hash11(seed * 3.1) * 3.0) + seed * 30.0);
  float hot = smoothstep(0.8, 0.97, hash11(seed * 7.7 + 1.0));
  vec3 col = orbPalette(seed + 0.7, 0.35 + hot * 0.65);
  col = applySaturation(col);
  col = applyAccent(col, seed);
  col = depthTint(col, vFade) * (1.0 + hot * 0.5);
  float a = clamp(s * tw * uBase * vFade * vReveal * vAperture * uOpacity * uEmission, 0.0, 0.75);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
