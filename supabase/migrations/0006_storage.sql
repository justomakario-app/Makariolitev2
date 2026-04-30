-- ═══════════════════════════════════════════════════════════════════════════
-- 0006_storage.sql — Storage buckets y policies
-- ───────────────────────────────────────────────────────────────────────────
-- 3 buckets:
--   - imports   (privado)  → archivos .xlsx subidos al importar pedidos
--   - qr-pdfs   (privado)  → PDFs generados con QRs (post-v1)
--   - avatars   (público)  → fotos de perfil (post-v1)
--
-- Estructura de paths convencional:
--   imports/{channel_id}/{YYYY-MM-DD}/{batch_id}.xlsx
--   qr-pdfs/{user_id}/{timestamp}.pdf
--   avatars/{user_id}.{ext}
--
-- Idempotente: ON CONFLICT DO UPDATE en buckets.
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. CREAR BUCKETS
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'imports',
  'imports',
  false,
  5242880,  -- 5 MB
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  -- .xlsx
    'application/vnd.ms-excel',                                            -- .xls
    'text/csv'                                                             -- .csv (fallback)
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'qr-pdfs',
  'qr-pdfs',
  false,
  10485760,  -- 10 MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,    -- bucket público — sin signed URL necesario
  1048576, -- 1 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. POLICIES — bucket "imports" (privado, solo admin/encargado leen)
-- ──────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "imports: read for admin or encargado" ON storage.objects;
CREATE POLICY "imports: read for admin or encargado"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'imports'
    AND (
      public.is_owner_or_admin()
      OR public.current_user_role() = 'encargado'
    )
  );

DROP POLICY IF EXISTS "imports: insert for admin or encargado" ON storage.objects;
CREATE POLICY "imports: insert for admin or encargado"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'imports'
    AND (
      public.is_owner_or_admin()
      OR public.current_user_role() = 'encargado'
    )
  );

DROP POLICY IF EXISTS "imports: update for owner" ON storage.objects;
CREATE POLICY "imports: update for owner"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'imports' AND public.is_owner())
  WITH CHECK (bucket_id = 'imports' AND public.is_owner());

DROP POLICY IF EXISTS "imports: delete for owner" ON storage.objects;
CREATE POLICY "imports: delete for owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'imports' AND public.is_owner());

-- ──────────────────────────────────────────────────────────────────────────
-- 3. POLICIES — bucket "qr-pdfs" (privado, signed URLs)
-- ──────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "qr-pdfs: read for authenticated" ON storage.objects;
CREATE POLICY "qr-pdfs: read for authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'qr-pdfs' AND public.is_active_user());

DROP POLICY IF EXISTS "qr-pdfs: insert for admin" ON storage.objects;
CREATE POLICY "qr-pdfs: insert for admin"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'qr-pdfs'
    AND public.is_owner_or_admin()
  );

DROP POLICY IF EXISTS "qr-pdfs: update for owner" ON storage.objects;
CREATE POLICY "qr-pdfs: update for owner"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'qr-pdfs' AND public.is_owner())
  WITH CHECK (bucket_id = 'qr-pdfs' AND public.is_owner());

DROP POLICY IF EXISTS "qr-pdfs: delete for owner" ON storage.objects;
CREATE POLICY "qr-pdfs: delete for owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'qr-pdfs' AND public.is_owner());

-- ──────────────────────────────────────────────────────────────────────────
-- 4. POLICIES — bucket "avatars" (público, cada user gestiona el suyo)
-- ──────────────────────────────────────────────────────────────────────────

-- Lectura pública (no necesita auth — bucket public=true igual lo permite,
-- pero declaramos policy explícita para claridad):
DROP POLICY IF EXISTS "avatars: read for anyone" ON storage.objects;
CREATE POLICY "avatars: read for anyone"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'avatars');

-- Cada user puede subir/modificar SOLO su propio avatar (path = {user_id}.ext)
DROP POLICY IF EXISTS "avatars: insert own avatar" ON storage.objects;
CREATE POLICY "avatars: insert own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars: update own avatar" ON storage.objects;
CREATE POLICY "avatars: update own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars: delete own avatar" ON storage.objects;
CREATE POLICY "avatars: delete own avatar"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_owner_or_admin()
    )
  );

-- ══════════════════════════════════════════════════════════════════════════
-- FIN 0006_storage.sql
-- ══════════════════════════════════════════════════════════════════════════
