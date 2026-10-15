# Dashboard Art-Direction Brief (input for `@friday/design-tokens`, `@friday/ui`, `apps/web`)

Binding sources: `docs/PLAN.md` §14, §24–27 and `design-references/jarvis_dashboard_reference.webp`.
Open the reference image and keep comparing. Goal: same visual family, not a pixel copy.

## Observed visual grammar of the reference

1. **Canvas**: near-black navy (`#01060c` → `#03111d`), soft radial lift behind the central core panel,
   a very fine dot/coordinate grid (~24 px pitch, alpha ~0.05), occasional thin horizontal HUD hairlines.
2. **Panels**: dark translucent navy body; 1 px cyan border at ~0.25–0.45 alpha; a second inner hairline
   offset 3–4 px on some edges; **cut corners** (top-left and bottom-right chamfers 8–12 px); short bright
   corner brackets (6–10 px L-shapes) at 1–2 corners; header row = small uppercase Oxanium title with
   letter-spacing 0.14–0.2em in cyan-white, optional right-aligned "View All ›" link or LIVE pill.
3. **List rows inside panels** ("AI Core Overview", "Quick Commands", feed rows): each row is its own thin
   bordered box (alpha ~0.18) with a 28–32 px square **icon tile** on the left (icon tile has tinted
   background + border in the semantic colour: cyan, green, violet, amber, red), title (13–14 px, white),
   sub-line (11–12 px, muted or semantic colour), optional right **tag pill** (INFO cyan, WARN amber,
   TIP green/teal, LIVE green) in 10 px uppercase mono.
4. **Agent cards**: 2–3 column grid of small bordered cards: coloured icon tile, name, status dot + word
   (Active green / Standby amber), and a **mini waveform / activity line** in the card's colour on the right.
5. **Circular metrics** (System Monitor): thick ring gauge (stroke ~6 px), dim track, cyan arc with soft
   glow, label + percent in the centre (mono numerals).
6. **Memory insights**: small constellation graph (dots + thin lines), stats column on the right.
7. **Provider/Model grid**: 3×N small cards, icon tile + name + status word coloured (Connected green /
   Not linked muted).
8. **Left nav**: brand block at top (round logo mark with concentric rings + "F.R.I.D.A.Y." wide-tracked +
   "COMMAND CENTER" small; the reference image still shows the predecessor name "JARVIS"), items 40 px high with 18 px line icons and text; active item = cyan-bordered
   box with subtle inner glow and brighter text; right-aligned **count badges** (small rounded pill,
   dark fill, cyan border). Lower part: "VOICE STATUS" panel with waveform, "Listening…" text and a large
   **circular mic button** with 2–3 concentric glowing rings; below it a "Focus Mode" button.
9. **Top bar**: left a cut-corner frame "SYSTEM STATUS ● OPTIMAL" (status dot + coloured word); centre
   date (small, muted) above a **large cyan clock** (Oxanium ~28 px, tabular); right: search field with
   icon + shortcut hint, square icon buttons (layout, bell with badge, settings) each in a thin bordered
   box, and an operator chip (name + role + round avatar outline).
10. **Bottom command bar**: full width, ~64 px; left small context chips (Location, Weather, Network) each
    icon + label + value; centre a **glowing capsule button** "MIT F.R.I.D.A.Y. SPRECHEN" / status line under it
    ("Ich höre zu…"), flanked by live waveforms and dotted HUD lines that extend left and right; right a
    bordered "Executive Briefing" quick action. Stop/Pause controls live next to the capsule.
11. **Typography**: Oxanium for headings/labels/clock (uppercase, tracked), Inter for content,
    JetBrains Mono for numbers, IDs, tags. Body 13–14 px; dense but every row ≥ 32 px high.
12. **Colour discipline**: 80–85 % navy, 10–15 % cyan lines/interaction, 2–5 % semantic accents.
    Gold/amber appears **only** in and around the AI-core orb panel (and the orb-related voice capsule
    when F.R.I.D.A.Y. speaks). The reference's blue wireframe globe is **replaced** by the golden orb.

## Motion

- Motion (`motion/react`) for panel entrance (opacity + 6 px y, 180–240 ms, stagger 30 ms), drawers
  (slide 260 ms, ease `[0.2, 0.8, 0.2, 1]`), list insertions. Hover = slight border brighten, no scaling jumps.
- Live elements (waveforms, LIVE dot) animate subtly; everything respects `prefers-reduced-motion`
  and the in-app "Animationen: Voll/Reduziert/Aus" setting (`data-motion` attribute on `<html>`).

## Must not

Generic SaaS look (white cards, rounded-2xl shadows, Tailwind default palettes), neon around every
element, glow on body text, heavy backdrop blur everywhere, gold sprinkled over normal panels, the reference
image as background, copied example texts from the reference (e.g. Pakistani location, "Claude/OpenAI"
provider list) — use this project's real modules and German copy.
