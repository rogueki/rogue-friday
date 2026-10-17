import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh, ShaderMaterial } from "three";
import { useMaterial } from "../hooks";
import { makeSweepMaterial, makeVoiceRingMaterial, type SweepMode, type VoiceRingMode } from "../materials";
import { useOrb } from "../OrbContext";
import { BILLBOARD } from "./core";

/** Half size (orb units) of the effect billboards; rings never exceed the nominal visible radius. */
const HALF = 3.0;

function useFacing(mesh: React.RefObject<Mesh | null>) {
  const camera = useThree((s) => s.camera);
  return () => {
    if (mesh.current) mesh.current.quaternion.copy(camera.quaternion);
  };
}

/** One billboard of the VoiceReactionGroup / attention rings; hidden (no draw call) while its amount is ~0. */
function VoiceRing({
  mode,
  name,
  amount,
  update,
}: {
  mode: VoiceRingMode;
  name: string;
  amount: (l: ReturnType<typeof useOrb>["live"]["current"]) => number;
  update: (material: ShaderMaterial, l: ReturnType<typeof useOrb>["live"]["current"]) => void;
}) {
  const { live, shared } = useOrb();
  const mesh = useRef<Mesh>(null);
  const face = useFacing(mesh);
  const material = useMaterial(() => makeVoiceRingMaterial(mode, shared, HALF), [mode, shared]);
  useFrame(() => {
    const l = live.current;
    face();
    const m = mesh.current;
    if (m) m.visible = amount(l) > 0.006;
    update(material, l);
  });
  return <mesh ref={mesh} name={name} geometry={BILLBOARD} material={material} scale={[HALF * 2, HALF * 2, 1]} frustumCulled={false} renderOrder={4} />;
}

/**
 * VoiceReactionGroup: InputWaveRing (microphone, opens from the core), OutputWaveRing (TTS), RadialPulseRings (audio peaks),
 * plus the approval focus ring and the degraded-operation warning pulse that share the same ring shader.
 */
export function VoiceReactionGroup() {
  return (
    <group name="VoiceReactionGroup">
      <VoiceRing
        mode="INPUT"
        name="InputWaveRing"
        amount={(l) => l.waveIn * (0.05 + l.gainIn)}
        update={(m, l) => {
          const u = m.uniforms;
          u.uOpen!.value = l.waveIn * Math.min(1, 0.05 + l.gainIn);
          u.uLevel!.value = l.inRms;
          u.uWaveBands!.value.set(l.inLow, l.inMid, l.inHigh, l.inPeak);
        }}
      />
      <VoiceRing
        mode="OUTPUT"
        name="OutputWaveRing"
        amount={(l) => l.waveOut * (0.05 + l.gainOut)}
        update={(m, l) => {
          const u = m.uniforms;
          u.uOpen!.value = l.waveOut * Math.min(1, 0.05 + l.gainOut);
          u.uLevel!.value = l.outRms;
          u.uWaveBands!.value.set(l.outLow, l.outMid, l.outHigh, l.outPeak);
        }}
      />
      <VoiceRing
        mode="RADIAL"
        name="RadialPulseRings"
        amount={(l) => l.radialPulse}
        update={(m, l) => {
          m.uniforms.uPulseAge!.value = l.radialAge;
          m.uniforms.uPulseAmp!.value = l.radialAmp;
        }}
      />
      <VoiceRing mode="FOCUS" name="ApprovalFocusRing" amount={(l) => l.focus * l.approval} update={(m, l) => void (m.uniforms.uAmt!.value = l.focus * l.approval)} />
      <VoiceRing mode="WARN" name="WarningPulseRing" amount={(l) => l.warnPulse * l.warning} update={(m, l) => void (m.uniforms.uAmt!.value = l.warnPulse * l.warning)} />
    </group>
  );
}

function Sweep({ mode, name, amount }: { mode: SweepMode; name: string; amount: (l: ReturnType<typeof useOrb>["live"]["current"]) => number }) {
  const { live, shared } = useOrb();
  const mesh = useRef<Mesh>(null);
  const face = useFacing(mesh);
  const material = useMaterial(() => makeSweepMaterial(mode, shared, HALF), [mode, shared]);
  useFrame(() => {
    const l = live.current;
    face();
    const a = amount(l);
    material.uniforms.uAmt!.value = a;
    if (mesh.current) mesh.current.visible = a > 0.006;
  });
  return <mesh ref={mesh} name={name} geometry={BILLBOARD} material={material} scale={[HALF * 2, HALF * 2, 1]} frustumCulled={false} renderOrder={3} />;
}

/** RadialScan (transcribing), AnalysisSweep (thinking) and the syncing sweep rings. HorizontalScan lives in signals.tsx. */
export function ScanSweeps() {
  return (
    <group name="ScanSweeps">
      <Sweep mode="RADIAL" name="RadialScan" amount={(l) => l.radialScan} />
      <Sweep mode="ANALYSIS" name="AnalysisSweep" amount={(l) => l.analysisSweep} />
      <Sweep mode="SYNC" name="SyncSweepRings" amount={(l) => l.syncSweep} />
    </group>
  );
}
