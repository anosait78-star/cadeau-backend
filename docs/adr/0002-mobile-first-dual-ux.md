# ADR-0002: Mobile-First Dual UX

- **Status:** Accepted (binding)
- **Date:** 2026-07-26
- **Deciders:** Product owner
- **Supersedes / Superseded by:** —

## Context

The product serves power users on desktop and operators on mobile. A single
responsive layout compromises both. The two experiences have different
interaction models but must feel like one product.

## Decision

Ship **two independent experiences** — a Desktop power-user UX and a mobile
native-feeling UX — that share only the visual identity (design system), over one
unified API.

- Each screen is designed twice: Desktop UX and Mobile UX, independently.
- **No reliance on hover or right-click** for core functions; every table has a
  card alternative.
- The architecture stays API-first so a future native app reuses the same API.

## Consequences

- **Positive:** each surface is optimized, not compromised; native-app-ready.
- **Negative / trade-offs:** two shells to build and maintain; a shared foundation
  is required first to avoid duplication.
- **Follow-ups:** M1.6 builds the **shared** foundation (tokens, theme, RTL, base
  layout, standard states); **EPIC-2** builds the independent Desktop (Sidebar +
  Topbar + ⌘K) and Mobile (Bottom Nav + FAB + Bottom Sheets) shells on top of it.

## Alternatives considered

- **Single responsive layout** — rejected: compromises both desktop density and
  mobile ergonomics.
- **Mobile web only / desktop only** — rejected: both audiences are first-class.
