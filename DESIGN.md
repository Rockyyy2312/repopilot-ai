---
name: Clarity Engine
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#3d4a42'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#6d7a72'
  outline-variant: '#bccac0'
  surface-tint: '#006c4a'
  primary: '#006948'
  on-primary: '#ffffff'
  primary-container: '#00855d'
  on-primary-container: '#f5fff7'
  inverse-primary: '#68dba9'
  secondary: '#006398'
  on-secondary: '#ffffff'
  secondary-container: '#5bb8fe'
  on-secondary-container: '#00476e'
  tertiary: '#006947'
  on-tertiary: '#ffffff'
  tertiary-container: '#00855b'
  on-tertiary-container: '#f5fff6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#85f8c4'
  primary-fixed-dim: '#68dba9'
  on-primary-fixed: '#002114'
  on-primary-fixed-variant: '#005137'
  secondary-fixed: '#cce5ff'
  secondary-fixed-dim: '#93ccff'
  on-secondary-fixed: '#001d31'
  on-secondary-fixed-variant: '#004b73'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  headline-xl:
    fontFamily: Geist
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Geist
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  code-inline:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  code-block:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 19px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-tablet: 1.5rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system targets modern software engineers, platform architects, and engineering managers who are exhausted by opaque, dense, terminal-only tooling and arcane syntax representations. The system shifts developer tooling from intimidating telemetry dumps into accessible developer intelligence.

The visual style blends **Modern Utilitarian Minimalism** with crisp, structural clarity. Rather than hiding behind pitch-black terminals or nested AST abstractions, the aesthetic emphasizes pristine light workspaces, crisp micro-borders, airy density, and purposeful accents. The emotional tone is calm, highly competent, lucid, and instantly decipherable—transforming complex diagnostics, dependency graphs, and build pipelines into readable, actionable interfaces.

## Colors

The palette establishes an open, high-signal workspace with intentional functional role assignments:

- **Primary (`#059669`)**: Forest Emerald serves as the operational baseline—representing passing builds, healthy telemetry, verified code contracts, and primary interface activations.
- **Secondary (`#0284C7`)**: Clear Sky Blue commands inspectable elements, branch states, query operations, and interactive nodes.
- **Tertiary (`#10B981`)**: Vibrant Spring Emerald provides high-contrast status pings, diff insertions, and live metric indicators.
- **Neutral (`#0F172A`)**: Deep Slate underpins foundational contrast, serving as the dominant ink for body typography, structural dividers, and high-visibility badges.
- **Surface Foundations**: Layered using crisp neutral tiers: Canvas Base (`#F8FAFC`), Surface Elevated (`#FFFFFF`), and Inset/Border Bedding (`#F1F5F9`).

Accents must never be used purely decoratively; color strictly indicates runtime state, interactivity, or architectural hierarchy.

## Typography

Typography prioritizes scanability, parsing efficiency, and eye-strain reduction during continuous review sessions.

- **Prose & Structural Chrome**: Set in **Geist**, providing low geometric distortion, neutral tone, and exceptional render crispness on high-DPI displays.
- **Code, Metadata & Badges**: Set in **JetBrains Mono**, used for function signatures, line counters, telemetry metrics, and contextual labels.
- Tabular figures must be enabled by default for all numerical representations and benchmark matrices (`font-feature-settings: "tnum"`).

## Layout & Spacing

The layout is built upon an adaptive 12-column fluid grid system geared for multi-pane developer workflows.

- **Desktop (>= 1280px)**: 12 columns, 24px gutters, 40px outer margins. Supports persistent left-hand navigation/file tree (260px fixed), flexible primary workbench canvas, and collapsible right-hand inspector rails (360px fixed).
- **Tablet (768px - 1279px)**: 8 columns, 16px gutters, 24px outer margins. The tree collapses into an off-canvas drawer; inspection metrics nest beneath the main stream.
- **Mobile (< 768px)**: 4 columns, 16px gutters, 16px outer margins. Single-column stacked presentation.

Vertical cadence strictly honors an 8px base rhythm (with 4px sub-increments for compact data tables, tag chips, and terminal logs).

## Elevation & Depth

This design system avoids heavy drop shadows and faux skeuomorphic extrusions. Depth is established via **tonal layering paired with calibrated hairline borders**:

- **Ground Level (Canvas)**: `#F8FAFC` provides the foundational workspace backdrop.
- **Layer 1 (Card & Pane Surfaces)**: Pure `#FFFFFF`, bounded by a 1px border of `#E2E8F0`. No shadow at rest.
- **Layer 2 (Floating Popovers, Menus, Command Bars)**: `#FFFFFF` surfaced with a crisp border of `#CBD5E1` and a delicate, diffuse ambient lift: `0px 8px 24px -4px rgba(15, 23, 42, 0.06), 0px 2px 6px -1px rgba(15, 23, 42, 0.04)`.
- **Layer 3 (Modals & Overlays)**: Surface `#FFFFFF` suspended over an ambient backdrop dim of `rgba(15, 23, 42, 0.35)` with an ultra-soft border stroke and targeted focus shadow.

## Shapes

The interface embraces a **Soft (Level 1)** geometric structure, maintaining the disciplined rigor expected of high-precision IDEs while softening aggressive corners to reduce visual friction:

- Micro-elements (Tags, status pips, check targets): `0.25rem` (4px).
- Standard controls (Buttons, inputs, code snippets): `0.375rem` (6px).
- Content containers (Panels, modules, metrics cards): `0.5rem` (8px).
- Sheet drawers and modal frames: `0.75rem` (12px).

## Components

### Buttons
- **Primary**: Solid background of `#059669`, white text, 6px border radius, 0 1px 2px rgba(5, 150, 105, 0.2) resting shadow. Hover shifts to `#047857`.
- **Secondary**: `#FFFFFF` background, `#0F172A` text, 1px border in `#CBD5E1`. Hover changes background to `#F8FAFC` and border to `#94A3B8`.
- **Subtle / Ghost**: Transparent background, `#475569` text. Hover yields `#F1F5F9` with `#0F172A` text.

### Chips & Badges
- Displayed using `label-sm` in `JetBrains Mono`.
- **Success / Passed**: `#ECFDF5` background, `#047857` text, `#A7F3D0` perimeter stroke.
- **Active / Info**: `#F0F9FF` background, `#0284C7` text, `#BAE6FD` perimeter stroke.
- **Neutral / Draft**: `#F1F5F9` background, `#475569` text, `#E2E8F0` perimeter stroke.

### Input Fields & Search Bars
- Background `#FFFFFF`, 1px solid border `#CBD5E1`, internal padding `0.5rem 0.75rem`.
- Focus state: Border transitions to `#0284C7` with a non-blurring ring: `box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.25)`. Monospaced helper text or shortcut keys (e.g., `⌘K`) align right in `#94A3B8`.

### Checkboxes & Radios
- Square (checkbox) or circle (radio) with 1px border in `#94A3B8`. Checked state fills `#059669` with crisp white iconography. Focus carries an emerald illumination ring.

### Cards & Code Blocks
- **Cards**: Pure white fill, 1px border in `#E2E8F0`, rounded to 8px. Header partitions use a 1px border bottom with a subtle background offset (`#F8FAFC`).
- **Code Blocks**: Isolated on `#F8FAFC` with 1px `#E2E8F0` border. Line numbers rendered in `#94A3B8` with `user-select: none`. Syntax highlighting adheres to high-contrast forest, sky blue, and amber tones.

### Developer Insights Panels
- Replaces raw AST readouts with visual intent trees: collapsible node rows featuring micro-indent guides, branch tags (`label-sm`), and clear status chips showing lint pass/fail metrics.