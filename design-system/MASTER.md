# Design System Master: "Mistral Workflow Interface"

**Date:** 2026-04-09  
**Theme:** Warm Ivory / Amber / Burnt Orange  
**Style:** Editorial workflow product, not dashboard

## 1. Core Principles

- Use the exact warm Mistral spectrum from `DESIGN.md`: ivory, cream, gold, amber, orange, burnt orange, and warm black.
- Structure every page as a workflow with one dominant next action instead of a dashboard of equal-weight cards.
- Use poster-scale typography, strong negative tracking, and sharp geometry to create a declarative product voice.
- Keep hierarchy through scale, spacing, and surface contrast, not through heavy font-weight variation.

## 2. Color System

| Token | Value | Usage |
| :--- | :--- | :--- |
| `--app-bg` | `#fffaeb` | Main page background |
| `--app-surface` | `#fff0c2` | Primary paper-like surface |
| `--app-surface-strong` | `#ffe295` | Elevated warm surface |
| `--app-brand` | `#fa520f` | Primary action / highest-signal accent |
| `--app-flame` | `#fb6424` | Hover / secondary accent |
| `--app-orange` | `#ff8105` | Warm action support |
| `--app-gold` | `#ffa110` | Step markers / secondary emphasis |
| `--app-yellow` | `#ffd900` | Gradient block highlight |
| `--app-black` | `#1f1f1f` | Main text / dark CTA |

## 3. Typography

- **Primary UI:** Arial-style sans stack, `400` weight as the default across the interface
- **Display scale:** 42px → 58px → 82px for major headers
- **Body copy:** 16px with generous line-height
- **Data / raw output:** `IBM Plex Mono`
- **Voice:** declarative, uppercase markers for workflow steps and utility labels

## 4. Layout Rules

- Global shell is `top brand bar + primary workflow strip`
- Core pages use segmented workflow stages rather than dashboard grids
- History pages read like archives or ledgers
- Result pages read like documents or execution records
- Border radius should be effectively zero throughout the product

## 5. Surfaces And Depth

- No dark glassmorphism, no blue-black gradients, no floating admin shell
- Use cream and ivory surfaces with warm cascading amber shadows
- Prefer surface contrast over decorative chrome
- Use the Mistral block gradient for memorable brand accents

## 6. Interaction Rules

- One dominant CTA per section
- Inputs and tables stay practical and readable on warm paper-like surfaces
- Stage bars and switchers should clarify sequence, not mimic tabs for decoration
- Empty states should explain the next workflow move, not present generic dashboard filler
