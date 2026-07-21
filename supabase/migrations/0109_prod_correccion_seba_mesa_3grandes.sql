-- 0109 · CORRECCIÓN de Seba: MESA individual (no rectangular) = 3 patas GRANDES (PAT004), NO 3 chicas.
-- Anula el mapeo anterior de "mesa = 3 chicas". Precedencia: YORI/HIKARI → rectangular → set → mesa.
-- Las 10 mesas individuales quedan todas en 1×PAT004 (3 grandes). Sin duplicar componentes.
-- (Aplicada en remoto vía MCP el 2026-07-20; reconstruida como archivo local — no re-ejecutar.)

delete from public.prod_componente
  where padre_sku in ('MAD010','MAD011','MAD020','MAD021','MAD030','MAD031','MAD040','MAD041','MAD051','MAD052')
    and hijo_sku like 'PAT%';
insert into public.prod_componente (padre_sku, hijo_sku, cantidad)
  select unnest(array['MAD010','MAD011','MAD020','MAD021','MAD030','MAD031','MAD040','MAD041','MAD051','MAD052']), 'PAT004', 1;

update public.prod_producto set patas_tipo='grande', patas_cant=3
  where sku in ('MAD010','MAD011','MAD020','MAD021','MAD030','MAD031','MAD040','MAD041','MAD051','MAD052');
