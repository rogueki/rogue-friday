import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FridayConfig } from "@friday/config";
import { ApiError } from "../util/errors";

export type VoiceModeTarget = "local" | "elevenlabs";

/**
 * Opens the installer window "Sprachbetrieb wechseln". The installer needs administrator rights, which only the person at
 * the PC can grant (UAC), so the Control API only starts the window and never waits for the installation itself.
 */
export class VoiceModeSwitchService {
  private lastStart = 0;
  constructor(private readonly config: FridayConfig, private readonly launch: typeof spawn = spawn,
    private readonly platform: NodeJS.Platform = process.platform, private readonly now: () => number = Date.now) {}

  get root(): string { return resolve(this.config.paths.dataDir, "..", ".."); }
  get script(): string { return join(this.root, "installer", "install-friday-gui.ps1"); }

  async start(target: VoiceModeTarget): Promise<void> {
    if (this.platform !== "win32") {
      throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Der Sprachbetrieb lässt sich nur auf dem Windows-PC mit F.R.I.D.A.Y. wechseln." });
    }
    if (!existsSync(this.script)) {
      throw new ApiError({ code: "ADAPTER_UNAVAILABLE",
        message: "Der Installer fehlt im Installationsordner. Bitte das Dashboard aktualisieren oder F.R.I.D.A.Y. neu installieren." });
    }
    // A second click while Windows still shows the UAC prompt would open a second installer window.
    if (this.now() - this.lastStart < 60_000) {
      throw new ApiError({ code: "CONFLICT", message: "Das Installationsfenster wurde gerade geöffnet. Bitte die Windows-Abfrage am PC bestätigen." });
    }
    const child = this.launch("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", this.script,
      "-ChangeVoice", "-ResumeRoot", this.root, "-VoiceTarget", target], { cwd: this.root, detached: true, stdio: "ignore", windowsHide: true });
    await new Promise<void>((resolveStart, rejectStart) => {
      child.once("spawn", () => resolveStart());
      child.once("error", (error) => rejectStart(new ApiError({ code: "ADAPTER_UNAVAILABLE",
        message: "Das Installationsfenster konnte nicht geöffnet werden.", cause: error })));
    });
    child.unref();
    this.lastStart = this.now();
  }
}
