-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Storage bucket admin_receipts + policies
-- ════════════════════════════════════════════════════════════════════
-- Bucket privado para fotos/PDFs de comprobantes de Noe.
-- Lectura solo via signed URL (Edge Function agent_admin OCR).
-- Policies en storage.objects scoped a bucket_id='admin_receipts'.
-- MIME permitidos: jpeg/png/pdf. Limite 10 MB.
-- ════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'admin_receipts',
  'admin_receipts',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies en storage.objects (scoped a este bucket).
DROP POLICY IF EXISTS "admin_receipts: select" ON storage.objects;
CREATE POLICY "admin_receipts: select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'admin_receipts' AND is_owner_or_admin());

DROP POLICY IF EXISTS "admin_receipts: insert" ON storage.objects;
CREATE POLICY "admin_receipts: insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'admin_receipts' AND is_owner_or_admin());

DROP POLICY IF EXISTS "admin_receipts: update" ON storage.objects;
CREATE POLICY "admin_receipts: update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'admin_receipts' AND is_owner_or_admin())
  WITH CHECK (bucket_id = 'admin_receipts' AND is_owner_or_admin());

DROP POLICY IF EXISTS "admin_receipts: delete" ON storage.objects;
CREATE POLICY "admin_receipts: delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'admin_receipts' AND is_owner_or_admin());

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP POLICY IF EXISTS "admin_receipts: select" ON storage.objects;
--   DROP POLICY IF EXISTS "admin_receipts: insert" ON storage.objects;
--   DROP POLICY IF EXISTS "admin_receipts: update" ON storage.objects;
--   DROP POLICY IF EXISTS "admin_receipts: delete" ON storage.objects;
--   -- Vaciar el bucket manualmente desde Storage UI antes de:
--   DELETE FROM storage.buckets WHERE id = 'admin_receipts';
-- ════════════════════════════════════════════════════════════════════
