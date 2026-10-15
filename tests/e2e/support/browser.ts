import { existsSync } from "node:fs";

/** Headless WebGL (the orb) needs SwiftShader; CLAUDE.md "Umgebung". The Chromium path can be overridden for other machines. */
const CLOUD_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
export const executablePath: string | undefined = process.env.JARVIS_CHROMIUM ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);

export const GL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"];
/** A browser without any WebGL context (PLAN §51.5 "2D fallback"). */
export const NO_GL_ARGS = ["--disable-gpu", "--disable-3d-apis", "--disable-webgl", "--disable-webgl2"];

export const launchOptions = (args: string[] = GL_ARGS) => ({ ...(executablePath ? { executablePath } : {}), args });
