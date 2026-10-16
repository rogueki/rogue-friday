import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mediaLooksValid, renderContentVideo } from "../src/services/content-studio-media";

const ffmpeg = process.env.FRIDAY_FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FRIDAY_FFPROBE_PATH || "ffprobe";
const available = spawnSync(ffmpeg, ["-version"], { windowsHide: true }).status === 0 &&
  spawnSync(ffprobe, ["-version"], { windowsHide: true }).status === 0;
const dir = mkdtempSync(join(tmpdir(), "friday-content-render-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(binary: string, args: string[]): void {
  const result = spawnSync(binary, args, { windowsHide: true, encoding: "utf8", timeout: 30_000 });
  expect(result.status, result.stderr).toBe(0);
}

describe.skipIf(!available)("local Content Studio rendering with real FFmpeg", () => {
  it.each(["png", "jpg"])("renders a real %s image and MP3 as square MP4 with audio", async (extension) => {
    const image = join(dir, `source.${extension}`);
    const visual = join(dir, `visual-${extension}.bin`);
    const voice = join(dir, `voice-${extension}.mp3`);
    const output = join(dir, `artifact-${extension}.mp4`);
    run(ffmpeg, ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1", "-frames:v", "1", "-y", image]);
    run(ffmpeg, ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-y", voice]);
    copyFileSync(image, visual);
    expect(mediaLooksValid("image", readFileSync(visual))).toBe(true);
    await renderContentVideo({ kind: "image", aspectRatio: "1:1", visualPath: visual, voicePath: voice, outputPath: output, ffmpegPath: ffmpeg });
    const result = spawnSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", output], { encoding: "utf8", windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    const streams = (JSON.parse(result.stdout) as { streams: Array<{ codec_type: string; width?: number; height?: number }> }).streams;
    expect(streams).toEqual(expect.arrayContaining([{ codec_type: "video", width: 1080, height: 1080 }, { codec_type: "audio" }]));
  });

  it("loops a short source video under full speech and renders a vertical Story", async () => {
    const source = join(dir, "source.mp4");
    const visual = join(dir, "vertical-visual.bin");
    const voice = join(dir, "vertical-voice.mp3");
    const output = join(dir, "vertical-artifact.mp4");
    run(ffmpeg, ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", source]);
    run(ffmpeg, ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-y", voice]);
    copyFileSync(source, visual);
    expect(mediaLooksValid("video", readFileSync(visual))).toBe(true);
    await renderContentVideo({ kind: "video", aspectRatio: "9:16", visualPath: visual, voicePath: voice, outputPath: output, ffmpegPath: ffmpeg });
    const result = spawnSync(ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", output],
      { encoding: "utf8", windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    const media = JSON.parse(result.stdout) as { streams: Array<{ codec_type: string; width?: number; height?: number }>; format: { duration: string } };
    expect(media.streams).toEqual(expect.arrayContaining([{ codec_type: "video", width: 720, height: 1280 }, { codec_type: "audio" }]));
    expect(Number(media.format.duration)).toBeGreaterThan(1.8);
  });
});
