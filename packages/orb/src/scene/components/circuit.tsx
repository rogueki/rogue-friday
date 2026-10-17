import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { SphereGeometry, type Group } from "three";
import { buildPlateGeometry, buildSpriteGeometry, type PlateInstance, type SpriteInstance } from "../geometry/buffers";
import { buildCircuitTraces, buildPlates } from "../geometry/circuit";
import { buildArcs } from "../geometry/structures";
import { useGeometry, useLineLayer, useMaterial } from "../hooks";
import { makePlateMaterial, makeShellMaterial, makeSpriteMaterial } from "../materials";
import { useOrb } from "../OrbContext";
import { registerStat } from "../stats";

export const SEED = 20260615;

/**
 * FloatingFragments / HolographicPanels: instanced chip plates; graphics are drawn in the fragment shader. Every plate
 * floats on its own phase with a small radial/tangential drift and a minimal rotation. Pass the instances of this layer.
 */
export function FloatingDataFragments({ plates, revealStart = 0.2 }: { plates: PlateInstance[]; revealStart?: number }) {
  const { shared } = useOrb();
  const geometry = useGeometry(() => buildPlateGeometry(plates), [plates]);
  const material = useMaterial(() => makePlateMaterial(shared, { revealStart }), [shared, revealStart]);
  useEffect(() => registerStat("plates", plates.length), [plates]);
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />;
}

/** Tiny squares/diamonds at trace ends; pixel-sized so they stay crisp. */
export function CircuitNodes({ nodes, revealStart = 0.12 }: { nodes: SpriteInstance[]; revealStart?: number }) {
  const { shared, live } = useOrb();
  const geometry = useGeometry(() => buildSpriteGeometry(nodes), [nodes]);
  const material = useMaterial(() => makeSpriteMaterial(shared, { revealStart }), [shared, revealStart]);
  useEffect(() => registerStat("nodes", nodes.length), [nodes]);
  useFrame(() => {
    material.uniforms.uNodeBoost!.value = Math.min(1, live.current.packetRate * 0.7);
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />;
}

export { CircuitNodes as DataNodes };

/** Two transparent holographic sphere shells (r 1.28 / 1.82) with fresnel rim, faint grid and a slow scan band. */
export function HolographicShells() {
  const { live, shared, profile } = useOrb();
  const inner = useRef<Group>(null);
  const outer = useRef<Group>(null);
  const geometry = useGeometry(() => new SphereGeometry(1, profile.shellSegments, Math.round(profile.shellSegments * 0.75)), [profile.shellSegments]);
  const innerMat = useMaterial(() => makeShellMaterial(shared, 0.0, 14), [shared]);
  const outerMat = useMaterial(() => makeShellMaterial(shared, 0.37, 22), [shared]);
  useFrame(() => {
    const l = live.current;
    innerMat.uniforms.uShells!.value = l.shells;
    outerMat.uniforms.uShells!.value = l.shells * 0.8;
    if (inner.current) inner.current.rotation.set(0.3, l.midAngle * 1.6, 0.1);
    if (outer.current) outer.current.rotation.set(-0.25, -l.outerAngle * 2.2, 0.2);
  });
  return (
    <group name="HolographicShells">
      <group ref={inner} scale={1.28}>
        <mesh geometry={geometry} material={innerMat} frustumCulled={false} renderOrder={1} />
      </group>
      <group ref={outer} scale={1.82}>
        <mesh geometry={geometry} material={outerMat} frustumCulled={false} renderOrder={1} />
      </group>
    </group>
  );
}

/** Splits a plate set by radius so inner plates travel with the mid sphere and outer ones with the fragment shell. */
export function usePlateSets(count: number, octaves: number) {
  return useMemo(() => {
    const all = buildPlates({
      count,
      seed: SEED + 11,
      octaves,
      radii: [1.3, 2.2],
      sizeRange: [0.06, 0.26],
      streakFraction: 0.12,
      pushProbability: 0.38,
    });
    return { mid: all.filter((p) => Math.hypot(...p.center) < 1.75), outer: all.filter((p) => Math.hypot(...p.center) >= 1.75) };
  }, [count, octaves]);
}

/**
 * MidCircuitSphere: Manhattan circuit traces on three nested shells (1.35 / 1.5 / 1.62), long tilted great arcs,
 * node squares and the inner chip plates. Rotates slowly on a tilted axis; follows the voice layer when speaking
 * and the work layer otherwise (via live.midSpeed / flow).
 */
export function MidCircuitSphere({ plates }: { plates: PlateInstance[] }) {
  const { live, profile } = useOrb();
  const group = useRef<Group>(null);
  const circuit = useMemo(
    () =>
      buildCircuitTraces({
        traces: profile.circuitTraces,
        seed: SEED,
        octaves: profile.noiseOctaves,
        shells: [1.35, 1.5, 1.62],
        shellWeights: [0.3, 0.4, 0.3],
        busFraction: 0.06,
        pushProbability: 0,
        pushRange: [0, 0],
        stepRange: [1.5, 4.5],
        kindBase: 0.2,
      }),
    [profile.circuitTraces, profile.noiseOctaves],
  );
  const mid = useLineLayer(() => ({ geometry: circuit.lines.build(), segments: circuit.segments }), "MID", { width: 1.1, base: 0.6, revealStart: 0.12 }, [circuit]);
  const nodesLimited = useMemo(() => circuit.nodes.slice(0, profile.circuitNodes), [circuit, profile.circuitNodes]);
  const great = useLineLayer(
    () =>
      buildArcs({
        count: Math.max(2, Math.round(profile.outerArcs * 0.4)),
        seed: SEED + 21,
        radii: [1.5, 1.72],
        length: [40, 110],
        lineCount: [1, 3],
        pushProbability: 0,
        pushRange: [0, 0],
        tickProbability: 0.2,
        kind: 0.25,
        facing: 0.3,
      }),
    "MID",
    { width: 1.0, base: 0.5, revealStart: 0.25, flowAmount: 0.6 },
    [profile.outerArcs],
  );

  useFrame(() => {
    const l = live.current;
    const g = group.current;
    if (!g) return;
    g.rotation.set(0.32 + Math.sin(l.midAngle * 0.5) * 0.04, l.midAngle, 0.1);
  });

  return (
    <group ref={group} name="CircuitSphere">
      <mesh name="CircuitLines" geometry={mid.geometry} material={mid.material} frustumCulled={false} renderOrder={2} />
      <mesh geometry={great.geometry} material={great.material} frustumCulled={false} renderOrder={2} />
      <CircuitNodes nodes={nodesLimited} />
      <FloatingDataFragments plates={plates} />
    </group>
  );
}

/**
 * FragmentGroup: BrokenArcs (arcs r 1.75..2.25 with protruding fragments), TechnicalPanels (outer traces and nodes) and
 * FloatingFragments (outer plates). Follows the work layer (Working/Syncing push it radially, Error scatters it) and
 * turns against the outer rings.
 */
export function OuterFragmentShell({ plates }: { plates: PlateInstance[] }) {
  const { live, profile } = useOrb();
  const group = useRef<Group>(null);
  const arcs = useLineLayer(
    () =>
      buildArcs({
        count: profile.outerArcs,
        seed: SEED + 31,
        radii: [1.75, 2.25],
        length: [15, 110],
        lineCount: [1, 3],
        pushProbability: 0.22,
        pushRange: [0.1, 0.35],
        tickProbability: 0.3,
        kind: 0.3,
        facing: 0.6,
      }),
    "OUTER",
    { width: 1.1, base: 0.55, revealStart: 0.3 },
    [profile.outerArcs],
  );
  const traces = useMemo(
    () =>
      buildCircuitTraces({
        traces: profile.outerTraces,
        seed: SEED + 41,
        octaves: profile.noiseOctaves,
        shells: [1.78, 1.95, 2.12],
        shellWeights: [0.35, 0.4, 0.25],
        busFraction: 0.1,
        pushProbability: 0.34,
        pushRange: [0.1, 0.38],
        stepRange: [1.5, 4],
        kindBase: 0.4,
      }),
    [profile.outerTraces, profile.noiseOctaves],
  );
  const outer = useLineLayer(() => ({ geometry: traces.lines.build(), segments: traces.segments }), "OUTER", { width: 1.05, base: 0.58, revealStart: 0.3 }, [traces]);
  const nodes = useMemo(() => traces.nodes.slice(0, Math.round(profile.circuitNodes * 0.35)), [traces, profile.circuitNodes]);

  useFrame(() => {
    const l = live.current;
    const g = group.current;
    if (!g) return;
    g.rotation.set(-0.18, -l.outerAngle, 0.14 + Math.sin(l.outerAngle * 0.7) * 0.03);
    arcs.material.uniforms.uOpacity!.value = 1 - 0.3 * l.outerReduce;
  });

  return (
    <group ref={group} name="FragmentGroup">
      <mesh name="BrokenArcs" geometry={arcs.geometry} material={arcs.material} frustumCulled={false} renderOrder={2} />
      <mesh name="TechnicalPanels" geometry={outer.geometry} material={outer.material} frustumCulled={false} renderOrder={2} />
      <CircuitNodes nodes={nodes} revealStart={0.35} />
      <FloatingDataFragments plates={plates} revealStart={0.3} />
    </group>
  );
}
