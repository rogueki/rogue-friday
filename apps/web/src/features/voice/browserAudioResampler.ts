/** Streaming box integration attenuates frequencies above speech bandwidth before reducing to 16 kHz. */
export class BrowserAudioResampler {
  private sum = 0;
  private weight = 0;
  private readonly sourceStep: number;

  constructor(sourceRate: number) {
    if (!Number.isFinite(sourceRate) || sourceRate < 16_000 || sourceRate > 192_000) throw new Error("Ungültige Audio-Abtastrate.");
    this.sourceStep = 16_000 / sourceRate;
  }

  push(input: Float32Array): number[] {
    const output: number[] = [];
    for (const raw of input) {
      const sample = Math.max(-1, Math.min(1, raw));
      let remaining = this.sourceStep;
      while (remaining > 1e-8) {
        const part = Math.min(remaining, 1 - this.weight);
        this.sum += sample * part;
        this.weight += part;
        remaining -= part;
        if (this.weight >= 1 - 1e-8) {
          output.push(Math.max(-1, Math.min(1, this.sum / this.weight)));
          this.sum = 0;
          this.weight = 0;
        }
      }
    }
    return output;
  }
}
