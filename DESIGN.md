---
name: Verified Precision
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#45474c'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#75777d'
  outline-variant: '#c5c6cd'
  surface-tint: '#545f73'
  primary: '#091426'
  on-primary: '#ffffff'
  primary-container: '#1e293b'
  on-primary-container: '#8590a6'
  inverse-primary: '#bcc7de'
  secondary: '#0051d5'
  on-secondary: '#ffffff'
  secondary-container: '#316bf3'
  on-secondary-container: '#fefcff'
  tertiary: '#00190e'
  on-tertiary: '#ffffff'
  tertiary-container: '#00301e'
  on-tertiary-container: '#00a472'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e3fb'
  primary-fixed-dim: '#bcc7de'
  on-primary-fixed: '#111c2d'
  on-primary-fixed-variant: '#3c475a'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display:
    fontFamily: Plus Jakarta Sans
    fontSize: 3rem
    fontWeight: '700'
    lineHeight: 3.5rem
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 2.25rem
    fontWeight: '700'
    lineHeight: 2.75rem
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.75rem
    fontWeight: '700'
    lineHeight: 2.25rem
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 1.125rem
    fontWeight: '400'
    lineHeight: 1.75rem
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 0.9375rem
    fontWeight: '400'
    lineHeight: 1.5rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
    letterSpacing: 0.005em
  label-md:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1.25rem
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '600'
    lineHeight: 1rem
    letterSpacing: 0.025em
  data-metric:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system establishes an environment of unassailable credibility, institutional clarity, and executive-level transparency. Designed for modern recruitment infrastructure, candidate validation, and technical hiring pipelines, the visual language balances high-density data presentation with tranquil, breathing room. 

The aesthetic is Modern Corporate with architectural precision—prioritizing clarity, legible data tables, explicit visual proof points, and rigorous validation states over decorative flourishes. The experience evokes absolute confidence, neutrality, and speed for both hiring leaders and candidates navigating salary transparency and verified achievements.

## Colors

The palette is engineered around high contrast, institutional authority, and functional verification:

- **Primary (`#1E293B` - Deep Slate):** Anchors high-priority typography, primary buttons, critical structural chrome, and active navigation nodes. Represents permanence and executive command.
- **Secondary (`#2563EB` - Trust Blue):** Directs interactive momentum, active system focus, inline hyperlinks, and key analytical charts.
- **Tertiary (`#10B981` - Emerald Proof):** Exclusively signals authenticated data points, positive verification audits, pass rates, and verified salary benchmarks. Must never be used decoratively.
- **Neutral (`#64748B` - Slate Neutral):** Powers secondary data labels, subtle iconography, and descriptive contextual body copy.

### Canvas & Surface Architecture
- Base canvas background: `#F8FAFC`
- Card and surface elevation: `#FFFFFF`
- Structural dividers and borders: `#E2E8F0`
- Subdued interactive hover fills: `#F1F5F9`
- Subtle validation tints: Emerald surface at `#ECFDF5` (`#065F46` text) and Blue surface at `#EFF6FF` (`#1E40AF` text).

## Typography

The typographic hierarchy pairs **Plus Jakarta Sans** for structural headers with **Inter** for UI operations, candidate dossier reading, and dense data presentation. 

### Implementation Rules
- All salary numbers, trust scores, timestamp audits, and numerical analytics must implement OpenType tabular figures (`font-variant-numeric: tabular-nums;`) to guarantee column alignment across comparison tables.
- Display and `headline-lg` levels use tight tracking (`-0.025em`) to eliminate visual slack in executive dashboard headers.
- Small metadata labels (`label-sm`) require slight positive tracking (`0.025em`) and uppercase styling when used for category indicators and credential headers.

## Layout & Spacing

This design system uses a strict 8pt base grid system to ensure consistent vertical rhythms throughout data-heavy candidate views and verification dashboards.

### Grid Framework
- **Desktop (1200px+):** 12-column responsive layout with `2rem` outer margins and `1.5rem` gutters. Maximum application container cap is `1440px`.
- **Tablet (768px – 1199px):** 8-column layout with `1.5rem` margins and `1rem` gutters. Split screen dossier views stack into sequential blocks.
- **Mobile (<768px):** 4-column layout with `1rem` outer margins and `1rem` gutters. Metric comparison cards transform into horizontal snap-scrolling panels.

### Component Spacing Rhythm
- Compact internal data cells use `space-xs` and `space-sm` to maintain analytical density.
- Standard form fields, card contents, and filter clusters use `space-md`.
- Distinct verification modules and candidate record panels separate using `space-lg` and `space-xl`.

## Elevation & Depth

Visual hierarchy avoids heavy drop shadows in favor of **Tonal Boundaries** and **Low-Contrast Outlines**. The system mimics premium paper documents and high-precision software terminals.

### Layer Hierarchy
- **Level 0 (Canvas Base):** Plain `#F8FAFC`. Zero elevation, non-interactive foundation.
- **Level 1 (Structural Cards & Modules):** Pure white `#FFFFFF` surface with a crisp `1px` stroke of `#E2E8F0`. Shadow: `0 1px 2px 0 rgba(15, 23, 42, 0.04)`.
- **Level 2 (Interactive Hover & Dropdown Menus):** Pure white `#FFFFFF` surface, `1px` border of `#CBD5E1`. Shadow: `0 4px 6px -1px rgba(15, 23, 42, 0.06), 0 2px 4px -2px rgba(15, 23, 42, 0.04)`.
- **Level 3 (Modals & Verification Drawer Overlays):** `#FFFFFF` container with `0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04)`. The background overlay is `#0F172A` with `40%` opacity and a `4px` backdrop blur.

## Shapes

The design system maintains a **Soft** shape language (`roundedness: 1`). The geometry communicates technical precision, institutional structure, and modern software clarity.

- Standard inputs, buttons, and badges utilize `0.25rem` (4px) radii.
- Base cards, filter surfaces, and container blocks use `rounded-lg` (`0.5rem` / 8px).
- Modal dialogs and major platform viewports leverage `rounded-xl` (`0.75rem` / 12px).
- Verification check pills and audit score dots may use full circular clipping (`9999px`) strictly to differentiate status pills from interactive buttons.

## Components

### Buttons
- **Primary:** Solid `#1E293B` background with `#FFFFFF` text. Hover state transitions to `#334155`. Active state `#0F172A`. Focused with a 2px offset ring of `#2563EB`.
- **Secondary:** White `#FFFFFF` background with `1px` border of `#E2E8F0` and `#1E293B` text. Hover fills to `#F8FAFC` with border `#CBD5E1`.
- **Tertiary / Action Blue:** Solid `#2563EB` background with `#FFFFFF` text. Used exclusively for final confirmation steps (e.g., "Confirm Hire", "Verify Candidate").

### Verification Badges & Chips
- **Verified Status Badge:** Tightly padded (`0.25rem 0.625rem`) chip featuring a micro checkmark icon. Surface is `#ECFDF5`, border is `1px solid #A7F3D0`, text is `#065F46` in `label-sm`.
- **Skill-Validation Badge:** Neutral slate surface `#F1F5F9`, `#334155` text, bordered by `#E2E8F0`. Features inline benchmark percentages in tabular format (e.g., `Top 5%`).
- **Salary Transparency Pill:** High-contrast neutral badge (`#0F172A` text on `#F8FAFC` background with a `1px` stroke of `#E2E8F0`), highlighting verified bands with an emerald currency indicator.

### Input Fields & Selects
- Constructed with a `1px` border of `#E2E8F0`, `#FFFFFF` surface, and text in `body-md` (`#1E293B`).
- Placeholder text styled in `#94A3B8`.
- Focus state explicitly switches border to `#2563EB` with a `0 0 0 3px rgba(37, 99, 235, 0.12)` halo.
- Disabled inputs adopt `#F1F5F9` fills with `#94A3B8` text.

### Checkboxes & Radio Controls
- Base control is a `16px x 16px` box with a `1px` border of `#CBD5E1` and `0.25rem` corner radius.
- Checked state switches to solid `#1E293B` or `#2563EB` fill with a crisp white check vector.

### Data Cards & Candidate Dossiers
- Outer container: `#FFFFFF` fill with `1px solid #E2E8F0` and a `0.5rem` border radius.
- Header bands are partitioned with a subtle bottom border (`1px solid #F1F5F9`).
- Score meters: Visualized through a segmented bar layout (e.g., 5 segments) rather than continuous arcs, using `#10B981` for verified units and `#E2E8F0` for unearned units.