-- EPIC-12 — Shipping (M12.1).
--
-- A carrier-abstraction layer over the orders delivered in EPIC-11. Decisions
-- D1-D4 (docs/epic-12-design.md §4):
--
--   D1 — CarrierPort abstraction now; the only adapter shipped is
--        ManualCarrierAdapter. `carrier` is a free-text column (`'manual'`
--        today) so a real carrier is an additive value, not a schema change.
--   D2 — a DB-backed webhook inbox (no new queue dependency), idempotent on
--        `(carrier, carrier_event_id)`, processed by a retry worker with
--        exponential backoff.
--   D3 — waybills are metadata-only in this epic (`waybill_issued` flag); PDF
--        rendering piggybacks on EPIC-13's shared PDF work.
--   D4 — `fee` is a simple deduction from the order's `collected_amount` at
--        delivery; reconciliation against carrier remittance is EPIC-13.
--
-- Tables (both tenant-editable: base columns + FORCE RLS by company_id per
-- docs/core-data.md §16.2, plus the `app.touch_updated_at()` trigger):
--
--   1. shipments               — one per order: carrier, tracking number,
--                                 status, fee, waybill flag. The order is
--                                 PINNED (RESTRICT).
--   2. shipping_webhook_events — durable inbox for inbound carrier callbacks.
--
-- Webhook company resolution: the inbound route is
-- `/v1/shipping/webhooks/{carrier}/{companyId}` (docs/api/shipping.md) — the
-- company comes from that signed path, never from the payload (ADR-0003), so
-- `shipping_webhook_events.company_id` is always known synchronously at
-- insert time. No RLS bootstrap-window policy is needed (contrast
-- `profiles_self` / `sessions_self`, which permit a null-principal window for
-- pre-authentication flows): this table's tenant key is never unknown.
--
-- Money is integer minor units (bigint), never a float, matching orders.
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 1. shipments — one dispatch per order (tenant-editable).
-- ---------------------------------------------------------------------------
CREATE TABLE public.shipments (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  order_id        uuid        NOT NULL,
  carrier         text        NOT NULL DEFAULT 'manual',
  tracking_number text        NOT NULL,
  status          text        NOT NULL DEFAULT 'created',
  fee             bigint      NOT NULL DEFAULT 0,
  waybill_issued  boolean     NOT NULL DEFAULT false,
  delivered_at    timestamptz,
  idempotency_key text,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipments_pkey PRIMARY KEY (id),
  -- Only the manual adapter (D1) exists today; a real carrier is an additive
  -- value here, never a schema change.
  CONSTRAINT shipments_carrier_check CHECK (carrier IN ('manual')),
  CONSTRAINT shipments_status_check CHECK (status IN (
    'created','picked_up','in_transit','delivered','returned','cancelled'
  )),
  CONSTRAINT shipments_fee_check CHECK (fee >= 0),
  CONSTRAINT shipments_tracking_check CHECK (char_length(tracking_number) BETWEEN 1 AND 100),
  -- Tracking numbers are unique per company+carrier (not globally: two
  -- companies on the same carrier never collide by construction, but the
  -- constraint is scoped defensively rather than assumed).
  CONSTRAINT shipments_company_carrier_tracking_key UNIQUE (company_id, carrier, tracking_number),
  CONSTRAINT shipments_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  -- The order is PINNED: a shipment always resolves its order.
  CONSTRAINT shipments_order_fk FOREIGN KEY (order_id)
    REFERENCES public.orders (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.shipments IS
  'One dispatch per order (EPIC-12). Tenant-editable. carrier is currently '
  '''manual'' only (D1); fee deducts from the order''s collected_amount at delivery (D4).';
COMMENT ON COLUMN public.shipments.waybill_issued IS
  'Metadata flag only (D3) — no PDF is stored or rendered by this epic.';

-- A retried create with the same Idempotency-Key replays instead of duplicating.
CREATE UNIQUE INDEX shipments_idempotency_key
  ON public.shipments (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX shipments_created_keyset_idx
  ON public.shipments (company_id, created_at DESC, id DESC);
CREATE INDEX shipments_order_idx  ON public.shipments (order_id);
CREATE INDEX shipments_status_idx ON public.shipments (company_id, status);

CREATE TRIGGER shipments_touch_updated_at
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments FORCE  ROW LEVEL SECURITY;

CREATE POLICY shipments_tenant ON public.shipments
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 2. shipping_webhook_events — durable inbox for inbound carrier callbacks
--    (tenant-scoped; company resolved from the signed webhook path, see header).
-- ---------------------------------------------------------------------------
CREATE TABLE public.shipping_webhook_events (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL,
  carrier           text        NOT NULL,
  carrier_event_id  text        NOT NULL,
  payload           jsonb       NOT NULL,
  status            text        NOT NULL DEFAULT 'pending',
  attempts          integer     NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz,
  processed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_webhook_events_pkey PRIMARY KEY (id),
  CONSTRAINT shipping_webhook_events_status_check CHECK (status IN (
    'pending','processing','processed','failed'
  )),
  CONSTRAINT shipping_webhook_events_attempts_check CHECK (attempts >= 0),
  -- Idempotent on the carrier's own event id (D2): reprocessing is a no-op.
  CONSTRAINT shipping_webhook_events_carrier_event_key UNIQUE (carrier, carrier_event_id),
  CONSTRAINT shipping_webhook_events_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.shipping_webhook_events IS
  'Durable inbox for inbound carrier webhooks (EPIC-12). UNIQUE(carrier, '
  'carrier_event_id) makes reprocessing a no-op (D2); a retry worker drains '
  '''pending'' rows with exponential backoff.';

CREATE INDEX shipping_webhook_events_keyset_idx
  ON public.shipping_webhook_events (company_id, created_at DESC, id DESC);
-- The retry worker's poll query: pending/failed rows due for another attempt.
CREATE INDEX shipping_webhook_events_pending_idx
  ON public.shipping_webhook_events (status, next_attempt_at);

CREATE TRIGGER shipping_webhook_events_touch_updated_at
  BEFORE UPDATE ON public.shipping_webhook_events
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.shipping_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_webhook_events FORCE  ROW LEVEL SECURITY;

CREATE POLICY shipping_webhook_events_tenant ON public.shipping_webhook_events
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
