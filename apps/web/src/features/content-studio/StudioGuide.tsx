import { HudPanel } from "@friday/ui";

const voiceTools = [
  ["ElevenLabs", "Deutsches Voiceover und eigene Stimmen. Im Media-Workshop kann eine verbundene ElevenLabs-Stimme erzeugt werden.", "https://elevenlabs.io"],
  ["HeyGen", "Sprechende Porträts und Lipsync als externer Produktionsschritt.", "https://www.heygen.com"],
  ["CapCut Text-to-Speech", "Schnelle Entwurfsstimme direkt im Schnittprojekt.", "https://www.capcut.com"],
  ["Murf.ai", "Alternative für Business-Voiceover und Betonungsvarianten.", "https://murf.ai"],
  ["Play.ht", "Weitere Stimmen und Sprachen zum Vergleichen.", "https://play.ht"],
  ["D-ID", "Alternative für sprechende Bilder und Avatare.", "https://www.d-id.com"],
] as const;
const videoTools = [
  ["CapCut", "Optionale Nachbearbeitung. Der automatische F.R.I.D.A.Y.-Schnitt nutzt lokal FFmpeg, da keine verifizierte CapCut-Schnitt-API angebunden ist.", "https://www.capcut.com"],
  ["Kling AI", "Bild-zu-Video-Clips für bewegte Szenen.", "https://klingai.com"],
  ["Higgsfield", "Kamerabewegungen und visuelle Effekte.", "https://higgsfield.ai"],
  ["Canva", "Grafiken, Thumbnails und Karussell-Slides.", "https://www.canva.com"],
  ["Runway", "Videobearbeitung und generative Clips.", "https://runwayml.com"],
] as const;
const formats = [
  ["Instagram Reel / Story", "1080 × 1920 · 9:16", "Vertikales Video; Text und Untertitel innerhalb der sicheren Anzeigefläche halten.", "05_Export/Instagram-Reels bzw. Instagram-Stories"],
  ["Instagram Feed / Karussell", "1080 × 1350 · 4:5", "Bild oder Slides; Darstellung vor Upload auf dem Zielgerät prüfen.", "05_Export/Instagram-Posts"],
  ["Facebook Reel / Story", "1080 × 1920 · 9:16", "Vertikales Video; Facebook-Ziel separat prüfen.", "05_Export/Facebook"],
  ["LinkedIn Video", "1920 × 1080 · 16:9 oder 1080 × 1080 · 1:1", "Untertitel und Vorschaubild vorbereiten.", "05_Export/LinkedIn"],
  ["LinkedIn Bild / Karussell", "1080 × 1350 · 4:5 bzw. PDF-Slides", "Slides als Dokument vorbereiten; Veröffentlichung erst nach verbundener Zielplattform.", "05_Export/LinkedIn"],
  ["TikTok Video", "1080 × 1920 · 9:16", "Vertikalen Export und Einblendungen in der App prüfen.", "05_Export/TikTok"],
  ["YouTube Short", "1080 × 1920 · 9:16", "Vertikalen Export und Titel vorbereiten.", "05_Export/YouTube-Shorts"],
  ["YouTube Video", "1920 × 1080 · 16:9", "Thumbnail, Beschreibung und Kapitel separat vorbereiten.", "05_Export/YouTube"],
] as const;
const workflow = [
  ["Rohmaterial", "Fotos und Clips nach 01_Rohmaterial legen und bei Bedarf in Canva aufbereiten."],
  ["KI-Clips", "Optional einen bewegten Clip mit Kling, Higgsfield oder HeyGen erzeugen und in 03_KI-Clips ablegen."],
  ["Stimme", "Voiceover erzeugen oder aufnehmen und in 02_Stimmen sichern. Die Tonspur vor dem Feinschnitt festlegen."],
  ["Schnitt", "F.R.I.D.A.Y. fügt Clips, Stimme und Untertitel im Zielformat lokal zusammen. CapCut bleibt für optionale Nachbearbeitung."],
  ["Export", "Finaldatei prüfen und für die automatische Veröffentlichung vormerken. Ohne verbundenes Zielkonto bleibt sie unveröffentlicht."],
] as const;

function ToolGrid({ items }: { items: typeof voiceTools | typeof videoTools }) {
  return <div className="cs-guide-grid">{items.map(([name, description, url]) =>
    <article className="cs-guide-card" key={name}><h3>{name}</h3><p>{description}</p><a href={url} target="_blank" rel="noopener noreferrer">Anbieter öffnen <span className="sr-only">(neuer Tab)</span></a></article>)}</div>;
}

export function StudioGuide() {
  return <section className="cs-guide" aria-label="Produktionsleitfaden">
    <HudPanel title="Stimmen-Tools"><ToolGrid items={voiceTools} /></HudPanel>
    <HudPanel title="Video-KI und Schnitt"><ToolGrid items={videoTools} /></HudPanel>
    <HudPanel title="Format-Cheatsheet"><div className="cs-table-scroll"><table className="cs-guide-table"><thead><tr><th>Plattform / Format</th><th>Arbeitsformat</th><th>Hinweis</th><th>Export-Ordner</th></tr></thead><tbody>{formats.map(([name, size, hint, folder]) => <tr key={name}><th scope="row">{name}</th><td>{size}</td><td>{hint}</td><td><code>{folder}</code></td></tr>)}</tbody></table></div><p className="cs-guide-note">Arbeitsformate als Vorlage; aktuelle Upload-Vorgaben vor dem Veröffentlichen auf der Plattform prüfen.</p></HudPanel>
    <HudPanel title="Standard-Workflow"><ol className="cs-workflow">{workflow.map(([title, detail]) => <li key={title}><strong>{title}</strong><span>{detail}</span></li>)}</ol></HudPanel>
    <div className="cs-guide-bottom"><HudPanel title="Ordnerstruktur"><div className="cs-folders"><p><code>Content-Studio/</code></p><ul><li><code>01_Rohmaterial/</code> · Fotos und Videos</li><li><code>02_Stimmen/</code> · Voiceover und Aufnahmen</li><li><code>03_KI-Clips/</code> · generierte Clips</li><li><code>04_Projekte-CapCut/</code> · bearbeitbare Projekte</li><li><code>05_Export/</code> · LinkedIn, Instagram, Facebook, TikTok und YouTube</li><li><code>06_Vorlagen/</code> · wiederverwendbare Designs</li></ul></div></HudPanel><HudPanel title="Qualitätsregeln"><ul className="cs-quality"><li>Hook und Aussage direkt zu Beginn sichtbar machen.</li><li>Untertitel auf Lesbarkeit, Timing und sicheren Bildbereich prüfen.</li><li>Voiceover vor dem Feinschnitt festlegen.</li><li>Format, Ton, Rechte und finalen Export vor dem Upload prüfen.</li><li>Jede Zielplattform in der Vorschau kontrollieren.</li></ul></HudPanel></div>
  </section>;
}
