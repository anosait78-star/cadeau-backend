<!--
Definition of Done — Engineering Standards §7. Every box must be checked (or
marked N/A with a reason) before merge. CI enforces the automated gates.
-->

## Summary

<!-- What changed and why. Link the task/issue. -->

## Definition of Done

**Functionality & tests**

- [ ] Requirement implemented and tested (unit / integration / E2E for critical paths).
- [ ] Atomicity failure tests pass where multi-step operations exist (no partial state).

**ADR-002 — Dual UX**

- [ ] Desktop UX **and** Mobile UX designed & implemented as **independent** layouts.
- [ ] No core function depends on hover / right-click; every table has a card/list alternative.
- [ ] Design tokens only (no hard-coded colors/spacing) · full i18n (ar/en) · correct RTL/LTR.
- [ ] Empty / Loading / Error states designed · WCAG 2.1 AA.

**ADR-003 — Three-layer access**

- [ ] Feature bound to a Feature Key; menu/page/buttons/reports/API gated by
      Subscription AND Feature Flag AND Permission, **enforced server-side**.

**ADR-004 — AI-out / extensible**

- [ ] Works with fully deterministic logic (no AI service/screen/integration); `AI` flag stays OFF.
- [ ] Any extension hook is documented, not implemented in core.

**ADR-001 — Security**

- [ ] Authorization enforced server-side; sensitive ops write to `audit_log`.
- [ ] Inputs validated; outputs encoded; parameterized queries only; no secrets in the diff.
- [ ] CI security + performance gates green (audit, SAST, secret scan, budgets).

## Screenshots

<!-- Attach Desktop AND Mobile screenshots for any UI change (ADR-002). -->
