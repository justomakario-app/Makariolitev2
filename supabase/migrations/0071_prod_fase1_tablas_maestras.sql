-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN EN LÍNEA — Fase 1 (brief Sebas v2.0)
-- ════════════════════════════════════════════════════════════════════
-- Tablas maestras + operación diaria + stock por eslabón + soporte,
-- vistas de cálculo, triggers y RLS. TODO bajo prefijo prod_ — aislamiento
-- total. CERO modificación de tablas existentes (solo se LEEN orders y
-- carrier_state en las vistas; los FK a orders/auth.users no las alteran).
--
-- ── Adaptaciones (validadas con Jefe) ────────────────────────────────
--  1. Roles vía profiles.role (current_user_role()), NO app_metadata.
--  2. "producido" no existe en orders → las vistas lo toman de
--     carrier_state (LEFT JOIN por channel_id+sku) = demanda NETA.
--  3. orders.status no tiene 'despachado' → se compara status::text.
--  4. La Edge Function import-skus queda para Fase 1b (el Excel real no
--     coincide con el parser del brief).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════ CAPA 0 — DATOS MAESTROS ═══════════════

CREATE TABLE IF NOT EXISTS public.prod_pieza (
  sku text PRIMARY KEY,
  nombre text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prod_placa (
  sku text PRIMARY KEY,
  nombre text,
  material text,
  rendimiento integer,
  pieza_sku text REFERENCES public.prod_pieza(sku) ON DELETE SET NULL,
  combinada boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prod_placa_pieza_extra (
  placa_sku text REFERENCES public.prod_placa(sku) ON DELETE CASCADE,
  pieza_sku text REFERENCES public.prod_pieza(sku) ON DELETE CASCADE,
  rendimiento integer,
  PRIMARY KEY (placa_sku, pieza_sku)
);

CREATE TABLE IF NOT EXISTS public.prod_producto (
  sku text PRIMARY KEY,
  nombre text,
  color text,
  tipo text CHECK (tipo IN ('simple','combinado')),
  patas_tipo text CHECK (patas_tipo IN ('chica','grande') OR patas_tipo IS NULL),
  patas_cant integer DEFAULT 0,
  kit_embalaje jsonb DEFAULT '{}'::jsonb,
  activo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prod_receta (
  producto_sku text REFERENCES public.prod_producto(sku) ON DELETE CASCADE,
  pieza_sku text REFERENCES public.prod_pieza(sku) ON DELETE RESTRICT,
  cantidad integer DEFAULT 1,
  PRIMARY KEY (producto_sku, pieza_sku)
);

CREATE TABLE IF NOT EXISTS public.prod_insumo (
  sku text PRIMARY KEY,
  nombre text,
  categoria text,
  sector text,
  stock_actual numeric DEFAULT 0,
  stock_minimo numeric DEFAULT 0,
  unidad text DEFAULT 'u',
  updated_at timestamptz DEFAULT now()
);

-- ═══════════════ CAPAS 2-4 — OPERACIÓN DIARIA ═══════════════

CREATE TABLE IF NOT EXISTS public.prod_jornada (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha date UNIQUE NOT NULL,
  estado text DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada')),
  abierta_por uuid REFERENCES auth.users(id),
  abierta_at timestamptz DEFAULT now(),
  cerrada_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.prod_corte (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  jornada_id uuid REFERENCES public.prod_jornada(id) ON DELETE CASCADE,
  placa_sku text REFERENCES public.prod_placa(sku) ON DELETE RESTRICT,
  hojas integer CHECK (hojas >= 0),
  desperdicio integer DEFAULT 0,
  cargado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  editable_hasta timestamptz DEFAULT (now() + interval '24 hours')
);

CREATE TABLE IF NOT EXISTS public.prod_melamina (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  jornada_id uuid REFERENCES public.prod_jornada(id) ON DELETE CASCADE,
  pieza_sku text REFERENCES public.prod_pieza(sku) ON DELETE RESTRICT,
  terminadas integer DEFAULT 0,
  fallas integer DEFAULT 0,
  cargado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  editable_hasta timestamptz DEFAULT (now() + interval '24 hours')
);

CREATE TABLE IF NOT EXISTS public.prod_embalaje (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  jornada_id uuid REFERENCES public.prod_jornada(id) ON DELETE CASCADE,
  producto_sku text REFERENCES public.prod_producto(sku) ON DELETE RESTRICT,
  unidades integer CHECK (unidades >= 0),
  canal text,
  cargado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prod_pino (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  jornada_id uuid REFERENCES public.prod_jornada(id) ON DELETE CASCADE,
  tamano text CHECK (tamano IN ('chica','grande')),
  terminadas integer DEFAULT 0,
  masilladas integer DEFAULT 0,
  cargado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  editable_hasta timestamptz DEFAULT (now() + interval '24 hours')
);

-- ═══════════════ STOCK POR ESLABÓN ═══════════════

CREATE TABLE IF NOT EXISTS public.prod_stock_pieza (
  pieza_sku text PRIMARY KEY REFERENCES public.prod_pieza(sku) ON DELETE CASCADE,
  disponible integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.prod_stock_melamina (
  pieza_sku text PRIMARY KEY REFERENCES public.prod_pieza(sku) ON DELETE CASCADE,
  disponible integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.prod_stock_patas (
  tamano text PRIMARY KEY CHECK (tamano IN ('chica','grande')),
  disponible integer DEFAULT 0,
  masilladas integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.prod_stock_terminado (
  producto_sku text PRIMARY KEY REFERENCES public.prod_producto(sku) ON DELETE CASCADE,
  disponible integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- ═══════════════ SOPORTE ═══════════════

CREATE TABLE IF NOT EXISTS public.prod_solicitud (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  jornada_id uuid REFERENCES public.prod_jornada(id) ON DELETE SET NULL,
  sector text,
  items jsonb,
  estado text DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobada_coord','recepcionada_admin')),
  solicitado_por uuid REFERENCES auth.users(id),
  aprobado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prod_mantenimiento (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sector text,
  tipo text,
  urgencia text CHECK (urgencia IN ('alta','media','baja')),
  maquina text,
  descripcion text,
  estado text DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado_coord','recibido_director')),
  reportado_por uuid REFERENCES auth.users(id),
  aprobado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prod_remito (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  proveedor text,
  nro_remito text,
  fecha date,
  items jsonb,
  cargado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prod_alerta (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  insumo_sku text REFERENCES public.prod_insumo(sku) ON DELETE CASCADE,
  nivel text CHECK (nivel IN ('critico','bajo')),
  stock_actual numeric,
  stock_minimo numeric,
  vista boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prod_auditoria (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tabla text,
  registro_id uuid,
  sector text,
  campo text,
  valor_anterior text,
  valor_nuevo text,
  motivo text,
  modificado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Puente "listo para despacho" — referencia orders por FK, NO la modifica.
CREATE TABLE IF NOT EXISTS public.prod_pedido_estado (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  estado text DEFAULT 'listo_despacho',
  producto_sku text REFERENCES public.prod_producto(sku) ON DELETE SET NULL,
  cantidad integer,
  registrado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Índices de FK más consultados
CREATE INDEX IF NOT EXISTS prod_corte_jornada_idx    ON public.prod_corte(jornada_id);
CREATE INDEX IF NOT EXISTS prod_melamina_jornada_idx ON public.prod_melamina(jornada_id);
CREATE INDEX IF NOT EXISTS prod_embalaje_jornada_idx ON public.prod_embalaje(jornada_id);
CREATE INDEX IF NOT EXISTS prod_pino_jornada_idx     ON public.prod_pino(jornada_id);
CREATE INDEX IF NOT EXISTS prod_receta_pieza_idx     ON public.prod_receta(pieza_sku);

-- ═══════════════ TRIGGERS ═══════════════

-- updated_at (reusa set_updated_at de 0001)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prod_insumo','prod_stock_pieza','prod_stock_melamina','prod_stock_patas','prod_stock_terminado'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t || '_updated_at', t);
  END LOOP;
END $$;

-- Alerta de stock bajo en prod_insumo
CREATE OR REPLACE FUNCTION public.prod_fn_alerta_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.stock_actual < NEW.stock_minimo THEN
    INSERT INTO public.prod_alerta (insumo_sku, nivel, stock_actual, stock_minimo)
    VALUES (NEW.sku,
            CASE WHEN NEW.stock_actual < NEW.stock_minimo * 0.5 THEN 'critico' ELSE 'bajo' END,
            NEW.stock_actual, NEW.stock_minimo);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prod_insumo_alerta ON public.prod_insumo;
CREATE TRIGGER prod_insumo_alerta AFTER UPDATE ON public.prod_insumo
  FOR EACH ROW EXECUTE FUNCTION public.prod_fn_alerta_stock();

-- Auditoría: si modifica encargado/owner/admin → 1 fila por campo cambiado.
-- motivo/sector se leen de un GUC de sesión (set_config('prod.audit_motivo',…)).
CREATE OR REPLACE FUNCTION public.prod_fn_auditoria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rol role_enum; k text; v_old text; v_new text; v_motivo text; v_sector text;
BEGIN
  v_rol := public.current_user_role();
  IF v_rol IS NULL OR v_rol NOT IN ('encargado','owner','admin') THEN RETURN NEW; END IF;
  v_motivo := NULLIF(current_setting('prod.audit_motivo', true), '');
  v_sector := NULLIF(current_setting('prod.audit_sector', true), '');
  FOR k IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
    IF k IN ('id','created_at','updated_at','editable_hasta','cargado_por') THEN CONTINUE; END IF;
    v_old := to_jsonb(OLD)->>k; v_new := to_jsonb(NEW)->>k;
    IF v_old IS DISTINCT FROM v_new THEN
      INSERT INTO public.prod_auditoria (tabla, registro_id, sector, campo, valor_anterior, valor_nuevo, motivo, modificado_por)
      VALUES (TG_TABLE_NAME, NEW.id, v_sector, k, v_old, v_new, v_motivo, auth.uid());
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prod_corte','prod_melamina','prod_embalaje','prod_pino'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_auditoria', t);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prod_fn_auditoria()', t || '_auditoria', t);
  END LOOP;
END $$;

-- ═══════════════ VISTAS DE CÁLCULO ═══════════════

-- Cortes del día
CREATE OR REPLACE VIEW public.prod_v_cortes_dia AS
  SELECT c.jornada_id, c.placa_sku, p.nombre AS modelo, p.material, c.hojas,
         (c.hojas * COALESCE(p.rendimiento,0)) AS generadas, c.desperdicio,
         GREATEST(c.hojas * COALESCE(p.rendimiento,0) - c.desperdicio, 0) AS totales
  FROM public.prod_corte c
  JOIN public.prod_placa p ON p.sku = c.placa_sku;

-- Demanda de piezas (TAP) desde orders — NETA (resta producido de carrier_state)
CREATE OR REPLACE VIEW public.prod_v_demanda_tap AS
  WITH neto AS (
    SELECT o.sku, o.channel_id, SUM(o.cantidad) AS pedido
    FROM public.orders o
    WHERE o.status::text <> 'despachado'
    GROUP BY o.sku, o.channel_id
  )
  SELECT r.pieza_sku,
         SUM(GREATEST(n.pedido - COALESCE(cs.producido,0), 0) * r.cantidad)::numeric AS demanda
  FROM neto n
  JOIN public.prod_receta r ON r.producto_sku = n.sku
  LEFT JOIN public.carrier_state cs ON cs.channel_id = n.channel_id AND cs.sku = n.sku
  GROUP BY r.pieza_sku;

-- Productos armables (cuello de botella)
CREATE OR REPLACE VIEW public.prod_v_armables AS
  SELECT p.sku AS producto_sku, p.nombre,
         LEAST(
           COALESCE(MIN(FLOOR(COALESCE(sm.disponible,0)::numeric / NULLIF(r.cantidad,0))), 0),
           CASE WHEN p.patas_cant > 0 THEN FLOOR(COALESCE(sp.disponible,0)::numeric / p.patas_cant) ELSE 2147483647 END
         )::integer AS armables
  FROM public.prod_producto p
  LEFT JOIN public.prod_receta r ON r.producto_sku = p.sku
  LEFT JOIN public.prod_stock_melamina sm ON sm.pieza_sku = r.pieza_sku
  LEFT JOIN public.prod_stock_patas sp ON sp.tamano = p.patas_tipo
  GROUP BY p.sku, p.nombre, p.patas_cant, sp.disponible;

-- Prioridad Melamina (demanda - stock propio)
CREATE OR REPLACE VIEW public.prod_v_prioridad_melamina AS
  SELECT d.pieza_sku, d.demanda,
         COALESCE(sm.disponible,0) AS stock_propio,
         GREATEST(d.demanda - COALESCE(sm.disponible,0), 0) AS falta,
         COALESCE(sp.disponible,0) AS crudo_cnc
  FROM public.prod_v_demanda_tap d
  LEFT JOIN public.prod_stock_melamina sm ON sm.pieza_sku = d.pieza_sku
  LEFT JOIN public.prod_stock_pieza   sp ON sp.pieza_sku = d.pieza_sku
  WHERE GREATEST(d.demanda - COALESCE(sm.disponible,0), 0) > 0
  ORDER BY falta DESC;

-- Resumen del día (espejo vivo de orders, neto)
CREATE OR REPLACE VIEW public.prod_v_resumen_dia AS
  WITH neto AS (
    SELECT o.sku, o.channel_id, SUM(o.cantidad) AS pedido
    FROM public.orders o
    WHERE o.status::text <> 'despachado'
    GROUP BY o.sku, o.channel_id
  )
  SELECT pr.sku AS producto_sku, pr.nombre, pr.color,
         SUM(GREATEST(n.pedido - COALESCE(cs.producido,0), 0))::integer AS pendiente
  FROM neto n
  JOIN public.prod_producto pr ON pr.sku = n.sku
  LEFT JOIN public.carrier_state cs ON cs.channel_id = n.channel_id AND cs.sku = n.sku
  GROUP BY pr.sku, pr.nombre, pr.color
  HAVING SUM(GREATEST(n.pedido - COALESCE(cs.producido,0), 0)) > 0;

-- ═══════════════ RLS ═══════════════
-- Patrón: current_user_role() (profiles.role del usuario activo).
--  • SELECT amplio: cualquier usuario activo (current_user_role() IS NOT NULL).
--  • Maestras: escritura owner/admin.
--  • Registro por sector: coordinador (su tabla) INSERT/SELECT; UPDATE 24h;
--    encargado/owner/admin SELECT+UPDATE.

ALTER TABLE public.prod_pieza             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_placa             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_placa_pieza_extra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_producto          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_receta            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_insumo            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_jornada           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_corte             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_melamina          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_embalaje          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_pino              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_stock_pieza       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_stock_melamina    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_stock_patas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_stock_terminado   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_solicitud         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_mantenimiento     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_remito            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_alerta            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_auditoria         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prod_pedido_estado     ENABLE ROW LEVEL SECURITY;

-- ── Maestras (SELECT activos · escritura owner/admin) ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prod_pieza','prod_placa','prod_placa_pieza_extra','prod_producto','prod_receta','prod_insumo'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.current_user_role() IS NOT NULL)', t || '_sel', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.current_user_role() IN (''owner'',''admin''))', t || '_ins', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.current_user_role() IN (''owner'',''admin'')) WITH CHECK (public.current_user_role() IN (''owner'',''admin''))', t || '_upd', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_del', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.current_user_role() IN (''owner'',''admin''))', t || '_del', t);
  END LOOP;
END $$;

-- ── prod_jornada (SELECT activos · escritura encargado/owner/admin) ──
DROP POLICY IF EXISTS prod_jornada_sel ON public.prod_jornada;
CREATE POLICY prod_jornada_sel ON public.prod_jornada FOR SELECT TO authenticated USING (public.current_user_role() IS NOT NULL);
DROP POLICY IF EXISTS prod_jornada_ins ON public.prod_jornada;
CREATE POLICY prod_jornada_ins ON public.prod_jornada FOR INSERT TO authenticated WITH CHECK (public.current_user_role() IN ('encargado','owner','admin'));
DROP POLICY IF EXISTS prod_jornada_upd ON public.prod_jornada;
CREATE POLICY prod_jornada_upd ON public.prod_jornada FOR UPDATE TO authenticated USING (public.current_user_role() IN ('encargado','owner','admin')) WITH CHECK (public.current_user_role() IN ('encargado','owner','admin'));

-- ── Registro por sector (coordinador su tabla; UPDATE 24h; encargado/owner/admin todo) ──
-- cnc → prod_corte | melamina → prod_melamina | pino → prod_pino | embalaje → prod_embalaje
DO $$
DECLARE rec record;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
      ('prod_corte','cnc'), ('prod_melamina','melamina'), ('prod_pino','pino'), ('prod_embalaje','embalaje')
    ) AS v(tabla, coord)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rec.tabla || '_sel', rec.tabla);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.current_user_role() IN (%L,''encargado'',''owner'',''admin''))', rec.tabla || '_sel', rec.tabla, rec.coord);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rec.tabla || '_ins', rec.tabla);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.current_user_role() IN (%L,''encargado'',''owner'',''admin''))', rec.tabla || '_ins', rec.tabla, rec.coord);
    -- UPDATE: coordinador solo dentro de editable_hasta; encargado/owner/admin sin tope.
    -- prod_embalaje no tiene editable_hasta → coordinador no edita (solo encargado/owner/admin).
    IF rec.tabla = 'prod_embalaje' THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rec.tabla || '_upd', rec.tabla);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.current_user_role() IN (''encargado'',''owner'',''admin'')) WITH CHECK (public.current_user_role() IN (''encargado'',''owner'',''admin''))', rec.tabla || '_upd', rec.tabla);
    ELSE
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rec.tabla || '_upd', rec.tabla);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((public.current_user_role() = %L AND now() <= editable_hasta) OR public.current_user_role() IN (''encargado'',''owner'',''admin'')) WITH CHECK (true)', rec.tabla || '_upd', rec.tabla, rec.coord);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rec.tabla || '_del', rec.tabla);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.current_user_role() IN (''owner'',''admin''))', rec.tabla || '_del', rec.tabla);
  END LOOP;
END $$;

-- ── Stock por eslabón (SELECT activos · escritura encargado/owner/admin) ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prod_stock_pieza','prod_stock_melamina','prod_stock_patas','prod_stock_terminado'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.current_user_role() IS NOT NULL)', t || '_sel', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.current_user_role() IN (''encargado'',''owner'',''admin''))', t || '_ins', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.current_user_role() IN (''encargado'',''owner'',''admin'')) WITH CHECK (public.current_user_role() IN (''encargado'',''owner'',''admin''))', t || '_upd', t);
  END LOOP;
END $$;

-- ── prod_solicitud (coordinador INSERT + UPDATE propio; encargado/owner/admin SELECT) ──
DROP POLICY IF EXISTS prod_solicitud_sel ON public.prod_solicitud;
CREATE POLICY prod_solicitud_sel ON public.prod_solicitud FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('cnc','melamina','pino','embalaje','encargado','owner','admin'));
DROP POLICY IF EXISTS prod_solicitud_ins ON public.prod_solicitud;
CREATE POLICY prod_solicitud_ins ON public.prod_solicitud FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() IN ('cnc','melamina','pino','embalaje'));
DROP POLICY IF EXISTS prod_solicitud_upd ON public.prod_solicitud;
CREATE POLICY prod_solicitud_upd ON public.prod_solicitud FOR UPDATE TO authenticated
  USING (solicitado_por = auth.uid() AND public.current_user_role() IN ('cnc','melamina','pino','embalaje'))
  WITH CHECK (solicitado_por = auth.uid());

-- ── prod_mantenimiento (coordinador INSERT + UPDATE propio; owner/admin SELECT+UPDATE) ──
DROP POLICY IF EXISTS prod_mant_sel ON public.prod_mantenimiento;
CREATE POLICY prod_mant_sel ON public.prod_mantenimiento FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('cnc','melamina','pino','embalaje','encargado','owner','admin'));
DROP POLICY IF EXISTS prod_mant_ins ON public.prod_mantenimiento;
CREATE POLICY prod_mant_ins ON public.prod_mantenimiento FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() IN ('cnc','melamina','pino','embalaje'));
DROP POLICY IF EXISTS prod_mant_upd ON public.prod_mantenimiento;
CREATE POLICY prod_mant_upd ON public.prod_mantenimiento FOR UPDATE TO authenticated
  USING ((reportado_por = auth.uid() AND public.current_user_role() IN ('cnc','melamina','pino','embalaje')) OR public.current_user_role() IN ('owner','admin'))
  WITH CHECK (true);

-- ── prod_remito (INSERT owner/admin; SELECT encargado/owner/admin) ──
DROP POLICY IF EXISTS prod_remito_sel ON public.prod_remito;
CREATE POLICY prod_remito_sel ON public.prod_remito FOR SELECT TO authenticated USING (public.current_user_role() IN ('encargado','owner','admin'));
DROP POLICY IF EXISTS prod_remito_ins ON public.prod_remito;
CREATE POLICY prod_remito_ins ON public.prod_remito FOR INSERT TO authenticated WITH CHECK (public.current_user_role() IN ('owner','admin'));

-- ── prod_alerta (SELECT activos; UPDATE owner/admin — marcar vista) ──
DROP POLICY IF EXISTS prod_alerta_sel ON public.prod_alerta;
CREATE POLICY prod_alerta_sel ON public.prod_alerta FOR SELECT TO authenticated USING (public.current_user_role() IS NOT NULL);
DROP POLICY IF EXISTS prod_alerta_upd ON public.prod_alerta;
CREATE POLICY prod_alerta_upd ON public.prod_alerta FOR UPDATE TO authenticated USING (public.current_user_role() IN ('owner','admin')) WITH CHECK (public.current_user_role() IN ('owner','admin'));

-- ── prod_auditoria (SELECT encargado/owner/admin; INSERT solo vía trigger SECURITY DEFINER) ──
DROP POLICY IF EXISTS prod_auditoria_sel ON public.prod_auditoria;
CREATE POLICY prod_auditoria_sel ON public.prod_auditoria FOR SELECT TO authenticated USING (public.current_user_role() IN ('encargado','owner','admin'));

-- ── prod_pedido_estado (SELECT activos; INSERT embalaje/encargado/owner/admin) ──
DROP POLICY IF EXISTS prod_pedido_estado_sel ON public.prod_pedido_estado;
CREATE POLICY prod_pedido_estado_sel ON public.prod_pedido_estado FOR SELECT TO authenticated USING (public.current_user_role() IS NOT NULL);
DROP POLICY IF EXISTS prod_pedido_estado_ins ON public.prod_pedido_estado;
CREATE POLICY prod_pedido_estado_ins ON public.prod_pedido_estado FOR INSERT TO authenticated WITH CHECK (public.current_user_role() IN ('embalaje','encargado','owner','admin'));

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): DROP de todas las prod_v_* (vistas), prod_fn_* y las
-- 21 tablas prod_* en orden inverso de FK (CASCADE). No toca nada existente.
-- ════════════════════════════════════════════════════════════════════
