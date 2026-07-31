# EPIC-12 Design — Shipping

**Status:** 🟡 **Design in progress on `feat/epic-12-shipping`** — Decisions
D1–D4 answered by the owner on **2026-07-31** (before code). · **Drafted:**
2026-07-31.

This document fixes the **scope, boundaries, decisions and acceptance criteria**
of EPIC-12 — the carrier-abstraction and shipment layer over the orders
delivered in EPIC-11. Contract: [api/shipping.md](api/shipping.md). How it fits:
[domain-map.md](domain-map.md). Depends on: EPIC-11 (orders), EPIC-7
(`shipping_zones` master data, already seeded).

---

## 1. Goal

An order in `ready`/`shipped` needs a real dispatch: a carrier, a tracking
number, a printable label, and a reliable way to learn — asynchronously, from
the carrier — that it moved. EPIC-12 delivers a **carrier-abstraction layer**
(`CarrierPort`) so the domain never depends on a specific provider, a
**manual carrier adapter** as the first (and for now only) implementation,
bulk shipment creation, a **DB-backed, retried webhook inbox** for inbound
carrier callbacks, in-order tracking, and shipping-fee deduction from
`collectedAmount`. Waybill PDF rendering is stubbed pending the shared PDF
infrastructure EPIC-13 needs anyway.

## 2. In scope

- **`CarrierPort`** — a domain-level interface (`createShipment`,
  `getTracking`, `generateWaybill`, `cancelShipment`) that the application
  layer depends on. No module outside `infrastructure` knows a carrier's name.
- **`ManualCarrierAdapter`** — the only adapter shipped in this epic. Creating
  a shipment assigns a locally-generated tracking number; status advances only
  through the same webhook-inbox path a real carrier would use (or an
  authenticated internal endpoint for manual status entry), so the domain
  layer exercises the exact same flow a live carrier integration will use
  later.
- **`Shipment`** — one per order (or per order+split, P1), carrier, tracking
  number, status, waybill state, fee.
- **`Waybill`** — metadata only in this epic (tracking number, carrier, label
  fields); PDF rendering deferred (D3).
- **Bulk shipment creation** — atomic per item, per-item results, same
  discipline as EPIC-11 bulk status/assign.
- **Carrier webhook inbox** — `POST /v1/shipping/webhooks/{carrier}`,
  signature-verified, written to a durable inbox table keyed
  `UNIQUE(carrier, carrier_event_id)`, processed by a retry worker with
  exponential backoff; domain changes + audit + event emission happen in one
  transaction per successful processing pass (D2).
- **Zones** — reuse the `shipping_zones` master data already seeded in EPIC-7;
  no new zone-config table unless a fee-per-zone column is needed (§5).
- **Shipping-fee deduction** — `Shipment.fee` deducted from the order's
  `collectedAmount` at delivery; this is the simple subtraction only. The
  _reconciled_ view (matching carrier remittance/invoices, disputes) is
  EPIC-13's "working shipping reconciliation," out of scope here.
- **In-order tracking** — `GET /v1/shipping/shipments/{id}` and a read surface
  on the order detail (frontend, P1 within this epic if time allows).
- **Events** — `shipment.created`, `shipment.status_changed`,
  `shipment.delivered`.

## 3. Explicitly out of scope

| Not in EPIC-12                                              | Why / where                                                                                         |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A real Bosta (or any live carrier) API client               | Deferred adapter — `CarrierPort` ships now, Bosta adapter later once sandbox credentials exist (D1) |
| Waybill PDF rendering                                       | Piggybacks on EPIC-13's shared PDF infrastructure for invoices (D3)                                 |
| Redis/BullMQ or any new queue infra                         | DB-backed inbox + retry worker instead (D2), no new dependency                                      |
| Reconciled shipping cost vs. carrier remittance/invoices    | EPIC-13 finance                                                                                     |
| Per-zone rate cards / rate shopping across carriers         | P1 — one manual fee per shipment now                                                                |
| Return-to-warehouse stock automation on a carrier RTO event | Manual inventory adjustment for now; automated later                                                |

## 4. Decisions — answered by the owner, 2026-07-31

| #   | Decision                             | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Carrier integration scope for M12    | **Abstraction now, mock adapter only.** `CarrierPort` is the real interface the application layer depends on; the only implementation shipped is `ManualCarrierAdapter` (no external HTTP calls). A real Bosta adapter is a future, additive implementation of the same port — orders/shipments never change when it lands.                                                                                                                              |
| D2  | Webhook queue mechanism              | **DB-backed inbox, not Redis/BullMQ.** A `shipping_webhook_events` table stores every verified inbound callback with `UNIQUE(carrier, carrier_event_id)`; a retry worker with exponential backoff processes pending rows, applies the domain change inside one transaction, then audits and emits the event. The worker interface stays abstract so a real queue (Redis/SQS/RabbitMQ) can replace the poll loop later without touching the domain layer. |
| D3  | Waybill PDF rendering                | **Deferred.** `POST /v1/shipping/shipments/{id}/waybill` returns tracking/label metadata (carrier, tracking number, recipient block) with no PDF body in this epic. Actual rendering reuses the vetted PDF library EPIC-13 already needs for official invoices — one PDF pipeline, not two.                                                                                                                                                              |
| D4  | Shipping-fee reconciliation boundary | **Simple deduction only.** `Shipment.fee` subtracts from `collectedAmount` at delivery, same integer-minor-units discipline as orders. Matching that fee against what the carrier actually remits/invoices is EPIC-13's "working shipping reconciliation" — a different, later concern.                                                                                                                                                                  |

### D1 rationale

The project's established pattern (ADR-0001 — binary `.xlsx` import deferred in
EPIC-11 pending a vetted dependency) is to ship the seam now and the
credential/dependency-gated implementation later. A live Bosta integration
needs sandbox credentials and API docs this session doesn't have; blocking
EPIC-12 on that would stall a codeable, testable abstraction that the rest of
the system (orders, webhooks, tracking UI) can already be built and tested
against via `ManualCarrierAdapter`.

### D2 rationale

Matches the codebase's standing preference for self-built primitives over new
infrastructure dependencies (self-built crypto/JWT/TOTP in EPIC-4, the
in-process event bus in EPIC-6). The project runs no Redis/queue today; adding
one is a standing-infra decision bigger than one epic. The inbox table gives
the same guarantees this epic needs — durability, idempotency on
`(carrier, carrier_event_id)`, and retry — without it.

### D3 rationale

Two independent PDF pipelines (one for waybills now, a second for invoices in
EPIC-13) is the kind of premature-then-duplicated infra this project avoids
elsewhere (see D1). Stubbing the metadata now unblocks tracking/label-data
consumers (frontend, carrier row); the PDF byte stream arrives once, with
EPIC-13.

## 5. Data model (as decided)

```
Shipment (shipments)
  ├─ id, companyId
  ├─ orderId          → orders (RESTRICT: a shipment pins its order)
  ├─ carrier           (enum-checked; "manual" only today, extensible)
  ├─ trackingNumber    (unique per company+carrier)
  ├─ status            (created/picked_up/in_transit/delivered/returned/cancelled)
  ├─ fee               (bigint minor units, default 0)      ← D4
  ├─ waybillIssued      (boolean, default false)             ← D3 (metadata only)
  ├─ deliveredAt?
  ├─ idempotencyKey?    (unique per company when present)
  └─ (base columns)

ShippingWebhookEvent (shipping_webhook_events)
  ├─ id, companyId      (NOT NULL — resolved synchronously, see below)
  ├─ carrier
  ├─ carrierEventId
  ├─ payload            (jsonb, raw verified body)
  ├─ status             (pending/processing/processed/failed)
  ├─ attempts, nextAttemptAt   ← exponential backoff
  ├─ processedAt?
  └─ createdAt, updatedAt
  UNIQUE (carrier, carrierEventId)                            ← D2 idempotency

ShippingZone (shipping_zones)                                 ← already seeded, EPIC-7
  (no schema change needed for M12; a fee-per-zone column is P1 if rate cards land)
```

All tenant-editable tables: base columns + `FORCE` RLS by `company_id` +
`touch_updated_at`. `ShippingWebhookEvent.companyId` is **NOT NULL, resolved
synchronously**: the inbound route is
`POST /v1/shipping/webhooks/{carrier}/{companyId}` — the company comes from
that signed path, never from the payload (ADR-0003), so the row's tenant key
is always known at insert time. This avoids inventing a new RLS
bootstrap-window policy (the `profiles_self`/`sessions_self` null-principal
pattern exists only for the _user_ dimension, never for `company_id` on a
domain table — `companies_create`/`company_members_access` show the
established alternative is a narrow identity-scoped policy, not a blanket
null-context bypass). Standard `FORCE` RLS + `company_id = current_company_id()`
applies unchanged.

## 6. Milestones

| ID    | Deliverable                                                                                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M12.0 | This design doc + branch `feat/epic-12-shipping`; decisions D1–D4 recorded.                                                                                                              |
| M12.1 | Prisma models + migration: `shipments`, `shipping_webhook_events`; RLS, triggers, keyset indexes, checks.                                                                                |
| M12.2 | `modules/shipping` domain + application + infrastructure: `CarrierPort`, `ManualCarrierAdapter`, create/bulk-create shipment, cancel, fee deduction on delivery, audit-then-emit.        |
| M12.3 | `/v1/shipping` presentation: carriers/shipments/bulk/detail/waybill routes, DTOs, three-layer gating, unified errors, OpenAPI.                                                           |
| M12.4 | Webhook inbox: signature verification, `shipping_webhook_events` write path, retry worker (backoff), transactional processing, idempotency test.                                         |
| M12.5 | Shipping surface in the Dual Shell: tracking on the order detail, carrier row on shipments, manual status-advance action (dev/ops path standing in for the real carrier).                |
| M12.6 | Docs + §2.5 gate: contract updated to match delivered routes, events live, `shipping-domain.md`, retrospective, `epic-12-quality-gate.md`; metrics/domain-map refreshed; owner sign-off. |

## 7. Acceptance criteria

The epic is done when **all** hold:

1. The application layer depends only on `CarrierPort`; no module outside
   `modules/shipping/infrastructure` imports a carrier-specific type.
2. Creating a shipment (single or bulk) is atomic, `Idempotency-Key`-replayed,
   and returns per-item results for bulk.
3. An inbound webhook is signature-verified, written to
   `shipping_webhook_events` before processing, and reprocessing the same
   `(carrier, carrierEventId)` is a no-op (idempotency test green).
4. A failed webhook-processing attempt is retried with exponential backoff and
   does not lose the event.
5. `Shipment.fee` deducts from the order's `collectedAmount` at delivery;
   money stays integer minor units end to end.
6. Every route is three-layer gated (`shipping.read` / `shipping.manage` —
   already seeded in the access catalog); tenant from token; RLS + repo
   scoping both hold (CI `database` job).
7. The waybill endpoint returns tracking/label metadata with no PDF body; a
   follow-up epic can add PDF rendering without changing this endpoint's
   shape (additive only, per API conventions §1).
8. All local gates green from a cold cache; web bundle stays under budget.

## 8. Risks

| Risk                                                                | Mitigation                                                                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain layer accidentally couples to `ManualCarrierAdapter`         | `CarrierPort` interface + lint/arch-check rule mirroring `no-cross-feature-imports`                                                                       |
| Webhook company can't be resolved without reading tenant data first | Company comes from the signed `{carrier}/{companyId}` path, not the payload — resolved before any DB read, no RLS bypass needed                           |
| Retry worker double-processes under concurrent runs                 | `UNIQUE(carrier, carrierEventId)` + row-level lock during processing, same discipline as EPIC-9's `FOR UPDATE`                                            |
| Waybill stub blocks a real frontend need for a printable label      | Metadata-only response still unblocks tracking-number/label-field display; PDF is additive later                                                          |
| Building toward Bosta without real credentials never gets validated | `ManualCarrierAdapter` is fully exercised by tests today; the real adapter is scoped as a drop-in replacement, reviewed on its own when credentials exist |

---

**Status:** decisions D1–D4 answered on 2026-07-31; this document is the M12.1
brief. [api/shipping.md](api/shipping.md) is updated to match as each milestone
lands.
