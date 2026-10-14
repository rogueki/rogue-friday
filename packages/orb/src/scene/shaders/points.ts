import { COMMON_FUNCS, COMMON_UNIFORMS } from "./common";

/**
 * Point-sprite material. Roles: PARTICLES (micro halo), DUST (depth dust), PACKETS (data packets on orbital lanes),
 * MARKERS (agent diamonds).
 */
export const pointsVertexShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
attribute vec4 aInfo;
#if defined(ROLE_PACKETS) || defined(ROLE_MARKERS)
attribute vec4 aOrbit;
#endif
uniform float uOpacity;
uniform float uBase;
uniform float uSizeScale;
uniform float uPacketRate;
uniform float uAgents;
uniform float uMarkerLift;

varying float vAlpha;
varying vec3 vColor;
varying float vKind;

vec3 orbitPoint(vec4 orb, float radius, float theta) {
  // Orbit plane from inclination + ascending node; theta is the angle inside that plane.
  vec3 axis = vec3(sin(orb.y) * cos(orb.z), cos(orb.y), sin(orb.y) * sin(orb.z));
  vec3 u = normalize(cross(axis, vec3(0.31, 0.93, 0.19)));
  vec3 v = cross(axis, u);
  return (u * cos(theta) + v * sin(theta)) * radius;
}

void main() {
  float seed = aInfo.x;
  float h1 = hash11(seed * 13.37 + 1.0);
  float h2 = hash11(seed * 7.77 + 3.0);
  vec3 p = position;
  float size = 2.0;
  float alpha = 1.0;
  vKind = 0.0;
  float hot = 0.0;

  #ifdef ROLE_PARTICLES
    float a = uTime * 0.018 * (0.4 + h1);
    float ca = cos(a);
    float sa = sin(a);
    p = vec3(ca * p.x - sa * p.z, p.y + sin(uTime * 0.2 + seed * 20.0) * 0.03, sa * p.x + ca * p.z);
    size = aInfo.y;
    alpha = (0.25 + 0.75 * h2) * (0.6 + 0.4 * sin(uTime * (0.6 + aInfo.z * 2.5) + seed * 30.0));
    hot = step(0.96, h1);
  #endif
  #ifdef ROLE_DUST
    float a = uTime * 0.01 * (0.4 + h1);
    float ca = cos(a);
    float sa = sin(a);
    p = vec3(ca * p.x - sa * p.z, p.y + sin(uTime * 0.12 + seed * 20.0) * 0.08, sa * p.x + ca * p.z);
    size = aInfo.y;
    alpha = 0.35 * (0.5 + 0.5 * sin(uTime * (0.3 + aInfo.z) + seed * 30.0));
  #endif
  #ifdef ROLE_PACKETS
    float gate = aInfo.w;
    float live = smoothstep(gate, gate + 0.1, uPacketRate) * step(0.02, uPacketRate);
    float tailK = aInfo.y;
    float speed = aOrbit.w * (0.5 + uFlowSpeed * 2.2);
    float theta = aOrbit.x + uTime * speed - tailK * 0.09 * sign(speed);
    float radius = aInfo.z;
    float prog = fract(uTime * 0.11 * (0.6 + h1) + h2);
    radius = mix(radius, 0.22, uConverge * prog * prog);
    p = orbitPoint(aOrbit, radius, theta);
    size = mix(4.6, 1.4, tailK);
    alpha = live * pow(1.0 - tailK, 1.7);
    hot = 1.0 - tailK;
    vKind = 1.0;
  #endif
  #ifdef ROLE_MARKERS
    float idx = aInfo.y;
    float present = clamp(uAgents - idx, 0.0, 1.0);
    float theta = aOrbit.x + uTime * aOrbit.w;
    p = orbitPoint(aOrbit, aInfo.z, theta);
    size = 9.0 * present;
    alpha = present;
    hot = 0.15;
    vKind = 2.0;
  #endif

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float centerZ = modelViewMatrix[3].z;
  gl_Position = projectionMatrix * mv;
  float fade = depthFade(mv.z, centerZ);
  #ifdef ROLE_DUST
    fade = mix(0.55, 1.0, fade);
  #endif
  float atten = clamp(9.0 / max(-mv.z, 0.5), 0.55, 1.6);
  gl_PointSize = clamp(size * uSizeScale * uPixelRatio * atten, 0.0, 48.0);

  vec3 col = orbPalette(seed, hot);
  col = applySaturation(col);
  col = applyAccent(col, seed);
  col = depthTint(col, fade) * (1.0 + hot * 1.1);
  #ifdef ROLE_DUST
    col *= 0.6;
  #endif
  float rv = revealVisibility(length(p), 0.05);
  vAlpha = clamp(alpha * uBase * fade * rv * uOpacity * uEmission, 0.0, 1.0);
  vColor = col;
}
`;

export const pointsFragmentShader = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
varying float vKind;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float s;
  if (vKind > 1.5) {
    // agent marker: outlined diamond with a bright centre
    float d = abs(p.x) + abs(p.y);
    s = (1.0 - smoothstep(0.78, 0.98, d)) * (0.35 + 0.65 * smoothstep(0.3, 0.7, d)) + (1.0 - smoothstep(0.0, 0.3, d)) * 0.9;
  } else {
    float r = length(p);
    float k = vKind > 0.5 ? 2.0 : 1.4;
    s = pow(max(0.0, 1.0 - r), k);
  }
  float a = vAlpha * s;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;
