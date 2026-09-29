-- Arabic-aware search folding.
--
-- `ILIKE '%…%'`, which is what every `q` filter compiles to today, compares
-- characters. In Arabic that means a search for "ازرق" does not match "أزرق",
-- "عبايه" does not match "عباية", and "مصطفي" does not match "مصطفى" — the
-- same word, spelled the way people actually type it, finds nothing. The order
-- form's product picker looked like it was missing products for exactly this
-- reason.
--
-- `app.search_fold` collapses those spellings so both sides of a comparison
-- can be folded before matching. It mirrors `foldForSearch` in
-- apps/web/src/lib/search-text.ts, and the two must stay in step: a rule added
-- on one side only means the server hides a row the client would have shown.
--
-- IMMUTABLE (it depends on nothing but its input) so it can be indexed, which
-- is what keeps `WHERE app.search_fold(name) LIKE …` from scanning the table.
--
-- Forward-only. Rollback guidance: ../../../../docs/runbooks/rollback.md

CREATE OR REPLACE FUNCTION app.search_fold(value text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  RETURNS NULL ON NULL INPUT
  SET search_path = ''
AS $$
  SELECT pg_catalog.btrim(
    -- 3. Runs of whitespace collapse to one, so "قميص   قطن" and "قميص قطن"
    --    fold alike.
    pg_catalog.regexp_replace(
      -- 2. Tashkeel (U+064B..U+0652) and the tatweel elongation character are
      --    dropped: they decorate a word without changing which word it is.
      pg_catalog.regexp_replace(
        -- 1. Alef forms, ta marbuta and alef maqsura collapse to one spelling,
        --    and Arabic-Indic and Persian digits to ASCII. `translate` maps
        --    character to character, each source lining up with the target at
        --    the same position.
        pg_catalog.translate(
          pg_catalog.lower(value),
          'أإآةى' || '٠١٢٣٤٥٦٧٨٩' || '۰۱۲۳۴۵۶۷۸۹',
          'اااهي' || '0123456789' || '0123456789'
        ),
        '[ً-ْـ]',
        '',
        'g'
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

COMMENT ON FUNCTION app.search_fold(text) IS
  'Folds Arabic spelling variants, Arabic-Indic digits and case for search '
  'comparison. Mirrors foldForSearch() in the web app. Never for storage.';

-- ---------------------------------------------------------------------------
-- Indexes over the folded text.
--
-- `text_pattern_ops` serves the prefix half of a `LIKE 'x%'`; an infix
-- `LIKE '%x%'` still scans, but over a far smaller set once the tenant
-- predicate has been applied. Trigram indexes would serve infix search
-- properly and are the next step if these tables grow large enough to need it
-- (pg_trgm is not currently installed).
-- ---------------------------------------------------------------------------
CREATE INDEX products_name_folded_idx
  ON public.products (company_id, app.search_fold(name) text_pattern_ops);

CREATE INDEX product_variants_name_folded_idx
  ON public.product_variants (company_id, app.search_fold(name) text_pattern_ops);

CREATE INDEX product_variants_sku_folded_idx
  ON public.product_variants (company_id, app.search_fold(sku) text_pattern_ops)
  WHERE sku IS NOT NULL;
