---
name: kolosal-design
description: Use this skill to generate well-branded interfaces and assets for Kolosal AI, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

Core files:
- `README.md` — brand voice, visual foundations, iconography, caveats
- `colors_and_type.css` — drop-in CSS vars + utility classes
- `assets/logos/` — SVG wordmarks (black on white, white on dark)
- `assets/ornaments/` — brand SVG ornaments (e.g. `developers-underline.svg`)
- `assets/favicon/` — favicons (PNG + ICO)
- `ui_kits/website/` — working HTML/JSX recreations of kolosal.ai

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. Load Remix Icon (v4.7) from `https://cdn.jsdelivr.net/npm/remixicon@4.7.0/fonts/remixicon.css` — it is a first-class dependency; do not substitute Lucide/Heroicons. Do not use emoji or unicode arrows. Use IBM Plex Mono for display headlines, Inter for UI/body, Geist Mono for eyebrows and data labels.

If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.
