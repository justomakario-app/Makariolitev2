-- Fix brand name used by exported documents.
-- Safe forward migration: no schema removal, no data loss.

SET search_path = public;

ALTER TABLE IF EXISTS public.company_settings
  ALTER COLUMN razon_social SET DEFAULT 'Justo Makario';

UPDATE public.company_settings
   SET razon_social = 'Justo Makario',
       updated_at = now()
 WHERE trim(COALESCE(razon_social, '')) = ''
    OR lower(trim(razon_social)) IN (
      'macario',
      'makario',
      'c macario',
      'c makario',
      'justo macario',
      'justo makario',
      'macario lite',
      'makario lite'
    )
    OR lower(razon_social) LIKE '%macario%'
    OR lower(razon_social) LIKE '%makario%';
