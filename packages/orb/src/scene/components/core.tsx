import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Group, Mesh, PlaneGeometry, SphereGeometry } from "three";
import { breathScale } from "../liveParams";
import { makeCoreGlowMaterial, makeCoreSphereMaterial, makeCoronaMaterial, makeSphereGlowMaterial } from "../materials";
import { buildCoreLens } from "../geometry/structures";
import { useGeometry, useLineLayer, useMaterial } from "../hooks";
import { useOrb } from "../OrbContext";

const BILLBOARD = new PlaneGeometry(1, 1);

/** Small solid core + tight white-hot glow billboard. Breath scale +-2 %, reacts to voice/TTS amplitude. */
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
    const pulse = 1 + l.successPulse * 0.5;
    const core = Math.min(1.8, l.coreIntensity * pulse + l.audio * 0.35);
    const white = Math.min(1, l.coreWhite + l.successPulse * 0.6);
    const breath = breathScale(l);
    glowMat.uniforms.uCore!.value = core;
    glowMat.uniforms.uWhite!.value = white;
    glowMat.uniforms.uBreath!.value = breath;
    sphereMat.uniforms.uCore!.value = core * 0.9;
    sphereMat.uniforms.uWhite!.value = white;
    if (group.current) group.current.scale.setScalar(breath * (1 + l.audio * 0.1));
    if (glow.current) glow.current.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={group}>
      <mesh ref={glow} geometry={BILLBOARD} material={glowMat} scale={[1.5, 1.5, 1]} frustumCulled={false} renderOrder={5} />
      <mesh geometry={sphereGeo} material={sphereMat} frustumCulled={false} renderOrder={6} />
    </group>
  );
}

/** Faint corona; carries the speaking waves and the inward thinking rings. Never covers the line work. */
export function CoreCorona() {
  const { live, shared } = useOrb();
  const camera = useThree((s) => s.camera);
  const mesh = useRef<Mesh>(null);
  const mat = useMaterial(() => makeCoronaMaterial(shared), [shared]);
  useFrame(() => {
    const l = live.current;
    mat.uniforms.uCore!.value = l.coreIntensity;
    mat.uniforms.uSpeak!.value = l.speakWaves;
    mat.uniforms.uThink!.value = l.convergence * (l.gyroCounter < 0 ? 1 : 0.3);
    if (mesh.current) mesh.current.quaternion.copy(camera.quaternion);
  });
  return <mesh ref={mesh} geometry={BILLBOARD} material={mat} scale={[3.4, 3.4, 1]} frustumCulled={false} renderOrder={1} />;
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
    g.rotateZ(l.innerAngle * 0.5 + 0.3);
    g.scale.setScalar(breathScale(l));
    lens.material.uniforms.uOpacity!.value = 0.55 + 0.45 * Math.min(1, l.coreIntensity);
  });
  return (
    <group ref={group}>
      <mesh geometry={lens.geometry} material={lens.material} frustumCulled={false} renderOrder={6} />
    </group>
  );
}

/** Large, very faint glow sprite behind the sphere. */
export function SphereGlow() {
  const { live, shared } = useOrb();
  const camera = useThree((s) => s.camera);
  const mesh = useRef<Mesh>(null);
  const mat = useMaterial(() => makeSphereGlowMaterial(shared), [shared]);
  useFrame(() => {
    mat.uniforms.uCore!.value = live.current.coreIntensity;
    if (mesh.current) mesh.current.quaternion.copy(camera.quaternion);
  });
  return <mesh ref={mesh} geometry={BILLBOARD} material={mat} scale={[5.4, 5.4, 1]} frustumCulled={false} renderOrder={0} />;
}
