import { COMMON_FUNCS, COMMON_UNIFORMS } from "./common";

/** Transparent holographic sphere shell: fresnel rim, faint latitude/longitude grid and a slow scan band. */
export const shellVertexShader = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
varying float vClipEdge;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vObj = position;
  gl_Position = projectionMatrix * mv;
  vec2 ndc = gl_Position.xy / gl_Position.w;
  vec2 a = abs(ndc);
  vClipEdge = 1.0 - smoothstep(0.78, 0.985, max(a.x, a.y));
}
`;

export const shellFragmentShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
uniform float uShells;
uniform float uPhase;
uniform float uLines;
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
varying float vClipEdge;

void main() {
  vec3 n = normalize(vN);
  float ndv = abs(dot(n, normalize(vV)));
  float rim = pow(1.0 - ndv, 2.6);
  vec3 o = normalize(vObj);
  float lat = asin(clamp(o.y, -1.0, 1.0));
  float lon = atan(o.z, o.x);
  float fwLat = max(fwidth(lat), 1e-4);
  float fwLon = max(fwidth(lon), 1e-4);
  float gl = 1.0 - smoothstep(0.0, 2.0 * fwLat * uLines, abs(sin(lat * uLines + uPhase * 6.2831853)));
  float gm = 1.0 - smoothstep(0.0, 1.1 * fwLon * uLines, abs(sin(lon * uLines * 0.5 - uPhase * 3.0)));
  float grid = max(gl, gm * 0.8);
  float scanY = fract(uTime * 0.06 + uPhase) * 2.0 - 1.0;
  float scan = exp(-pow((o.y - scanY) * 9.0, 2.0));
  float back = gl_FrontFacing ? 1.0 : 0.45;
  float a = (rim * 0.085 + grid * 0.03 * (0.3 + rim) + scan * 0.035) * uShells * back * vClipEdge * uEmission;
  vec3 col = mix(ORB_ORANGE, ORB_GOLD, 0.6 + 0.3 * rim);
  col = applySaturation(col);
  if (a < 0.002) discard;
  gl_FragColor = vec4(col * 1.4, clamp(a, 0.0, 0.5));
  #include <colorspace_fragment>
}
`;

/** Approval glyph: an outlined shield with an exclamation mark, drawn as distance fields. */
export const glyphFragmentShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
uniform float uAmt;
uniform float uPulse;
varying vec2 vP;

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 p = vP * 1.1;
  float d = 1e3;
  d = min(d, sdSeg(p, vec2(0.0, 0.92), vec2(0.78, 0.58)));
  d = min(d, sdSeg(p, vec2(0.78, 0.58), vec2(0.78, -0.12)));
  d = min(d, sdSeg(p, vec2(0.78, -0.12), vec2(0.0, -0.95)));
  d = min(d, sdSeg(p, vec2(0.0, -0.95), vec2(-0.78, -0.12)));
  d = min(d, sdSeg(p, vec2(-0.78, -0.12), vec2(-0.78, 0.58)));
  d = min(d, sdSeg(p, vec2(-0.78, 0.58), vec2(0.0, 0.92)));
  float outline = exp(-d * d / 0.0016);
  float bar = 1.0 - smoothstep(0.0, 0.03, sdSeg(p, vec2(0.0, 0.5), vec2(0.0, -0.12)) - 0.07);
  float dotShape = 1.0 - smoothstep(0.0, 0.03, length(p - vec2(0.0, -0.4)) - 0.085);
  float fillGlow = exp(-length(p) * 1.6) * 0.06;
  float k = (outline * 0.9 + bar + dotShape + fillGlow) * uAmt * (0.6 + 0.4 * uPulse);
  float a = clamp(k * uEmission, 0.0, 1.0);
  if (a < 0.004) discard;
  vec3 col = applySaturation(vec3(1.0, 0.7, 0.08) * 1.25);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
