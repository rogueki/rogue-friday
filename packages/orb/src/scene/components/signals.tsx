import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Group, Mesh } from "three";
import { pointsGeometry } from "../geometry/buffers";
import {
  buildAgentMarkers,
  buildDust,
  buildEnergyArcs,
  buildEnergyParticles,
  buildPackets,
  buildParticles,
  buildScanRing,
} from "../geometry/structures";
import { useGeometry, useLineLayer, useMaterial } from "../hooks";
import { makeLineMaterial, makePointsMaterial } from "../materials";
import { useOrb } from "../OrbContext";
import { registerStat } from "../stats";
import { SEED } from "./circuit";

/** AmbientParticles: fine twinkling particles in a halo shell; slow individual drift, some brighter, some dimmer. */
export function AmbientParticles() {
  const { shared, profile } = useOrb();
  const geometry = useGeometry(() => pointsGeometry(buildParticles(profile.particles, SEED + 101)), [profile.particles]);
  useEffect(() => registerStat("points", profile.particles), [profile.particles]);
  const material = useMaterial(() => makePointsMaterial("PARTICLES", shared, { base: 0.75 }), [shared]);
  return <points name="AmbientParticles" geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />;
}

/** EnergyParticles: pushed outwards by the audio force and peaks (listening/speaking), streaming to the core (transcribing). */
export function EnergyParticles() {
  const { shared, profile } = useOrb();
  const geometry = useGeometry(() => pointsGeometry(buildEnergyParticles(profile.energyParticles, SEED + 151)), [profile.energyParticles]);
  useEffect(() => registerStat("points", profile.energyParticles), [profile.energyParticles]);
  const material = useMaterial(() => makePointsMaterial("ENERGY", shared, { base: 0.9, size: 1 }), [shared]);
  return <points name="EnergyParticles" geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />;
}

/** Larger, fainter dust in a wide volume; the slight parallax against the orb sells depth. */
export function DepthDust() {
  const { shared, profile } = useOrb();
  const geometry = useGeometry(() => pointsGeometry(buildDust(profile.dust, SEED + 111)), [profile.dust]);
  useEffect(() => registerStat("points", profile.dust), [profile.dust]);
  const material = useMaterial(() => makePointsMaterial("DUST", shared, { base: 0.55, size: 1.1 }), [shared]);
  return <points name="DepthDust" geometry={geometry} material={material} frustumCulled={false} renderOrder={0} />;
}

/** DataPackets: bright packets (with fading tails) travelling on orbital lanes; rate follows the state. */
export function DataPackets() {
  const { live, shared, profile } = useOrb();
  const packets = useMemo(() => buildPackets(profile.packets, SEED + 121), [profile.packets]);
  useGeometry(() => packets.geometry, [packets]);
  const material = useMaterial(() => makePointsMaterial("PACKETS", shared, { base: 1, size: 1 }), [shared]);
  useFrame(() => {
    material.uniforms.uPacketRate!.value = live.current.packetRate;
  });
  return <points name="DataPackets" geometry={packets.geometry} material={material} frustumCulled={false} renderOrder={4} />;
}

/** InnerDataArcs: 4-8 curved arcs core -> shell; pulses run outwards, or inwards while thinking. */
export function EnergyArcs() {
  const { live, profile } = useOrb();
  const group = useRef<Group>(null);
  const count = profile.level === "low" ? 4 : profile.level === "medium" ? 6 : 8;
  const arcs = useLineLayer(() => buildEnergyArcs(count, SEED + 131), "ARCS", { width: 1.7, base: 1.5, revealStart: 0.15 }, [count]);
  useFrame(() => {
    const l = live.current;
    arcs.material.uniforms.uLevel!.value = l.energyArcs;
    if (group.current) group.current.rotation.y = l.midAngle * 0.6;
  });
  return (
    <group ref={group} name="InnerDataArcs">
      <mesh geometry={arcs.geometry} material={arcs.material} frustumCulled={false} renderOrder={3} />
    </group>
  );
}

/** HorizontalScan: thin cyan-gold ring sweeping vertically through the orb while transcribing. */
export function ScanPlane() {
  const { live, fixedClock, shared } = useOrb();
  const lead = useRef<Mesh>(null);
  const trail = useRef<Mesh>(null);
  const ring = useLineLayer(() => buildScanRing(), "SCAN", { width: 1.4, base: 0.9, revealStart: 0.2, tint: [0.35, 0.95, 1.0], tintMix: 0.55 }, []);
  const trailMat = useMaterial(
    () => makeLineMaterial("SCAN", shared, { width: 1.1, base: 0.9, revealStart: 0.2, tint: [0.35, 0.95, 1.0], tintMix: 0.55 }),
    [shared],
  );
  useFrame(() => {
    const l = live.current;
    const phase = fixedClock ? 0.25 : l.time;
    const y = Math.sin(phase * 1.1) * 1.75;
    const r = Math.sqrt(Math.max(0.2, 2.05 * 2.05 - y * y));
    ring.material.uniforms.uOpacity!.value = l.scanPlane;
    trailMat.uniforms.uOpacity!.value = l.scanPlane * 0.35;
    if (lead.current) {
      lead.current.position.y = y;
      lead.current.scale.set(r, 1, r);
      lead.current.visible = l.scanPlane > 0.01;
    }
    if (trail.current) {
      const ty = y - Math.cos(phase * 1.1) * 0.16;
      trail.current.position.y = ty;
      const tr = Math.sqrt(Math.max(0.2, 2.05 * 2.05 - ty * ty));
      trail.current.scale.set(tr, 1, tr);
      trail.current.visible = l.scanPlane > 0.01;
    }
  });
  return (
    <>
      <mesh ref={lead} name="HorizontalScan" geometry={ring.geometry} material={ring.material} frustumCulled={false} renderOrder={3} />
      <mesh ref={trail} geometry={ring.geometry} material={trailMat} frustumCulled={false} renderOrder={3} />
    </>
  );
}

/** AgentMarkers: small diamonds orbiting at r ~2.3; count = active agents (capped by quality), fade in/out smoothly. */
export function AgentMarkers() {
  const { live, shared, profile } = useOrb();
  const markers = useMemo(() => buildAgentMarkers(profile.agentMarkersMax), [profile.agentMarkersMax]);
  useGeometry(() => markers.geometry, [markers]);
  const material = useMaterial(() => makePointsMaterial("MARKERS", shared, { base: 1 }), [shared]);
  useFrame(() => {
    material.uniforms.uAgents!.value = Math.min(profile.agentMarkersMax, live.current.agentCount);
  });
  return <points name="AgentMarkers" geometry={markers.geometry} material={material} frustumCulled={false} renderOrder={5} />;
}
