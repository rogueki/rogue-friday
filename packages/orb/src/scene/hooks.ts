import { useEffect, useMemo, type DependencyList } from "react";
import type { BufferGeometry, ShaderMaterial } from "three";
import type { BuiltLines } from "./geometry/structures";
import { makeLineMaterial, type LineMaterialOptions, type LineRole } from "./materials";
import { useOrb } from "./OrbContext";
import { registerStat } from "./stats";

/** Builds geometry once per dependency change and disposes it afterwards (geometry is never rebuilt on state change). */
export function useGeometry<T extends BufferGeometry>(build: () => T, deps: DependencyList): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are supplied by the caller on purpose
  const geometry = useMemo(build, deps);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

export function useMaterial<T extends ShaderMaterial>(make: () => T, deps: DependencyList): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are supplied by the caller on purpose
  const material = useMemo(make, deps);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

export function useLineLayer(
  build: () => BuiltLines,
  role: LineRole,
  options: LineMaterialOptions,
  deps: DependencyList,
): { geometry: BuiltLines["geometry"]; material: ShaderMaterial; segments: number } {
  const { shared } = useOrb();
  const built = useMemo(build, deps); // eslint-disable-line react-hooks/exhaustive-deps -- see above
  useEffect(() => () => built.geometry.dispose(), [built]);
  useEffect(() => registerStat("segments", built.segments), [built]);
  const material = useMaterial(() => makeLineMaterial(role, shared, options), [shared, role]);
  return { geometry: built.geometry, material, segments: built.segments };
}
