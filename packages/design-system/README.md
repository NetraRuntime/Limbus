# Kolosal AI — Design System

Kolosal AI is a **code-native AI engineer** that modernizes codebases, ships
features, analyzes data, and automates developer workflows — **locally or in
your own cloud**. The flagship positioning, taken straight from the marketing
site and Figma, is:

> **The AI Software Engineer — for Developers**
> Be first to market, not first to apologize. Automate the slow parts of
> software development.

The product is open-source-core, with optional Pro and Enterprise components,
and is built around **Bring-Your-Own-Cloud (BYOC)** — customers keep their
data, costs and compliance inside AWS / GCP / Azure / on-prem. Inference runs
on any OpenAI-compatible or GGUF-compatible model (Llama, Qwen, Gemma,
Mistral, Phi, GPT-OSS, etc.) on CPU or single/multi-GPU.

This design system is the **canonical reference** for building interfaces,
slides, docs and mocks that feel like Kolosal. Everything here is derived
from the real Figma file + production codebase, not invented.

---

## Sources

All assets and rules in this folder were ported from three sources shipped
by the Kolosal team:

| Source                                         | Path / Link                                                  | Role                                           |
|------------------------------------------------|--------------------------------------------------------------|-----------------------------------------------|
| Figma — "Kolosal Website"                      | Mounted `.fig` — 3 pages, 43 frames                          | Visual source of truth (homepage redesign)     |
| Production website (vanilla JS + SCSS + Vite)  | `kolosal-website-ba9d73f2b3b617187d2d3b27330152b349bd423a/`   | Shipped tokens, components, copy, behaviors    |
| Component library (Storybook, shared)          | `kolosal-library-vanilla-main/`                               | Subset of the same tokens, in a cleaner repo   |

The Figma file shows the **next iteration** of the homepage (big IBM Plex
Mono display headline, hand-drawn "Developers" underline). The production
site uses the same tokens but still runs the previous Inter-Medium headline.
Both are documented below; the Figma display treatment is the direction.

Live product surfaces: `https://kolosal.ai` (marketing), `https://app.kolosal.ai`
(web app), `https://api.kolosal.ai/docs` (API docs), GitHub `KolosalAI`.

---

## Index

Root files:

- `README.md` — this document
- `colors_and_type.css` — all color + type tokens as CSS custom properties + utility classes
- `SKILL.md` — Agent-Skill manifest so this folder works inside Claude Code

Folders:

- `assets/` — logos (SVG), favicons, ornament SVGs ripped from Figma
- `fonts/` — (empty — all three typefaces are loaded from Google Fonts; see Typography)
- `preview/` — small HTML cards that populate the Design System tab (colors, type, components, slides)
- `ui_kits/website/` — hi-fi recreation of kolosal.ai marketing site (Header, Hero, Footer, FAQ, Model list, …)

---

## Content fundamentals

**Voice.** Confident, developer-to-developer. Short sentences, strong verbs,
measurable claims. The site never tries to sell a vibe; it sells control:
*"Build faster, cheaper, and more scalable with full privacy control."*

**Casing.**
- Headings use sentence case: *"From idea to impact"*, *"How Kolosal works"*,
  *"Frequently asked questions"*.
- All-caps is reserved for mono eyebrows (`STEP 1`, `READ ONLY`,
  `MODERNIZATION`, `FRAUD ANALYSIS`, `COMING SOON`) — never body copy.
- Buttons: sentence case (`Download`, `Register`, `See All`).

**Pronouns.** Second person "you / your" dominates; first-person "we" only
appears on About / Career pages (*"What drives us to build Kolosal"*,
*"Help build full AI automation for the world's infrastructure"*). Never "I".

**Tone examples (verbatim from the site):**

- Hero sub: *"Run autonomous AI executing end-to-end tasks on your servers with cloud-level performance and zero privacy compromise."*
- Feature pitch: *"Ship MVPs and test ideas in days, not months."*
- Feature pitch: *"Cut legacy cost, simplify migration, and reduce risk."*
- Empty-state explainer: *"Inspects your code, requirements or schema, then generates a concrete plan."*
- FAQ: *"The core is open source. Optional Pro and Enterprise components (advanced orchestration and controls) are available for teams."*

**Rhetorical shape.** Tight rule-of-three ("modernizes, ships, analyzes,
automates"); rhetorical contrast ("locally, or in your cloud"; "first to
market, not first to apologize"); and the occasional dry quip rather than
punctuation-heavy marketing.

**Emoji.** None. Ever. The codebase has zero emoji in copy, buttons, or
marketing. Iconography is always a Remix Icon glyph or an SVG ornament.

**Asterisks / footnotes.** Used sparingly for roadmap status, e.g.
*"CLI, desktop\*, and web\*"* where starred items are coming-soon.

**Numbers / units.** Prices shown as `$0.60` / `$2.20` per million tokens;
memory as `20.9 GB`, `302.5 GB`; metrics in mono. Shell commands read as real
commands (`curl -L https://kolosal.ai/install.sh | bash`).

**Vibe one-liner.** *Calm, technical, competent. It should feel like a
well-documented CLI flag — not a product launch.*

---

## Visual foundations

### Color

The palette is intentionally restrained: a **near-black + 5 greys + bright
blue accent**, plus full semantic scales for success / danger / warning /
info. See `colors_and_type.css` for the full ramp.

| Role                     | Token / value                                               | Where it's used                                                  |
|--------------------------|-------------------------------------------------------------|------------------------------------------------------------------|
| Primary text / button bg | `--color-text-900` `#0D0E0F`                                | Body text, `.btn-primary`, dark footer gradient                  |
| Secondary text           | `--color-text-700` `#6A6F73`                                | Descriptions, eyebrows                                           |
| Placeholder / tertiary   | `--color-text-600` `#9C9FA1`                                |                                                                  |
| Brand accent             | `--color-information-500` `#0066F5`                         | "Developers" highlight, `.btn-secondary`, links, dots            |
| Success                  | `--color-success-500` `#3ABC3F`                             | Active step dot (scroll-triggered), "READ ONLY" lock             |
| Danger                   | `--color-danger-500` `#FF3131`                              | Destructive only                                                 |
| Warning                  | `--color-warning-500` `#FFA931`                             |                                                                  |
| Page background          | `--color-neutral-white` `#FFFFFF`                           | Almost everything                                                |
| Section fill             | `--color-grey-500` `#F8F9F9`                                | Model section "paper" with `1px` dot grid                        |
| Divider / card border    | `--color-grey-700`/`-800`/`-900`                            | 1px borders, 1px dividers                                        |

There is **no broad use of color tints or gradients in the body** — the only
gradient on the live site is (1) the animated `#0D0E0F → #FF3131 → #0066F5`
primary-button hover and (2) the animated dark-grey radial-gradient footer.

### Typography

Three faces, all open-source, all currently loaded from Google Fonts
(`fonts/` is intentionally empty — see Caveats):

1. **Inter** — UI and body. Weights 400 (regular) / 500 (medium). Sizes
   12 / 14 / 16 / 18 / 20 / 24 / 28 / 32 / 36 / 40 / 48 / 56 px. Always
   paired with mild negative tracking (`-0.2` to `-0.6px`). Loaded from
   Google Fonts.
2. **Space Mono** (self-hosted, `fonts/SpaceMono-*.ttf`) — the single
   monospace family for the brand. Used for three purposes:
   - **UI mono** (eyebrows like `STEP 1`, data labels, the command pill,
     FAQ titles, prices). Weight 400, sizes 12–24 px, tracking `-0.4` to `-0.8px`.
   - **Display** (hero headline). Weight 700, sizes 40–72 px, tracking
     `-2` to `-3px`. *There is no 500 weight—use 700 for all display.*
   - **Code** snippets inside windows and cmd-pills. Weight 400.
3. **Caveat** (self-hosted, `fonts/Caveat-*.ttf`) — accent font for
   **highlighted words** inside display and section headings. Weights
   400 / 500 / 600 / 700, upright only (no italic variants supplied).
   Used at 400 (Regular), no tracking, line-height 0.9, rendered ~1.1–1.15×
   of surrounding text to optically match. Always paired with `--accent`
   color and the brush-stroke underline ornament. Use sparingly — one
   accent word per heading, max.

Typical pairings:

- Hero: Space Mono 700 48–56px (display) + Inter 14 regular (sub).
- Section: Inter 32 medium (heading) + Inter 14 regular (sub).
- Card: Inter 18 medium (title) + Inter 14 regular (body).
- Eyebrow above section: Space Mono 14 regular, uppercase not required — the
  mono family alone is the signal.

### Spacing & layout

- Container: `max-width: 1080px`, `20px` side gutters.
- Grids: `.point-list` uses 4-col at desktop → 2-col at 768 → 1-col at 512.
- **Section rhythm is aggressive**: 200px top+bottom between major sections
  (`$spacing-section`). Hero top margin is 160px.
- 8-pt spacing scale with 4-pt exceptions for inline icon/text gaps.
- Breakpoints: 1441 / 1440 / 1280 / 1024 / 932 / 768 / 512 / 375.

### Radii

Everything is pill-rounded but *not* "fully rounded":

| Component                  | Radius  |
|----------------------------|---------|
| `btn-xs`, chip             | 6 px    |
| `btn-sm`, input-sm         | 8 px    |
| `btn-md`, input-md         | 10 px   |
| `btn-lg`, input-lg, hero-ornament-ui | 12 px |
| Card (model-list-item)     | 16 px   |
| Step card                  | 20 px   |
| Hero video frame, footer   | 24 px   |

### Shadows

Four recurring shadows — no Material-style elevation scale.

```
input focus:  0 3px 4px -4px  rgb(0 0 0 / .15)        + 2px inset highlight on primary buttons
card-sm:      0 12px 12px -16px rgb(0 0 0 / .25)      model rows
card-md:      0 12px 48px -24px rgb(0 0 0 / .25)      "how it works" step cards
hero-ornament:0 32px 40px -32px rgb(0 0 0 / .65)      hero mini-UI over the video
submenu:      0 20px 24px -8px  rgb(0 0 0 / .15)      header dropdown
```

Primary buttons always carry `inset 0 2px 0 rgba(255,255,255,.25)` as a
subtle glass-highlight — a signature detail.

### Backgrounds & textures

- **Page**: solid white. No wallpapers, no gradient meshes.
- **"Model collections" section**: a large light-grey panel
  (`#F8F9F9` + `1px` border `#EBEDEE`) with a **16-px dot grid** drawn with
  `radial-gradient(#E4E7E9 1px, transparent 1px) 0 0 / 16px 16px`. This is
  the one "technical blueprint" texture the brand uses.
- **Footer**: `#0D0E0F` with two faint white radial highlights (20/20 and
  80/80) + a linear tone, slowly animating across `200% × 200%` at 6 s ease.
- **Hero ornament**: a looping MP4 video clamped to `524 × 280px`, wrapped
  in a 24px-rounded frame with a 12px white card (the mini composer UI)
  floated over it with the `hero-ornament` shadow.
- **Footer waveform (Figma only)**: a dense indigo particle waveform on the
  homepage footer, shipped as an exported PNG ornament.

### Animation

All stock, CSS-driven. No JS animation library.

- Entry: `slide-up`, `slide-left`, `slide-right`, `opacity` keyframes, 0.8s
  ease. Triggered via `IntersectionObserver(threshold: 0.4)` adding an
  `.animation` class. Sequential siblings stagger by `+0.1s`/`+0.2s`.
- Scroll-driven micro: `.how-list-item .ornament-icon-grey` flips from grey
  to green (`popActive` 0.6s) when its center enters a `±100px` band around
  the viewport midline.
- Gradient-sweep on `.btn-primary:hover` (3s infinite) — the *only* moment
  of "color".
- FAQ: `max-height` + `opacity` 0.6s ease; `+` icon rotates 45°.
- Everything else is instant.

### Hover / press

- **btn-primary**: animated gradient sweep (see above).
- **btn-secondary / btn-danger**: step *down* to the `-600` tone of that
  scale. No brightness changes.
- **btn-outline**: border strengthens from `grey-800` → `grey-900`, shadow
  removed.
- **btn-ghost**: fill appears (`grey-600`).
- **Inputs**: border goes `grey-900` → `text-500` on hover, shadow disappears;
  focus = `text-600` border + `2px grey-800` ring.
- **Cards** (FAQ): gain a 1px `grey-700` outline ring.
- **Links in menu**: background `grey-500` fills the 8px-rounded pad; no
  color change.
- **No press states** are explicitly defined — the 0-duration transition +
  `cursor:pointer` is the whole interaction.

### Borders, dividers, transparency

- 1px is the only border weight. `grey-700` / `-800` / `-900` are the three
  weights of "quiet line".
- Vertical divider in header: `height:16px; border-right:1px solid grey-900;
  margin:0 8px`. This mini-divider shows up next to the logo.
- Transparency is used rarely — white `/.25` on button highlights, white
  `/.1` on footer radials, black `/.15–.65` on shadows.
- **No backdrop-blur anywhere** in the shipped code.

### Cards

A "card" in Kolosal is *white on white*: no shadow by default, 1px grey
border only when hover reveals it, 16–20 px radius.

- Model row (`.model-list-item`): white bg, 16px radius, `card-sm` shadow,
  horizontal layout, price columns right-aligned.
- Step card (`.how-list-item .text`): white bg, 20px radius, `card-md`
  shadow, max-width 400px.
- FAQ (`.faq-list-item`): outer is `grey-500` wrapper with 8px padding;
  opens into a white inner card with 10px radius.

### Motifs unique to Kolosal

- **Hand-drawn SVG underline** on the hero word *Developers* — rough
  brush-style stroke in `#0066F5` (`assets/ornaments/developers-underline.svg`).
- **Mono-label + sentence-heading** pairings
  (`STEP 1` / "Install & open your project").
- **Thin vertical dividers** between step cards (`how-list-gap` — a `1px
  solid grey-900` line, 124 px tall).
- **Animated command pill** in the hero: rotates through `curl …`,
  `Kolosal used for → Web Development` with a check.
- **Dot-grid panel** behind the Model section.
- **Live GitHub star count** badge in the header ("We're open source").

---

## Iconography

The site is 100 % **Remix Icon v4.5/v4.7** loaded from
`https://cdn.jsdelivr.net/npm/remixicon@4.7.0/fonts/remixicon.css`. Icons
are rendered as `<i class="ri-{name}-line">` — always line-style by default;
filled variants (`-fill`) appear on socials in the footer.

Typical sizes (from `button.scss`):

| Button size | Icon font-size |
|-------------|----------------|
| `btn-xs`    | 14 px          |
| `btn-sm`    | 16 px          |
| `btn-md`    | 20 px          |
| `btn-lg`    | 24 px          |

Icons reused repeatedly across the marketing site:

- `ri-arrow-right-s-line`, `ri-arrow-down-s-line`, `ri-arrow-up-line`
- `ri-git-branch-line`, `ri-database-2-line`, `ri-cpu-line`, `ri-rocket-line`
- `ri-check-line`, `ri-add-line`, `ri-close-line`
- `ri-file-copy-line`
- `ri-lock-2-line`
- `ri-github-fill`, `ri-instagram-line`, `ri-threads-line`, `ri-linkedin-fill`
- `ri-menu-line`

**Rule: always use Remix Icon line-style at 1em for inline text icons.** Do
not substitute Lucide, Heroicons, Phosphor, etc. — Remix Icon is a first-
class dependency and its specific silhouettes (e.g. `cpu-line`) are in brand
voice.

Custom SVG marks:

- `assets/logos/kolosal-logo-black.svg` — wordmark on white
- `assets/logos/kolosal-logo-white.svg` — wordmark on dark
- `assets/logos/netra-logo-black.svg`, `netra-logo-white.svg` — Netra
  wordmark (Space Mono 700 text-SVG, for the Header card)
- `assets/ornaments/developers-underline.svg` — brush underline accent,
  always paired with the Caveat accent word in `#0066F5`
- **Brand glyph set** — 9 ornaments in a 24×24 viewBox, all using
  `fill="currentColor"` so CSS drives color. Semantic roles:
  - `sparkle.svg`, `model-library.svg` — AI / quality / model provenance
  - `forbidden.svg`, `cpu.svg`, `stack.svg` — infrastructure & local-first
  - `rocket.svg`, `terminal.svg` — dev tools & shipping
  - `chat-ai.svg`, `search.svg` — retrieval, agent, chat surfaces

**No emoji.** **No unicode characters as UI** (no ⚡, ✨, →, etc.) — the
`ri-arrow-*` set is used for every arrow.

---

## Using this system

1. Drop `colors_and_type.css` into any HTML file to get all tokens + utility
   classes (`.text-32px.medium`, `.mono-14px`, `.eyebrow`, etc.).
2. Load Remix Icon from CDN for glyphs.
3. Use `<img src="assets/logos/kolosal-logo-black.svg">` for the wordmark;
   always pair it with the 16-px vertical divider + a mono 14 tag line
   ("We're open source").
4. See `ui_kits/website/` for working components (Header, Hero, Point grid,
   How steps, Model list, FAQ, Footer) assembled into `index.html`.

---

## Caveats

- **Brand fonts are Space Mono and Caveat** (self-hosted in `fonts/`). The
  design system ships a single mono family for both UI labels AND display
  headlines — this replaces the Figma file's IBM Plex Mono display + Geist
  Mono UI combination with one face. Space Mono has only two weights
  (400 / 700); all display treatments use 700. Caveat has 400–700 upright
  only (no italic).
- **Inter is still loaded from Google Fonts.** If the brand wants fully
  offline bundling, drop Inter woff2 files into `fonts/` and update
  `@import` in `colors_and_type.css`.
- **Two hero headlines exist**: the shipped site uses Inter-40 medium
  ("Full AI automation / your infrastructure"); the Figma shows IBM Plex
  Mono 48 ("The AI Software Engineer — for Developers"). The UI kit
  recreates the **Figma direction** since it is the newer design. Flag
  this before shipping anything else.
- **MP4 hero/step videos** live on `supabase.co` CDN — this design system
  does not re-host them. Assets/videos/ is deliberately omitted.
- **Figma pseudocode**: the JSX is illustrative; exact instance-swap props
  and any per-character styles may drift. Always cross-check against the
  production SCSS tokens for anything pixel-critical.
