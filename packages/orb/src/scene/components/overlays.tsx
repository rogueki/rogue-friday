import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { buildApprovalRing, buildFractureRing, buildWarningRing } from "../geometry/structures";
import { useLineLayer } from "../hooks";
import { useOrb } from "../OrbContext";

/** Amber outer ring that holds open segments and pulses slowly; motion elsewhere calms down. */
export function ApprovalOverlay() {
  const { live } = useOrb();
  const group = useRef<Group>(null);
  const ring = useLineLayer(() => buildApprovalRing(), "OVERLAY", { width: 1.7, base: 0.95, revealStart: 0.4, tint: [1, 0.69, 0.04], tintMix: 0.8 }, []);
  useFrame(() => {
    const l = live.current;
    const pulse = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(l.time * 1.5));
    ring.material.uniforms.uOpacity!.value = l.approval * pulse;
    if (group.current) group.current.rotation.set(0.3, -0.12, l.time * 0.02 * l.approval + 0.4);
  });
  return (
    <group ref={group}>
      <mesh geometry={ring.geometry} material={ring.material} frustumCulled={false} renderOrder={4} />
    </group>
  );
}

/** One outer ring that stays visibly incomplete, shifted towards orange; calm pulse, no blinking. */
export function WarningOverlay() {
  const { live } = useOrb();
  const group = useRef<Group>(null);
  const ring = useLineLayer(() => buildWarningRing(), "OVERLAY", { width: 1.5, base: 0.9, revealStart: 0.5, tint: [1, 0.46, 0.06], tintMix: 0.75 }, []);
  useFrame(() => {
    const l = live.current;
    ring.material.uniforms.uOpacity!.value = l.warning * (0.8 + 0.2 * Math.sin(l.time * 1.1));
    if (group.current) group.current.rotation.set(0.12, 0.08, 0.3);
  });
  return (
    <group ref={group}>
      <mesh geometry={ring.geometry} material={ring.material} frustumCulled={false} renderOrder={4} />
    </group>
  );
}

/** Broken ring segments in deep orange/red; short entry impulse, then a stable, readable offset. No flicker loops. */
export function ErrorFractureOverlay() {
  const { live } = useOrb();
  const group = useRef<Group>(null);
  const ring = useLineLayer(() => buildFractureRing(), "FRACTURE", { width: 1.6, base: 1, revealStart: 0.4, tint: [1, 0.2, 0.07], tintMix: 0.88 }, []);
  useFrame(() => {
    const l = live.current;
    ring.material.uniforms.uOpacity!.value = l.error * (0.85 + 0.6 * l.errorImpulse);
    if (group.current) group.current.rotation.set(0.2, 0.05, 0.55);
  });
  return (
    <group ref={group}>
      <mesh geometry={ring.geometry} material={ring.material} frustumCulled={false} renderOrder={4} />
    </group>
  );
}
