-- EPIC-15 — Notifications (M15.1).
--
-- Decisions D1-D9 (docs/epic-15-design.md §4):
--
--   D1 — personal endpoints are gated by the `notifications` feature only,
--        never a permission key (they are the caller's own data).
--   D2 — a DB-backed outbound delivery queue (notification_deliveries), no
--        new queue dependency, copying shipping_webhook_events/
--        WebhookRetryWorker (EPIC-12 M12.4) field-for-field.
--   D6 — the two events consumed are order.status_changed/payment.collected;
--        the recipient is the order's assignee, read back via a direct
--        Prisma read on the already-committed orders row.
--   D9 — an order with no assignee is a silent no-op, not an error.
--
-- Tables (all tenant-editable: base columns + FORCE RLS by company_id per
-- docs/core-data.md §16.2, plus the app.touch_updated_at() trigger):
--
--   1. notifications             — one in-app inbox row per recipient.
--   2. notification_preferences  — per-user, per-type, per-channel switches.
--   3. push_subscriptions        — registered Web Push endpoints.
--   4. notification_deliveries   — durable outbound Web Push send queue.
--
-- notification_deliveries splits its RLS into INSERT/SELECT/UPDATE policies
-- from the start (unlike shipping_webhook_events, which needed a follow-up
-- M12.4 migration to discover this) — the retry worker's cross-tenant claim
-- (SELECT ... FOR UPDATE SKIP LOCKED / UPDATE ... RETURNING, both running
-- with no tenant bound) is known up front this time.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 1. notifications — one in-app inbox row per (company, recipient).
-- ---------------------------------------------------------------------------
CREATE TABLE public.notifications (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL,
  profile_id uuid        NOT NULL,
  type       text        NOT NULL,
  title      text        NOT NULL,
  body       text        NOT NULL,
  payload    jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_type_check CHECK (type IN (
    'order.status_changed', 'payment.collected'
  )),
  CONSTRAINT notifications_title_check CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT notifications_body_check CHECK (char_length(body) BETWEEN 1 AND 2000),
  CONSTRAINT notifications_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT notifications_profile_fk FOREIGN KEY (profile_id)
    REFERENCES public.profiles (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.notifications IS
  'One in-app inbox row per recipient (EPIC-15). System-generated only from '
  'the event-bus subscriptions (D6); type is a closed set matching the '
  'events consumed today.';

CREATE INDEX notifications_recipient_keyset_idx
  ON public.notifications (company_id, profile_id, created_at DESC, id DESC);

CREATE TRIGGER notifications_touch_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE  ROW LEVEL SECURITY;

CREATE POLICY notifications_tenant ON public.notifications
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 2. notification_preferences — per-user, per-type, per-channel switches.
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_preferences (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL,
  profile_id       uuid        NOT NULL,
  type             text        NOT NULL,
  in_app_enabled   boolean     NOT NULL DEFAULT true,
  web_push_enabled boolean     NOT NULL DEFAULT true,
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_pkey PRIMARY KEY (id),
  CONSTRAINT notification_preferences_type_check CHECK (type IN (
    'order.status_changed', 'payment.collected'
  )),
  CONSTRAINT notification_preferences_recipient_type_key
    UNIQUE (company_id, profile_id, type),
  CONSTRAINT notification_preferences_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT notification_preferences_profile_fk FOREIGN KEY (profile_id)
    REFERENCES public.profiles (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.notification_preferences IS
  'Per-user, per-type, per-channel on/off switches (EPIC-15). A missing row '
  'for a (profile, type) pair means both channels default to enabled.';

CREATE TRIGGER notification_preferences_touch_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE  ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_tenant ON public.notification_preferences
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 3. push_subscriptions — registered Web Push endpoints.
-- ---------------------------------------------------------------------------
CREATE TABLE public.push_subscriptions (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL,
  profile_id uuid        NOT NULL,
  endpoint   text        NOT NULL,
  p256dh     text        NOT NULL,
  auth       text        NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint),
  CONSTRAINT push_subscriptions_endpoint_check CHECK (char_length(endpoint) BETWEEN 1 AND 2048),
  CONSTRAINT push_subscriptions_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT push_subscriptions_profile_fk FOREIGN KEY (profile_id)
    REFERENCES public.profiles (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.push_subscriptions IS
  'A registered W3C Web Push subscription (EPIC-15). endpoint is globally '
  'unique — it identifies one browser installation.';

CREATE INDEX push_subscriptions_recipient_idx
  ON public.push_subscriptions (company_id, profile_id);

CREATE TRIGGER push_subscriptions_touch_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions FORCE  ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_tenant ON public.push_subscriptions
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- ---------------------------------------------------------------------------
-- 4. notification_deliveries — durable outbound Web Push send queue.
--    RLS is split into INSERT/SELECT/UPDATE from the start (see header):
--    INSERT stays strictly tenant-bound (the dispatch handler always knows
--    its company); SELECT/UPDATE are additionally widened to permit the
--    retry worker's null-tenant cross-company claim.
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_deliveries (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL,
  notification_id       uuid        NOT NULL,
  push_subscription_id  uuid        NOT NULL,
  channel               text        NOT NULL DEFAULT 'web_push',
  status                text        NOT NULL DEFAULT 'pending',
  attempts              integer     NOT NULL DEFAULT 0,
  next_attempt_at       timestamptz,
  last_error            text,
  processed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id),
  CONSTRAINT notification_deliveries_channel_check CHECK (channel IN ('web_push')),
  CONSTRAINT notification_deliveries_status_check CHECK (status IN (
    'pending', 'processing', 'processed', 'failed'
  )),
  CONSTRAINT notification_deliveries_attempts_check CHECK (attempts >= 0),
  CONSTRAINT notification_deliveries_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT notification_deliveries_notification_fk FOREIGN KEY (notification_id)
    REFERENCES public.notifications (id) ON DELETE CASCADE,
  CONSTRAINT notification_deliveries_push_subscription_fk FOREIGN KEY (push_subscription_id)
    REFERENCES public.push_subscriptions (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.notification_deliveries IS
  'Durable outbound Web Push send queue (EPIC-15, D2) — one row per '
  '(notification, push subscription). A retry worker drains pending/failed '
  'rows with exponential backoff, the shipping_webhook_events shape reused '
  'for an outbound queue.';

CREATE INDEX notification_deliveries_keyset_idx
  ON public.notification_deliveries (company_id, created_at DESC, id DESC);
-- The retry worker's poll query: pending/failed rows due for another attempt.
CREATE INDEX notification_deliveries_pending_idx
  ON public.notification_deliveries (status, next_attempt_at);

CREATE TRIGGER notification_deliveries_touch_updated_at
  BEFORE UPDATE ON public.notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries FORCE  ROW LEVEL SECURITY;

CREATE POLICY notification_deliveries_insert ON public.notification_deliveries
  FOR INSERT
  WITH CHECK (company_id = app.current_company_id());

-- Widened for the platform-level retry worker only (mirrors the
-- shipping_webhook_events M12.4 precedent). A per-request tenant transaction
-- still sees exactly its own company's rows, unchanged.
CREATE POLICY notification_deliveries_select ON public.notification_deliveries
  FOR SELECT
  USING (company_id = app.current_company_id() OR app.current_company_id() IS NULL);

CREATE POLICY notification_deliveries_update ON public.notification_deliveries
  FOR UPDATE
  USING (company_id = app.current_company_id() OR app.current_company_id() IS NULL)
  WITH CHECK (company_id = app.current_company_id() OR app.current_company_id() IS NULL);
