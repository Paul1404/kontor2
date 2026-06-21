# Kontor² — Brand Identity

A Kontor was the merchant counting-house of the Hanseatic League. The mark borrows
that heritage: institutional, exact, and built to be trusted with members and money.

---

## Contents

```
Kontor2-Brand/
├── identity-system.html      Full identity overview (open in any browser)
├── svg/                      Vector masters — scale to any size
│   ├── lockup-navy.svg        Primary lockup (light backgrounds)
│   ├── lockup-paper.svg       Primary lockup (dark backgrounds)
│   ├── symbol.svg             K² symbol / app icon
│   ├── symbol-reversed.svg    K² symbol, outline (dark backgrounds)
│   ├── wordmark-navy.svg      Wordmark (light backgrounds)
│   └── wordmark-paper.svg     Wordmark (dark backgrounds)
└── png/                      Ready-to-use raster (transparent background)
    ├── lockup-navy.png / lockup-paper.png
    ├── wordmark-navy.png / wordmark-paper.png
    ├── symbol-1024.png / symbol-512.png / app-icon-1024.png
    └── favicon-64.png / favicon-48.png / favicon-32.png
```

---

## The mark

- **Symbol** — a serif **K²** set in a rounded ink-navy square. It doubles as the app
  icon and holds legibility down to 16 px.
- **Wordmark** — **Kontor** with the “2” as a raised brass superscript: *Kontor²*.
- **Lockup** — symbol + wordmark, separated by one symbol-half of space. This is the
  primary signature; use it wherever space allows.

## Colour

| Role      | Name      | Hex       |
|-----------|-----------|-----------|
| Primary   | Ink Navy  | `#14223D` |
| Accent    | Brass     | `#A6864E` |
| Accent ⊕  | Brass (on dark) | `#C7A872` |
| Surface   | Paper     | `#F6F3EC` |
| Secondary | Slate     | `#5B6472` |

The brass accent is reserved for the superscript “2” and the occasional hairline detail —
never for body text or large fields.

## Typography

- **Spectral** — Medium (500) for the wordmark; Medium/SemiBold for headings.
- **IBM Plex Sans** — Regular/Medium for interface, labels and body copy.

Both are free via Google Fonts.

## Usage

- Keep clear space around the lockup equal to the height of the “K” in the symbol.
- Don’t recolour the mark outside the palette, stretch it, add effects, or rotate it.
- On busy or photographic backgrounds, use the navy symbol or place the lockup on a
  solid panel.
- Minimum sizes: symbol 16 px; full lockup ~120 px wide.

## A note on the SVG files

The SVGs reference the Spectral webfont (loaded automatically when viewed in a browser
with an internet connection). For print, embedding, or editing in design tools, the
**PNG** files have the font baked in and need no connection. To produce fully
self-contained SVGs, open one in a vector editor and convert the text to outlines.
