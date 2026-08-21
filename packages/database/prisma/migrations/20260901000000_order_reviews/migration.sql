-- Order Reviews feature.
--
-- A one-time, immutable customer review attached to one order (delivered or
-- completed). Exactly one review per order (order_reviews_order_key), no
-- update path — create-only, matching the product decision that a saved
-- review can never be edited. Entirely optional: an order can sit in
-- delivered/completed forever with no review row and that's a normal state,
-- not an error.
--
-- `customer_id` is denormalized from `orders.customer_id` (matches the rest
-- of the schema's tenant-row-scoping style). `CustomersRepository.merge()`
-- must re-parent it alongside orders/customer_addresses — see
-- `CUSTOMER_OWNED_TABLES` in customers.repository.ts.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

CREATE TABLE public.order_reviews (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id               uuid        NOT NULL,
  order_id                 uuid        NOT NULL,
  customer_id              uuid        NOT NULL,
  product_type             text        NOT NULL,
  gift_recipient_name      text,
  gift_recipient_relation  text,
  gift_occasion            text,
  quality_rating           integer     NOT NULL,
  quality_low_reason       text,
  packaging_rating         integer     NOT NULL,
  packaging_low_reason     text,
  shipping_rating          integer     NOT NULL,
  shipping_low_reason      text,
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_reviews_pkey PRIMARY KEY (id),

  -- One review per order, enforced at the DB layer (not just app-level).
  CONSTRAINT order_reviews_order_key UNIQUE (order_id),

  CONSTRAINT order_reviews_product_type_check CHECK (product_type IN (
    'clothes', 'electronics', 'gifts'
  )),

  CONSTRAINT order_reviews_quality_rating_check   CHECK (quality_rating   BETWEEN 1 AND 5),
  CONSTRAINT order_reviews_packaging_rating_check CHECK (packaging_rating BETWEEN 1 AND 5),
  CONSTRAINT order_reviews_shipping_rating_check  CHECK (shipping_rating  BETWEEN 1 AND 5),

  -- A low rating (1-2) requires its own reason; a rating of 3-5 must not
  -- carry one — keeps the "why" field meaningful, never stale/contradictory.
  CONSTRAINT order_reviews_quality_reason_check CHECK (
    (quality_rating <= 2 AND quality_low_reason IS NOT NULL
      AND char_length(quality_low_reason) BETWEEN 1 AND 1000)
    OR (quality_rating > 2 AND quality_low_reason IS NULL)
  ),
  CONSTRAINT order_reviews_packaging_reason_check CHECK (
    (packaging_rating <= 2 AND packaging_low_reason IS NOT NULL
      AND char_length(packaging_low_reason) BETWEEN 1 AND 1000)
    OR (packaging_rating > 2 AND packaging_low_reason IS NULL)
  ),
  CONSTRAINT order_reviews_shipping_reason_check CHECK (
    (shipping_rating <= 2 AND shipping_low_reason IS NOT NULL
      AND char_length(shipping_low_reason) BETWEEN 1 AND 1000)
    OR (shipping_rating > 2 AND shipping_low_reason IS NULL)
  ),

  -- Gift-only fields: present together only when product_type = 'gifts'.
  CONSTRAINT order_reviews_gift_fields_check CHECK (
    (product_type = 'gifts'
      AND gift_recipient_name IS NOT NULL AND char_length(gift_recipient_name) BETWEEN 1 AND 200
      AND gift_recipient_relation IS NOT NULL AND char_length(gift_recipient_relation) BETWEEN 1 AND 200
      AND gift_occasion IS NOT NULL AND char_length(gift_occasion) BETWEEN 1 AND 200)
    OR (product_type <> 'gifts'
      AND gift_recipient_name IS NULL AND gift_recipient_relation IS NULL AND gift_occasion IS NULL)
  ),

  CONSTRAINT order_reviews_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE,
  CONSTRAINT order_reviews_order_fk FOREIGN KEY (order_id)
    REFERENCES public.orders (id) ON DELETE CASCADE,
  CONSTRAINT order_reviews_customer_fk FOREIGN KEY (customer_id)
    REFERENCES public.customers (id) ON DELETE RESTRICT,
  CONSTRAINT order_reviews_created_by_fk FOREIGN KEY (created_by)
    REFERENCES public.profiles (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.order_reviews IS
  'One-time customer review per order (create-only, no update path). '
  'Optional — a delivered/completed order with no row is a normal state.';

CREATE INDEX order_reviews_customer_idx
  ON public.order_reviews (company_id, customer_id, created_at DESC);

ALTER TABLE public.order_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_reviews FORCE  ROW LEVEL SECURITY;

CREATE POLICY order_reviews_tenant ON public.order_reviews
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
