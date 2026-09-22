-- Vendor <-> company messaging (EPIC-17 · M17.1).
--
-- One conversation per vendor: a `message_threads` row is keyed by
-- (company_id, warehouse_id), because a vendor membership is scoped to exactly
-- one warehouse (`company_members.warehouse_id`, Vendor Accounts Phase 1).
-- Staff see every thread in their company; a vendor sees only their own. That
-- split is enforced *at the database*, not just in the service, via
-- `app.current_member_warehouse_id()`: an unscoped member (NULL warehouse, i.e.
-- every non-vendor) passes the predicate for all rows, a warehouse-scoped
-- member passes only for their own warehouse.
--
-- A message carries a text body, image attachments, and references to orders.
-- Order references live in their own table (`message_order_refs`) rather than a
-- JSON column so that "every message that mentions order X" is an index hit,
-- and so the FK guarantees a mention can never outlive its order.
--
-- Attachment bytes are NOT stored here: `storage_key` points at the
-- S3-compatible object store (see packages/storage), and the row is the
-- tenant-scoped permission record for that object.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

-- ---------------------------------------------------------------------------
-- 1. Warehouse scope of the current member.
--
-- NULL means "not scoped" — either the caller has no membership in the active
-- tenant, or (the common case) they are an ordinary staff member who sees the
-- whole company. Callers must therefore treat NULL as "unrestricted", which is
-- what the messaging policies below do.
--
-- Deliberately NOT security definer: it reads `company_members` under the
-- caller's own RLS, which `company_members_access` (M4.3) permits for every row
-- of the active tenant — so a vendor always resolves their own scope. If that
-- policy is ever narrowed, this function starts returning NULL for vendors and
-- "unrestricted" would be the wrong reading of NULL: the messaging policies
-- would open every thread to them. Any change to `company_members_access` must
-- re-check `message_threads_tenant` below.
--
-- NULL is safe in the other direction: with no tenant context,
-- `app.current_company_id()` is NULL too, and the `company_id = ...` half of
-- every policy already yields no rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_member_warehouse_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = ''
AS $$
  SELECT m.warehouse_id
  FROM public.company_members m
  WHERE m.company_id = app.current_company_id()
    AND m.user_id = app.current_user_id();
$$;

COMMENT ON FUNCTION app.current_member_warehouse_id() IS
  'The warehouse the current member is scoped to in the active tenant, or NULL '
  'when the member is unscoped (ordinary staff) or has no membership.';

-- ---------------------------------------------------------------------------
-- 2. message_threads — one open conversation per vendor.
-- ---------------------------------------------------------------------------
CREATE TABLE public.message_threads (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL,
  warehouse_id         uuid        NOT NULL,
  vendor_member_id     uuid        NOT NULL,
  status               text        NOT NULL DEFAULT 'open',
  -- Denormalized from the newest message so the thread list renders without a
  -- correlated subquery per row. NULL until the first message is posted.
  last_message_at      timestamptz,
  last_message_preview text,
  created_by           uuid,
  updated_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_threads_pkey PRIMARY KEY (id),

  -- One thread per vendor, enforced at the DB layer: the service creates
  -- threads lazily on first send, so concurrent sends must not race into two.
  -- Single-column (not composite with company_id): a warehouse id already
  -- belongs to exactly one company, and the 1-1 shape is what the ORM needs.
  CONSTRAINT message_threads_warehouse_key UNIQUE (warehouse_id),
  CONSTRAINT message_threads_vendor_member_key UNIQUE (vendor_member_id),

  CONSTRAINT message_threads_status_check CHECK (status IN ('open', 'archived')),
  CONSTRAINT message_threads_preview_check CHECK (
    last_message_preview IS NULL OR char_length(last_message_preview) BETWEEN 1 AND 200
  ),

  CONSTRAINT message_threads_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT message_threads_warehouse_fk FOREIGN KEY (warehouse_id)
    REFERENCES public.warehouses (id) ON DELETE RESTRICT,
  CONSTRAINT message_threads_vendor_member_fk FOREIGN KEY (vendor_member_id)
    REFERENCES public.company_members (id) ON DELETE CASCADE,
  CONSTRAINT message_threads_created_by_fk FOREIGN KEY (created_by)
    REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT message_threads_updated_by_fk FOREIGN KEY (updated_by)
    REFERENCES public.profiles (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.message_threads IS
  'One vendor <-> company conversation, keyed by the vendor''s warehouse.';

-- Thread list: newest activity first, keyset-paginated. NULLS LAST keeps a
-- freshly created, still-empty thread at the bottom instead of the top.
CREATE INDEX message_threads_keyset_idx
  ON public.message_threads (company_id, last_message_at DESC NULLS LAST, id DESC);

CREATE INDEX message_threads_vendor_member_idx
  ON public.message_threads (vendor_member_id);

CREATE TRIGGER message_threads_touch_updated_at
  BEFORE UPDATE ON public.message_threads
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_threads FORCE  ROW LEVEL SECURITY;

-- Tenant isolation *plus* vendor isolation: a warehouse-scoped member can only
-- ever see/write the thread of their own warehouse.
CREATE POLICY message_threads_tenant ON public.message_threads
  USING (
    company_id = app.current_company_id()
    AND (
      app.current_member_warehouse_id() IS NULL
      OR warehouse_id = app.current_member_warehouse_id()
    )
  )
  WITH CHECK (
    company_id = app.current_company_id()
    AND (
      app.current_member_warehouse_id() IS NULL
      OR warehouse_id = app.current_member_warehouse_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. messages.
--
-- `body` is nullable because an image-only message is valid; the CHECK below
-- refuses an empty string. The "text or at least one attachment" rule cannot be
-- expressed here (attachment rows are linked after the insert), so the service
-- enforces that half.
--
-- Deletes are soft (`deleted_at`): a removed message keeps its row so the audit
-- trail and the order-reference history stay intact.
-- ---------------------------------------------------------------------------
CREATE TABLE public.messages (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL,
  thread_id          uuid        NOT NULL,
  sender_profile_id  uuid        NOT NULL,
  sender_kind        text        NOT NULL,
  body               text,
  edited_at          timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),

  CONSTRAINT messages_sender_kind_check CHECK (sender_kind IN ('vendor', 'staff')),
  CONSTRAINT messages_body_check CHECK (
    body IS NULL OR char_length(body) BETWEEN 1 AND 4000
  ),

  CONSTRAINT messages_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT messages_thread_fk FOREIGN KEY (thread_id)
    REFERENCES public.message_threads (id) ON DELETE CASCADE,
  CONSTRAINT messages_sender_fk FOREIGN KEY (sender_profile_id)
    REFERENCES public.profiles (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.messages IS
  'A single message in a vendor thread. Soft-deleted, never hard-deleted.';

CREATE INDEX messages_thread_keyset_idx
  ON public.messages (thread_id, created_at DESC, id DESC);

CREATE TRIGGER messages_touch_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE  ROW LEVEL SECURITY;

-- Rows inherit their thread's visibility: the EXISTS against message_threads
-- runs under that table's own policy, so vendor isolation applies here too
-- without restating the warehouse predicate.
CREATE POLICY messages_tenant ON public.messages
  USING (
    company_id = app.current_company_id()
    AND EXISTS (SELECT 1 FROM public.message_threads t WHERE t.id = thread_id)
  )
  WITH CHECK (
    company_id = app.current_company_id()
    AND EXISTS (SELECT 1 FROM public.message_threads t WHERE t.id = thread_id)
  );

-- ---------------------------------------------------------------------------
-- 4. message_attachments — one row per image.
--
-- The row is created by the upload endpoint *before* the message exists, so
-- `message_id` is nullable: an uploaded-but-unsent image is an orphan that the
-- cleanup job reaps after 24h (WHERE message_id IS NULL AND created_at < …).
-- ---------------------------------------------------------------------------
CREATE TABLE public.message_attachments (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL,
  message_id    uuid,
  uploaded_by   uuid        NOT NULL,
  storage_key   text        NOT NULL,
  mime_type     text        NOT NULL,
  size_bytes    integer     NOT NULL,
  width         integer     NOT NULL,
  height        integer     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_attachments_pkey PRIMARY KEY (id),

  CONSTRAINT message_attachments_storage_key_key UNIQUE (storage_key),

  -- Re-encoded server-side, so the stored type is always one we produced.
  CONSTRAINT message_attachments_mime_check CHECK (mime_type IN ('image/webp')),
  -- 5 MiB ceiling, matching the upload endpoint.
  CONSTRAINT message_attachments_size_check CHECK (size_bytes BETWEEN 1 AND 5242880),
  CONSTRAINT message_attachments_dimensions_check CHECK (width > 0 AND height > 0),

  CONSTRAINT message_attachments_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT message_attachments_message_fk FOREIGN KEY (message_id)
    REFERENCES public.messages (id) ON DELETE CASCADE,
  CONSTRAINT message_attachments_uploaded_by_fk FOREIGN KEY (uploaded_by)
    REFERENCES public.profiles (id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.message_attachments IS
  'An image attached to a message. Bytes live in object storage under '
  'storage_key; this row is the tenant-scoped permission record for them.';

CREATE INDEX message_attachments_message_idx
  ON public.message_attachments (message_id);

-- Orphan sweep: only ever scans the unattached rows.
CREATE INDEX message_attachments_orphan_idx
  ON public.message_attachments (created_at)
  WHERE message_id IS NULL;

CREATE TRIGGER message_attachments_touch_updated_at
  BEFORE UPDATE ON public.message_attachments
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments FORCE  ROW LEVEL SECURITY;

-- An unattached upload is visible only to its uploader; once attached, it
-- inherits the message's (and therefore the thread's) visibility.
CREATE POLICY message_attachments_tenant ON public.message_attachments
  USING (
    company_id = app.current_company_id()
    AND (
      (message_id IS NULL AND uploaded_by = app.current_user_id())
      OR EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id)
    )
  )
  WITH CHECK (
    company_id = app.current_company_id()
    AND (
      (message_id IS NULL AND uploaded_by = app.current_user_id())
      OR EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 5. message_order_refs — the "@order" mentions of a message.
--
-- `order_number` is a snapshot so a mention still renders after the order row
-- is gone in a restored/partial dataset; the FK keeps the two in step while
-- both exist.
-- ---------------------------------------------------------------------------
CREATE TABLE public.message_order_refs (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL,
  message_id   uuid        NOT NULL,
  order_id     uuid        NOT NULL,
  order_number text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_order_refs_pkey PRIMARY KEY (id),

  -- Mentioning the same order twice in one message is a no-op, not two rows.
  CONSTRAINT message_order_refs_message_order_key UNIQUE (message_id, order_id),

  CONSTRAINT message_order_refs_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT message_order_refs_message_fk FOREIGN KEY (message_id)
    REFERENCES public.messages (id) ON DELETE CASCADE,
  CONSTRAINT message_order_refs_order_fk FOREIGN KEY (order_id)
    REFERENCES public.orders (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.message_order_refs IS
  'An order referenced from a message (the "@" mention). One row per '
  '(message, order); order_number is a display snapshot.';

-- "Every message that mentions this order", for the order timeline.
CREATE INDEX message_order_refs_order_idx
  ON public.message_order_refs (company_id, order_id, created_at DESC);

CREATE INDEX message_order_refs_message_idx
  ON public.message_order_refs (message_id);

ALTER TABLE public.message_order_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_order_refs FORCE  ROW LEVEL SECURITY;

CREATE POLICY message_order_refs_tenant ON public.message_order_refs
  USING (
    company_id = app.current_company_id()
    AND EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id)
  )
  WITH CHECK (
    company_id = app.current_company_id()
    AND EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id)
  );

-- ---------------------------------------------------------------------------
-- 6. message_reads — the per-participant read cursor.
--
-- A timestamp cursor rather than a per-message read row: unread count is then
-- one indexed COUNT on messages, and the table stays one row per participant.
-- ---------------------------------------------------------------------------
CREATE TABLE public.message_reads (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL,
  thread_id    uuid        NOT NULL,
  profile_id   uuid        NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_reads_pkey PRIMARY KEY (id),

  CONSTRAINT message_reads_thread_profile_key UNIQUE (thread_id, profile_id),

  CONSTRAINT message_reads_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT message_reads_thread_fk FOREIGN KEY (thread_id)
    REFERENCES public.message_threads (id) ON DELETE CASCADE,
  CONSTRAINT message_reads_profile_fk FOREIGN KEY (profile_id)
    REFERENCES public.profiles (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.message_reads IS
  'Per-participant read cursor for a thread; drives the unread badge.';

CREATE TRIGGER message_reads_touch_updated_at
  BEFORE UPDATE ON public.message_reads
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads FORCE  ROW LEVEL SECURITY;

-- Your own cursor only: one member must never read or move another's.
CREATE POLICY message_reads_tenant ON public.message_reads
  USING (
    company_id = app.current_company_id()
    AND profile_id = app.current_user_id()
  )
  WITH CHECK (
    company_id = app.current_company_id()
    AND profile_id = app.current_user_id()
  );

-- ---------------------------------------------------------------------------
-- 7. New notification type: 'message.received'.
--
-- Widens the two EPIC-15 closed-set CHECKs. Purely additive.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'order.created', 'order.status_changed', 'payment.collected',
    'order_vendor_group.assigned', 'message.received'
  ));

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT notification_preferences_type_check;

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_type_check CHECK (type IN (
    'order.created', 'order.status_changed', 'payment.collected',
    'order_vendor_group.assigned', 'message.received'
  ));
