import { COMMON_FRAG_FUNCS, COMMON_FUNCS, COMMON_UNIFORMS } from "./common";

/** Camera-facing billboard used for the core glow and the corona. */
export const glowVertexShader = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy * 2.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Core glow: tight white-hot centre + broad low-alpha gold falloff. Intensities > 1 are intentional (bloom input). */
export const coreGlowFragmentShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
uniform float uCore;
uniform float uWhite;
uniform float uBreath;
varying vec2 vP;

void main() {
  float r = length(vP);
  float hotCore = exp(-r * r * 520.0);
  float inner = exp(-r * 17.0);
  float halo = exp(-r * 3.4);
  vec3 hot = mix(ORB_GOLD * 1.6, vec3(1.0, 0.96, 0.78) * 2.4, uWhite);
  vec3 col = hot * hotCore * 1.7 + ORB_GOLD * inner * 0.65 + ORB_ORANGE * halo * 0.1;
  col = applySaturation(col);
  float k = uCore * uBreath * uEmission;
  float a = clamp((hotCore * 0.95 + inner * 0.4 + halo * 0.1) * k, 0.0, 1.0);
  gl_FragColor = vec4(col * k, a);
  #include <colorspace_fragment>
}
`;

/**
 * CorePulseShell: faint radial gradient, a thin shell that swells with the breath and the core audio drive, and inward
 * rings while thinking. (The outgoing speaking/listening waves live in the VoiceReactionGroup.)
 */
export const coronaFragmentShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
uniform float uCore;
uniform float uShell;
uniform float uThink;
uniform float uBreathU;
uniform float uDrive;
varying vec2 vP;

void main() {
  float r = length(vP);
  float base = exp(-r * 3.0) * 0.03 * (0.5 + uCore);
  float waves = 0.0;
  float shellR = 0.17 + 0.05 * uBreathU + 0.12 * uDrive;
  waves += exp(-pow((r - shellR) / 0.016, 2.0)) * (0.16 + 0.34 * uBreathU + 0.4 * uDrive) * uShell;
  waves += exp(-pow((r - shellR * 1.9) / 0.03, 2.0)) * 0.07 * uShell * (0.4 + uBreathU);
  if (uThink > 0.001) {
    float phase = r * 2.4 + uTime * 0.4;
    float band = pow(max(0.0, sin(phase * 6.2831853)), 12.0);
    waves += band * (1.0 - smoothstep(0.2, 0.95, r)) * uThink * 0.12 * smoothstep(0.1, 0.25, r);
  }
  vec3 col = mix(ORB_ORANGE, ORB_GOLD, 0.7) * (base + waves) + ORB_HOT * waves * 0.5;
  col = applySaturation(col);
  float a = clamp((base + waves) * uEmission, 0.0, 1.0);
  if (a < 0.002) discard;
  gl_FragColor = vec4(col * uEmission, a);
  #include <colorspace_fragment>
}
`;

/** Small solid core sphere with a fresnel rim. */
export const coreSphereVertexShader = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const coreSphereFragmentShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
uniform float uCore;
uniform float uWhite;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.2);
  vec3 hot = mix(ORB_GOLD * 1.8, vec3(1.0, 0.97, 0.82) * 2.8, uWhite);
  vec3 col = mix(hot, ORB_GOLD * 1.3, f);
  col = applySaturation(col);
  float k = uCore * uEmission;
  gl_FragColor = vec4(col * k, clamp(0.9 * k, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** Very soft additive glow behind the sphere: emitted-light feel; fades to zero well inside the canvas. */
export const sphereGlowFragmentShader = /* glsl */ `
${COMMON_UNIFORMS}
${COMMON_FUNCS}
${COMMON_FRAG_FUNCS}
uniform float uCore;
uniform float uSpread;
uniform float uAmp;
varying vec2 vP;
void main() {
  float r = length(vP);
  float g = exp(-r * r * uSpread) * uAmp * (0.55 + 0.45 * uCore) * (1.0 - smoothstep(0.62, 1.0, r));
  vec3 col = mix(ORB_ORANGE, ORB_GOLD, 0.6);
  col = applySaturation(col);
  float a = g * uEmission * edgeFadeFrag();
  if (a < 0.002) discard;
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`;
