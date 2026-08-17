-- ============================================================================
-- 0156 — Bucket `b2b_fotos` (fotos de producto de la tienda mayorista)
-- ============================================================================
--
-- POR QUE EXISTE
-- `b2b_producto.foto_path` (0152) guarda una ruta, no una imagen. Sin bucket la
-- ruta apunta a la nada y `tienda/components/tienda-catalogo.jsx` dibuja el
-- recuadro vacio de fallback. La tienda funciona igual — pero un catalogo de
-- muebles sin fotos se vende peor, asi que esto deja el lugar listo.
--
-- POR QUE EL BUCKET ES PUBLICO
-- El storefront resuelve la imagen con `getPublicUrl()` (tienda-catalogo.jsx:27),
-- que para un bucket privado devuelve una URL que da 400. La alternativa seria
-- `createSignedUrl()` por cada tarjeta: una llamada extra por producto, URLs que
-- vencen y se rompen si el cliente deja la pestaña abierta. No vale la pena,
-- porque lo confidencial de esta tienda NO es la foto — es el precio, y el
-- precio nunca sale de `b2b_rpc_catalogo()`, que ya filtra por canal.
-- Son los mismos muebles que se publican en la web y en MercadoLibre.
--
-- Igual "publico" no significa "abierto": publico habilita LEER un objeto si ya
-- sabes la ruta exacta. No habilita listar el bucket ni subir ni borrar — eso
-- sigue pasando por las policies de abajo, que son solo owner/admin.
--
-- CONVENCION DE RUTAS
--   b2b_fotos/<b2b_producto.id>/<nombre-archivo>
-- Una carpeta por producto: borrar el producto = borrar su carpeta, y dos SKU
-- nunca se pisan un archivo con el mismo nombre.
-- ============================================================================

-- ── El bucket ───────────────────────────────────────────────────────────────
-- 2 MB y solo imagenes. El limite lo aplica Storage antes de escribir: no hace
-- falta validar del lado del navegador para que no entre un PDF de 40 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('b2b_fotos', 'b2b_fotos', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set public            = excluded.public,
       file_size_limit   = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ── Policies ────────────────────────────────────────────────────────────────
-- Idempotentes: esta migracion se puede correr de nuevo sin romper nada.
drop policy if exists "b2b_fotos: select" on storage.objects;
drop policy if exists "b2b_fotos: insert" on storage.objects;
drop policy if exists "b2b_fotos: update" on storage.objects;
drop policy if exists "b2b_fotos: delete" on storage.objects;

-- SELECT: para LISTAR desde la API (el getPublicUrl del storefront no pasa por
-- aca). Cualquier usuario interno activo puede listar; el mayorista no necesita
-- listar nada, recibe las rutas dentro del catalogo.
create policy "b2b_fotos: select" on storage.objects
  for select to authenticated
  using (bucket_id = 'b2b_fotos' and public.is_active_user());

-- INSERT / UPDATE / DELETE: solo quien administra el catalogo.
create policy "b2b_fotos: insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'b2b_fotos' and public.is_owner_or_admin());

create policy "b2b_fotos: update" on storage.objects
  for update to authenticated
  using      (bucket_id = 'b2b_fotos' and public.is_owner_or_admin())
  with check (bucket_id = 'b2b_fotos' and public.is_owner_or_admin());

create policy "b2b_fotos: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'b2b_fotos' and public.is_owner_or_admin());
