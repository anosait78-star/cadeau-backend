-- Settings > WhatsApp (settings follow-up epic): a per-company dialing prefix
-- plus reusable message templates. `whatsapp_templates` follows the same
-- tenant-editable master-data shape as `order_labels`/`order_reasons`
-- (soft-delete via is_active, FORCE RLS by company_id).
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

ALTER TABLE public.companies
  ADD COLUMN whatsapp_country_code text NULL;

CREATE TABLE public.whatsapp_templates (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL,
  name       text        NOT NULL,
  body       text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_templates_pkey PRIMARY KEY (id),
  CONSTRAINT whatsapp_templates_company_name_key UNIQUE (company_id, name),
  CONSTRAINT whatsapp_templates_company_fk FOREIGN KEY (company_id)
    REFERENCES public.companies (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.whatsapp_templates IS
  'Reusable WhatsApp message templates. Tenant-editable master data.';

CREATE INDEX whatsapp_templates_keyset_idx ON public.whatsapp_templates (company_id, name, id);
CREATE INDEX whatsapp_templates_created_keyset_idx
  ON public.whatsapp_templates (company_id, created_at DESC, id DESC);

CREATE TRIGGER whatsapp_templates_touch_updated_at
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates FORCE  ROW LEVEL SECURITY;

CREATE POLICY whatsapp_templates_tenant ON public.whatsapp_templates
  USING (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());
