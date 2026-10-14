import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Group } from "three";
import {
  buildGyroRings,
  buildInnerReactor,
  buildPrimaryRing,
  buildProgressOrbit,
  buildSecondaryRing,
  buildTelemetryRing,
} from "../geometry/structures";
import { useLineLayer } from "../hooks";
import { makeLineMaterial } from "../materials";
import { useOrb } from "../OrbContext";
import { SEED } from "./circuit";

/** Rings turn towards the camera plane when `align` rises (listening/syncing/success). */
const alignK = (align: number): number => 1 - 0.72 * align;

/** InnerReactor: four mini rings (r 0.19..0.55) + radial spokes. Faster than every outer layer. */
export function InnerReactor() {
  const { live } = useOrb();
  const root = useRef<Group>(null);
  const ringGroups = useRef<(Group | null)[]>([]);
  const spokeGroup = useRef<Group>(null);
  const reactor = useReactorParts();

  useFrame(() => {
    const l = live.current;
    const k = alignK(l.align);
    if (root.current) root.current.rotation.set(0.55 * k, 0.28 * k, 0);
    reactor.rings.forEach((_, i) => {
      const g = ringGroups.current[i];
      if (!g) return;
      const dir = i % 2 === 0 ? 1 : -1;
      g.rotation.set(0.16 * i - 0.28, 0.1 * i, dir * l.innerAngle * (1 + 0.45 * i) + i);
    });
    if (spokeGroup.current) spokeGroup.current.rotation.z = -l.innerAngle * 0.6;
  });

  return (
    <group ref={root} scale={1.35}>
      {reactor.rings.map((r, i) => (
        <group key={i} ref={(g) => void (ringGroups.current[i] = g)}>
          <mesh geometry={r.geometry} material={reactor.materials[i]} frustumCulled={false} renderOrder={4} />
        </group>
      ))}
      <group ref={spokeGroup}>
        <mesh geometry={reactor.spokes.geometry} material={reactor.spokeMaterial} frustumCulled={false} renderOrder={4} />
      </group>
    </group>
  );
}

function useReactorParts() {
  const { shared } = useOrb();
  const parts = useMemo(() => buildInnerReactor(SEED + 51), []);
  const materials = useMemo(
    () => parts.rings.map((_, i) => makeLineMaterial("REACTOR", shared, { width: 1.25 - i * 0.05, base: 0.95 - i * 0.08, revealStart: 0.02 + i * 0.05 })),
    [parts, shared],
  );
  const spokeMaterial = useMemo(() => makeLineMaterial("REACTOR", shared, { width: 1.0, base: 0.7, revealStart: 0.08, flowAmount: 1.4 }), [shared]);
  useEffect(
    () => () => {
      parts.rings.forEach((r) => r.geometry.dispose());
      parts.spokes.geometry.dispose();
      materials.forEach((m) => m.dispose());
      spokeMaterial.dispose();
    },
    [parts, materials, spokeMaterial],
  );
  return { rings: parts.rings, spokes: parts.spokes, materials, spokeMaterial };
}

/** Two tilted gyro rings (r 0.66 / 0.78) that counter-rotate while thinking. */
export function InnerGyroRings() {
  const { live, shared } = useOrb();
  const a = useRef<Group>(null);
  const b = useRef<Group>(null);
  const layers = useMemo(() => buildGyroRings(SEED + 61), []);
  const materials = useMemo(
    () => layers.map((_, i) => makeLineMaterial("RING", shared, { width: 1.3, base: 0.8 - i * 0.1, revealStart: 0.08 + i * 0.05 })),
    [layers, shared],
  );
  useEffect(
    () => () => {
      layers.forEach((l) => l.geometry.dispose());
      materials.forEach((m) => m.dispose());
    },
    [layers, materials],
  );
  useFrame(() => {
    const l = live.current;
    const k = alignK(l.align);
    if (a.current) a.current.rotation.set(0.95 * k, 0.3, l.ringAngles[1]);
    if (b.current) b.current.rotation.set(-0.55 * k, 0.85, l.gyroBAngle);
  });
  return (
    <>
      <group ref={a}>
        <mesh geometry={layers[0]!.geometry} material={materials[0]} frustumCulled={false} renderOrder={4} />
      </group>
      <group ref={b}>
        <mesh geometry={layers[1]!.geometry} material={materials[1]} frustumCulled={false} renderOrder={4} />
      </group>
    </>
  );
}

function useSingleRing(build: () => ReturnType<typeof buildPrimaryRing>, role: "RING" | "TELEMETRY" | "PROGRESS", opts: Parameters<typeof useLineLayer>[2]) {
  return useLineLayer(build, role, opts, []);
}

/** Band of three concentric dashed lines at r ~1.95. */
export function PrimaryOrbitalRing() {
  const { live } = useOrb();
  const group = useRef<Group>(null);
  const ring = useSingleRing(() => buildPrimaryRing(SEED + 71), "RING", { width: 1.2, base: 0.68, revealStart: 0.45 });
  useFrame(() => {
    const l = live.current;
    const k = alignK(l.align);
    if (group.current) group.current.rotation.set(1.18 * k, 0.12, l.ringAngles[2]);
    ring.material.uniforms.uOpacity!.value = 1 - l.approval * 0.25;
  });
  return (
    <group ref={group}>
      <mesh geometry={ring.geometry} material={ring.material} frustumCulled={false} renderOrder={2} />
    </group>
  );
}

/** r ~2.15 ring tilted ~62 degrees, segmented. */
export function SecondaryTiltedRing() {
  const { live } = useOrb();
  const group = useRef<Group>(null);
  const ring = useSingleRing(() => buildSecondaryRing(SEED + 81), "RING", { width: 1.15, base: 0.62, revealStart: 0.5 });
  useFrame(() => {
    const l = live.current;
    const k = alignK(l.align);
    if (group.current) group.current.rotation.set((62 * Math.PI) / 180 * k + 0.1, 0.5, l.ringAngles[3]);
  });
  return (
    <group ref={group}>
      <mesh geometry={ring.geometry} material={ring.material} frustumCulled={false} renderOrder={2} />
    </group>
  );
}

/** r ~2.45 ruler ring; the gaps widen with degraded health. */
export function TelemetryRing() {
  const { live } = useOrb();
  const group = useRef<Group>(null);
  const ring = useSingleRing(() => buildTelemetryRing(SEED + 91), "TELEMETRY", { width: 1.0, base: 0.6, revealStart: 0.55 });
  useFrame(() => {
    const l = live.current;
    const k = alignK(l.align * 0.5);
    if (group.current) group.current.rotation.set(0.38 * k, -0.16, l.ringAngles[4] + 0.2);
    ring.material.uniforms.uGap!.value = l.telemetryGap;
  });
  return (
    <group ref={group}>
      <mesh geometry={ring.geometry} material={ring.material} frustumCulled={false} renderOrder={2} />
    </group>
  );
}

/** r ~2.64 progress arc: determinate 0..progress, indeterminate = rotating comet; hidden without real progress. */
export function ProgressOrbit() {
  const { live } = useOrb();
  const group = useRef<Group>(null);
  const ring = useSingleRing(() => buildProgressOrbit(), "PROGRESS", { width: 2.0, base: 0.9, revealStart: 0.6 });
  useFrame(() => {
    const l = live.current;
    if (group.current) group.current.rotation.set(0.34, -0.1, 0.06);
    const u = ring.material.uniforms;
    u.uProgress!.value = l.progress;
    u.uProgressMode!.value = l.progressMode;
    u.uOpacity!.value = l.progressVisible * (1 + l.successPulse * 0.6);
  });
  return (
    <group ref={group}>
      <mesh geometry={ring.geometry} material={ring.material} frustumCulled={false} renderOrder={2} />
    </group>
  );
}
