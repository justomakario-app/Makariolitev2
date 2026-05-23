-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Part 1: suppliers, expenses, checks_issued
-- ════════════════════════════════════════════════════════════════════
-- Modulo administracion para Noe (jefa admin/finanzas de Justo Makario).
-- Esta migration crea las 3 tablas centrales del lobulo Egresos/Cheques.
-- Es ADITIVA: NO toca orders, jornadas, production_logs, carrier_state
-- ni cualquier otra tabla del flujo de produccion.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
-- RLS habilitada en 0047. RPCs SECURITY DEFINER en 0048. Bucket en 0049.
-- ════════════════════════════════════════════════════════════════════

-- ── suppliers ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 120),
  cuit        text CHECK (cuit IS NULL OR cuit ~ '^\d{2}-\d{8}-\d$'),
  email       text,
  telefono    text,
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.profiles(id)
);
COMMENT ON TABLE public.suppliers IS
  'Proveedores. PK natural por id, UNIQUE parcial por cuit (cuando informado).';

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_cuit_unique_idx
  ON public.suppliers (cuit) WHERE cuit IS NOT NULL;
CREATE INDEX IF NOT EXISTS suppliers_nombre_idx
  ON public.suppliers (lower(nombre));

-- ── expenses ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expenses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha                date NOT NULL DEFAULT current_date,
  supplier_id          uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  concepto             text NOT NULL CHECK (length(concepto) BETWEEN 1 AND 500),
  monto_total          numeric(14,2) NOT NULL CHECK (monto_total > 0),
  moneda               text NOT NULL DEFAULT 'ARS'
    CHECK (moneda IN ('ARS','USD')),
  iva_discriminado     numeric(14,2),
  categoria            text NOT NULL
    CHECK (categoria IN ('insumos','servicios','sueldos','impuestos','otros')),
  medio_pago           text NOT NULL
    CHECK (medio_pago IN ('efectivo','transferencia','cheque','tarjeta','otro')),
  comprobante_url      text,
  ocr_raw_json         jsonb,
  confirmed_by_human   boolean NOT NULL DEFAULT false,
  notas                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.profiles(id),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.expenses IS
  'Egresos/compras. Carga via rpc_admin_create_expense (con/sin OCR).';

CREATE INDEX IF NOT EXISTS expenses_fecha_idx
  ON public.expenses (fecha DESC);
CREATE INDEX IF NOT EXISTS expenses_supplier_idx
  ON public.expenses (supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS expenses_categoria_fecha_idx
  ON public.expenses (categoria, fecha DESC);

DROP TRIGGER IF EXISTS expenses_set_updated_at ON public.expenses;
CREATE TRIGGER expenses_set_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── checks_issued ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checks_issued (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                      text NOT NULL,
  banco                       text NOT NULL,
  monto                       numeric(14,2) NOT NULL CHECK (monto > 0),
  fecha_emision               date NOT NULL,
  fecha_cobro_estimada        date,
  beneficiario_supplier_id    uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  beneficiario_texto          text,
  estado                      text NOT NULL DEFAULT 'emitido'
    CHECK (estado IN ('emitido','cobrado','anulado','devuelto')),
  notas                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES public.profiles(id),
  CONSTRAINT checks_issued_beneficiario_required CHECK (
    beneficiario_supplier_id IS NOT NULL OR beneficiario_texto IS NOT NULL
  )
);
COMMENT ON TABLE public.checks_issued IS
  'Cheques emitidos. Beneficiario puede ser supplier del catalogo o texto libre.';

CREATE INDEX IF NOT EXISTS checks_issued_cobro_idx
  ON public.checks_issued (fecha_cobro_estimada) WHERE estado = 'emitido';
CREATE INDEX IF NOT EXISTS checks_issued_supplier_idx
  ON public.checks_issued (beneficiario_supplier_id)
  WHERE beneficiario_supplier_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP TRIGGER IF EXISTS expenses_set_updated_at ON public.expenses;
--   DROP TABLE IF EXISTS public.checks_issued;
--   DROP TABLE IF EXISTS public.expenses;
--   DROP TABLE IF EXISTS public.suppliers;
-- ════════════════════════════════════════════════════════════════════
