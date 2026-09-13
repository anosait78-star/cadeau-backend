-- Order delivery snapshot (2026-09-13).
--
-- An order's delivery name and address used to live only on the customer, so a
-- returning customer ordering to a new address silently re-routed every one of
-- their older, not-yet-shipped orders — and the shipment form prefilled the
-- newest address for them too. Each order now keeps its own copy.
--
-- Additive and nullable. Deliberately NO data backfill in this file: `orders`
-- has FORCE ROW LEVEL SECURITY and a migration runs with no tenant context, so
-- an UPDATE here would match zero rows and still report success. The one-time
-- backfill runs separately as a superuser (see the deploy notes). Until it
-- does, the application falls back to the customer's current default address
-- for any order without a snapshot — exactly today's behaviour.
--
-- `delivery_line_encrypted` holds the same AES-256-GCM token format as
-- customer_addresses.line_encrypted under the same application key, so the
-- backfill copies tokens across without decrypting anything.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.orders
  ADD COLUMN delivery_name           text,
  ADD COLUMN delivery_line_encrypted text,
  ADD COLUMN delivery_landmark       text,
  ADD COLUMN delivery_raw_city       text,
  ADD COLUMN delivery_raw_state      text;

COMMENT ON COLUMN public.orders.delivery_name IS
  'Recipient name captured when the order was placed; later customer edits never rewrite it.';
COMMENT ON COLUMN public.orders.delivery_line_encrypted IS
  'AES-256-GCM token of the delivery address line; never plaintext.';
