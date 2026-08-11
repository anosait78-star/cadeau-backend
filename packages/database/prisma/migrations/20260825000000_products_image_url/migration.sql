-- Add an optional display image URL to products (storefront-sync images).
-- Additive, backward compatible: nullable, no default-value backfill needed.
ALTER TABLE "products" ADD COLUMN "image_url" TEXT;
