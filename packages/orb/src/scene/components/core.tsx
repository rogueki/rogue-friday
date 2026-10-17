import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Group, Mesh, PlaneGeometry, SphereGeometry } from "three";
import { breathWave } from "../liveParams";
import {
  makeCoreGlowMaterial,
  makeCoreNoiseMaterial,
  makeCoreSphereMaterial,
  makeCoronaMaterial,
  makeSphereGlowMaterial,
} from "../materials";
import { buildCoreLens } from "../geometry/structures";
import { useGeometry, useLineLayer, useMaterial } from "../hooks";
import { useOrb } from "../OrbContext";

export const BILLBOARD = new PlaneGeometry(1, 1);

/**
 * WhiteHotCore: small solid core + tight white-hot glow billboard. The scale follows the breath cycle (idle 0.97..1.035)
 * plus the bounded audio mapping; brightness cycles between 72 and 100 % in idle.
 */
export function WhiteHotCore() {
  const { live, shared } = useOrb();
  const camera = useThree((s) => s.camera);
  const group = useRef<Group>(null);
  const glow = useRef<Mesh>(null);
  const sphereGeo = useGeometry(() => new SphereGeometry(0.045, 24, 16), []);
  const glowMat = useMaterial(() => makeCoreGlowMaterial(shared), [shared]);
  const sphereMat = useMaterial(() => makeCoreSphereMaterial(shared), [shared]);

  useFrame(() => {
    const l = live.current;
    const white = Math.min(1, l.coreWhite + l.successPulse * 0.6 + l.coreDrive * 0.18 * (1 - l.calm));
    glowMat.uniforms.uCore!.value = l.coreLevel;
    glowMat.uniforms.uWhite!.value = white;
    glowMat.uniforms.uBreath!.value = 1;
    sphereMat.uniforms.uCore!.value = l.coreLevel * 0.9;
    sphereMat.uniforms.uWhite!.value = white;
    if (group.current) group.current.scale.setScalar(l.coreScale);
    if (glow.current) glow.current.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={group} name="WhiteHotCore">
      <mesh ref={glow} geometry={BILLBOARD} material={glowMat} scale={[1.5, 1.5, 1]} frustumCulled={false} renderOrder={5} />
      <mesh geometry={sphereGeo} material={sphereMat} frustumCulled={false} renderOrder={6} />
    </group>
  );
}

/** CoreEnergyNoise: turbulence inside the core; swirls inwards while thinking, swells with the core audio drive. */
export function CoreEnergyNoise() {
  const { live, shared } = useOrb();
  const camera = useThree((s) => s.camera);
  const mesh = useRef<Mesh>(null);
  const mat = useMaterial(() => makeCoreNoiseMaterial(shared), [shared]);
  useFrame(() => {
    const l = live.current;
    mat.uniforms.uNoise!.value = l.coreNoise;
    mat.uniforms.uCoreLevel!.value = l.coreLevel;
    mat.uniforms.uDrive!.value = l.coreDrive * (1 - l.calm);
    mat.uniforms.uSwirl!.value = l.convergence * (l.analysisSweep > 0.5 ? 1 : 0.35);
    if (mesh.current) {
      mesh.current.quaternion.copy(camera.quaternion);
      mesh.current.scale.setScalar(1.1 * l.coreScale);
      mesh.current.visible = l.coreNoise > 0.01;
    }
  });
  return <mesh ref={mesh} name="CoreEnergyNoise" geometry={BILLBOARD} material={mat} scale={[1.1, 1.1, 1]} frustumCulled={false} renderOrder={4} />;
}

/** CorePulseShell: a thin shell that swells with the breath and the audio drive, plus inward rings while thinking. */
export function CorePulseShell() {
  const { live, shared } = useOrb();
  const camera = useThree((s) => s.camera);
  const mesh = useRef<Mesh>(null);
  const mat = useMaterial(() => makeCoronaMaterial(shared), [shared]);
  useFrame(() => {
    const l = live.current;
    const u = 0.5 + 0.5 * breathWave(l.breathPhase);
    mat.uniforms.uCore!.value = l.coreIntensity;
    mat.uniforms.uShell!.value = 1;
    mat.uniforms.uBreathU!.value = u;
    mat.uniforms.uDrive!.value = l.coreDrive * (1 - l.calm);
    mat.uniforms.uThink!.value = l.convergence * (l.analysisSweep > 0.5 ? 1 : 0.3);
    if (mesh.current) mesh.current.quaternion.copy(camera.quaternion);
  });
  return <mesh ref={mesh} name="CorePulseShell" geometry={BILLBOARD} material={mat} scale={[3.4, 3.4, 1]} frustumCulled={false} renderOrder={1} />;
}

/** Lens/iris structure around the white-hot point: ring + offset circle + fine spokes, always facing the camera. */
export function CoreLens() {
  const { live } = useOrb();
  const camera = useThree((s) => s.camera);
  const group = useRef<Group>(null);
  const lens = useLineLayer(() => buildCoreLens(777), "REACTOR", { width: 1.25, base: 1.15, revealStart: 0.01, flowAmount: 0 }, []);
  useFrame(() => {
    const l = live.current;
    const g = group.current;
    if (!g) return;
    g.quaternion.copy(camera.quaternion);
    g.rotateZ((l.ringAngles[0] as number) * 0.5 + 0.3);
    g.scale.setScalar(l.coreScale);
    lens.material.uniforms.uOpacity!.value = 0.55 + 0.45 * Math.min(1, l.coreLevel);
  });
  return (
    <group ref={group} name="CoreLens">
      <mesh geometry={lens.geometry} material={lens.material} frustumCulled={false} renderOrder={6} />
    </group>
  );
}

/** Volumetric glow: a tight halo and a wide, very faint one; both fade to zero before the canvas edge. */
export function SphereGlow() {
  const { live, shared } = useOrb();
  const camera = useThree((s) => s.camera);
  const near = useRef<Mesh>(null);
  const far = useRef<Mesh>(null);
  const nearMat = useMaterial(() => makeSphereGlowMaterial(shared, 2.4, 0.12), [shared]);
  const farMat = useMaterial(() => makeSphereGlowMaterial(shared, 1.5, 0.06), [shared]);
  useFrame(() => {
    const l = live.current;
    nearMat.uniforms.uCore!.value = l.coreLevel;
    farMat.uniforms.uCore!.value = l.coreLevel;
    if (near.current) near.current.quaternion.copy(camera.quaternion);
    if (far.current) far.current.quaternion.copy(camera.quaternion);
  });
  return (
    <>
      <mesh ref={near} name="SphereGlow" geometry={BILLBOARD} material={nearMat} scale={[5.4, 5.4, 1]} frustumCulled={false} renderOrder={0} />
      <mesh ref={far} name="SphereGlowWide" geometry={BILLBOARD} material={farMat} scale={[7.4, 7.4, 1]} frustumCulled={false} renderOrder={0} />
    </>
  );
}
