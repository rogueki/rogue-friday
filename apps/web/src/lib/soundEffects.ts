export type DashboardSoundKind = "approval" | "alert";

/** Small opt-in tones for realtime approval requests and open alerts. Browser audio can be unavailable or autoplay-blocked. */
export function playDashboardSound(enabled: boolean, kind: DashboardSoundKind): void {
  if (!enabled || typeof window === "undefined" || typeof window.AudioContext !== "function") return;
  try {
    const context = new window.AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(kind === "approval" ? 520 : 740, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.035, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.14);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => { void context.close(); };
    void context.resume().then(() => {
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.15);
    }).catch(() => { void context.close(); });
  } catch {
    // Sound is optional; browser audio failures must not interrupt dashboard state updates.
  }
}
