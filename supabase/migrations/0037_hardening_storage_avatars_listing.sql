-- ════════════════════════════════════════════════════════════════════
-- HARDENING — bucket avatars: SELECT policy amplia → scoped por carpeta
-- ════════════════════════════════════════════════════════════════════
-- Lint de Supabase (public_bucket_allows_listing, nivel WARN):
--   El bucket público `avatars` tenía una policy SELECT amplia sobre
--   storage.objects — "avatars: read for anyone", USING (bucket_id =
--   'avatars'), roles {anon, authenticated}. Eso permite a cualquier
--   cliente LISTAR todos los archivos del bucket.
--
-- Contexto:
--   - El bucket `avatars` es público y está VACÍO (0 objetos).
--   - El frontend NO usa este bucket: los avatares de la UI se renderizan
--     desde la columna `profiles.avatar_color` (un color), no desde
--     imágenes subidas. No hay ningún `.storage`, `.upload()`, `.list()`
--     ni `getPublicUrl()` para avatars en data.js (web ni mobile).
--   - Las otras 3 policies del bucket (INSERT/UPDATE/DELETE) ya están
--     scoped a la carpeta propia: (storage.foldername(name))[1] =
--     auth.uid()::text. Solo la de SELECT estaba abierta.
--
-- Fix: reemplazar la policy SELECT amplia por una scoped, con el mismo
-- patrón que el resto del bucket:
--   - Se elimina `anon` del SELECT (ya no puede listar nada).
--   - `authenticated` solo ve su propia carpeta, o todo si es
--     owner/admin (rama is_owner_or_admin(), igual que "delete own
--     avatar").
--
-- Nota — el bucket SIGUE siendo público: el contenido de cada objeto se
-- sirve por su URL pública (/storage/v1/object/public/...), camino que
-- NO pasa por RLS. Esta policy solo gobierna el LISTADO de objetos.
-- Por eso mostrar un avatar por URL pública seguiría funcionando aunque
-- el frontend lo usara — que hoy no lo hace.
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "avatars: read for anyone" ON storage.objects;

CREATE POLICY "avatars: read own avatar"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      ((storage.foldername(name))[1] = (auth.uid())::text)
      OR is_owner_or_admin()
    )
  );

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, si se necesita restaurar la policy amplia original):
--   DROP POLICY IF EXISTS "avatars: read own avatar" ON storage.objects;
--   CREATE POLICY "avatars: read for anyone"
--     ON storage.objects FOR SELECT TO anon, authenticated
--     USING (bucket_id = 'avatars');
-- ════════════════════════════════════════════════════════════════════
