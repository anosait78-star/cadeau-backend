-- EPIC-16 launch-gate onboarding — company profile fields collected on the
-- "create company" screen (docs: onboarding plan, company creation form).
--
-- All columns are nullable at the DB level: existing companies (and any seed
-- data) are unaffected. Required-ness of phone/monthlyOrdersRange for new
-- companies is enforced by CreateCompanyDto validation, not a DB constraint.
--
-- monthly_orders_range is a bounded set of values but kept as free text with a
-- CHECK constraint (not a Postgres enum) to match the DTO's own IsIn list and
-- keep future value additions a plain migration instead of an enum ALTER.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.companies
  ADD COLUMN country              text NULL,
  ADD COLUMN phone                text NULL,
  ADD COLUMN monthly_orders_range text NULL,
  ADD COLUMN facebook_handle      text NULL,
  ADD COLUMN instagram_handle     text NULL,
  ADD COLUMN website_url          text NULL,
  ADD COLUMN shipping_carrier     text NULL;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_monthly_orders_range_check
  CHECK (
    monthly_orders_range IS NULL
    OR monthly_orders_range IN (
      'under_100', '100_500', '500_1000', '1000_2000', '2000_5000', 'over_5000'
    )
  );
