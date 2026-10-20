import { browserAudio } from "./browserAudio";

/** One app-wide listener, installed by AppSettingsProvider rather than each voice UI consumer. */
export function installPushToTalkShortcut(configured: string): () => void {
  const parts = configured.split("+");
  const [modifier, key] = parts.length === 2 ? parts : ["", parts[0]];
  if (!key) return () => undefined;
  let held = false;
  const matches = (event: KeyboardEvent) => {
    const correctModifier = modifier ? { Ctrl: event.ctrlKey, Alt: event.altKey, Shift: event.shiftKey, Meta: event.metaKey }[modifier] : true;
    const code = key === "Space" ? "Space" : /^[A-Z]$/.test(key) ? `Key${key}` : /^[0-9]$/.test(key) ? `Digit${key}` : key;
    return correctModifier && event.code === code &&
      Number(event.ctrlKey) + Number(event.altKey) + Number(event.shiftKey) + Number(event.metaKey) === (modifier ? 1 : 0);
  };
  const keydown = (event: KeyboardEvent) => {
    if (!browserAudio.snapshot().available || !matches(event) || event.repeat || held ||
        event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))) return;
    event.preventDefault();
    held = true;
    if (browserAudio.snapshot().active) browserAudio.pushToTalkStart();
    else void browserAudio.start().then(() => {
      if (held) browserAudio.pushToTalkStart();
      else browserAudio.pushToTalkRelease();
    }).catch(() => { held = false; });
  };
  const keyup = (event: KeyboardEvent) => {
    if (!matches(event) || !held) return;
    event.preventDefault();
    held = false;
    browserAudio.pushToTalkRelease();
  };
  const blur = () => { if (held) { held = false; browserAudio.pushToTalkRelease(); } };
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", blur);
    blur();
  };
}
