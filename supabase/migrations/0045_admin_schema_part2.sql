-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Part 2: customers_b2b, customers_credit, movements
-- ════════════════════════════════════════════════════════════════════
-- Tablas del lobulo Clientes y Cuentas Corrientes.
-- ADITIVA: no toca el flujo de produccion.
-- ════════════════════════════════════════════════════════════════════

-- ── customers_b2b ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customers_b2b (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 120),
  cuit        text CHECK (cuit IS NULL OR cuit ~ '^\d{2}-\d{8}-\d$'),
  email       text,
  telefono    text,
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.profiles(id)
);
COMMENT ON TABLE public.customers_b2b IS
  'Clientes mayoristas/distribuidores. Distintos de los compradores de ML.';

CREATE UNIQUE INDEX IF NOT EXISTS customers_b2b_cuit_unique_idx
  ON public.customers_b2b (cuit) WHERE cuit IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_b2b_nombre_idx
  ON public.customers_b2b (lower(nombre));

-- ── customers_credit ───────────────────────────────────────────────
-- Saldo unificado por entidad cliente. Una fila por (B2B o ML).
-- Para B2B: customer_b2b_id setea, customer_ml_* NULL.
-- Para ML : customer_ml_dni + customer_ml_nombre setea, customer_b2b_id NULL.
-- CHECK xor asegura exactamente uno de los dos lados poblado.
CREATE TABLE IF NOT EXISTS public.customers_credit (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_type       text NOT NULL CHECK (customer_type IN ('b2b','ml')),
  customer_b2b_id     uuid REFERENCES public.customers_b2b(id) ON DELETE RESTRICT,
  customer_ml_dni     text,
  customer_ml_nombre  text,
  saldo               numeric(14,2) NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_credit_xor CHECK (
    (customer_type = 'b2b' AND customer_b2b_id IS NOT NULL AND customer_ml_dni IS NULL)
    OR
    (customer_type = 'ml'  AND customer_ml_dni IS NOT NULL AND customer_b2b_id IS NULL)
  )
);
COMMENT ON TABLE public.customers_credit IS
  'Saldo cuenta corriente cliente. + = cliente nos debe; - = saldo a favor del cliente.';

CREATE UNIQUE INDEX IF NOT EXISTS customers_credit_b2b_unique_idx
  ON public.customers_credit (customer_b2b_id) WHERE customer_b2b_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customers_credit_ml_unique_idx
  ON public.customers_credit (customer_ml_dni) WHERE customer_ml_dni IS NOT NULL;

DROP TRIGGER IF EXISTS customers_credit_set_updated_at ON public.customers_credit;
CREATE TRIGGER customers_credit_set_updated_at
  BEFORE UPDATE ON public.customers_credit
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── customers_credit_movements ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customers_credit_movements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_credit_id   uuid NOT NULL
    REFERENCES public.customers_credit(id) ON DELETE RESTRICT,
  fecha                date NOT NULL DEFAULT current_date,
  tipo                 text NOT NULL
    CHECK (tipo IN ('cargo','pago','ajuste','devolucion')),
  monto                numeric(14,2) NOT NULL CHECK (monto <> 0),
  concepto             text NOT NULL CHECK (length(concepto) BETWEEN 1 AND 500),
  referencia_externa   text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.profiles(id)
);
COMMENT ON TABLE public.customers_credit_movements IS
  'Append-only. tipo determina signo del delta sobre customers_credit.saldo: cargo+ pago- ajuste(signed) devolucion-';

CREATE INDEX IF NOT EXISTS customers_credit_movements_credit_fecha_idx
  ON public.customers_credit_movements (customer_credit_id, fecha DESC);

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP TRIGGER IF EXISTS customers_credit_set_updated_at ON public.customers_credit;
--   DROP TABLE IF EXISTS public.customers_credit_movements;
--   DROP TABLE IF EXISTS public.customers_credit;
--   DROP TABLE IF EXISTS public.customers_b2b;
-- ════════════════════════════════════════════════════════════════════
