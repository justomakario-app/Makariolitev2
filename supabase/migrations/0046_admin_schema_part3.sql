-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Part 3: suppliers_credit + agent_conversations
-- ════════════════════════════════════════════════════════════════════
-- Cuentas corrientes proveedor + historial chats IA.
-- ADITIVA: no toca el flujo de produccion.
-- ════════════════════════════════════════════════════════════════════

-- ── suppliers_credit ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers_credit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL UNIQUE
    REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  saldo        numeric(14,2) NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.suppliers_credit IS
  'Saldo cuenta corriente con proveedor (1-1). + = le debemos; - = nos debe.';

DROP TRIGGER IF EXISTS suppliers_credit_set_updated_at ON public.suppliers_credit;
CREATE TRIGGER suppliers_credit_set_updated_at
  BEFORE UPDATE ON public.suppliers_credit
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── suppliers_credit_movements ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers_credit_movements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_credit_id   uuid NOT NULL
    REFERENCES public.suppliers_credit(id) ON DELETE RESTRICT,
  fecha                date NOT NULL DEFAULT current_date,
  tipo                 text NOT NULL
    CHECK (tipo IN ('compra','pago','ajuste','devolucion')),
  monto                numeric(14,2) NOT NULL CHECK (monto <> 0),
  concepto             text NOT NULL CHECK (length(concepto) BETWEEN 1 AND 500),
  expense_id           uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  check_id             uuid REFERENCES public.checks_issued(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.profiles(id)
);
COMMENT ON TABLE public.suppliers_credit_movements IS
  'Append-only. tipo→delta: compra+ pago- ajuste(signed) devolucion-';

CREATE INDEX IF NOT EXISTS suppliers_credit_movements_credit_fecha_idx
  ON public.suppliers_credit_movements (supplier_credit_id, fecha DESC);
CREATE INDEX IF NOT EXISTS suppliers_credit_movements_expense_idx
  ON public.suppliers_credit_movements (expense_id) WHERE expense_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS suppliers_credit_movements_check_idx
  ON public.suppliers_credit_movements (check_id) WHERE check_id IS NOT NULL;

-- ── agent_conversations ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  mensajes    jsonb NOT NULL DEFAULT '[]'::jsonb,
  tokens_in   integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out  integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  modelo      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.agent_conversations IS
  'Historial chats con agentes IA. mensajes = jsonb array [{role, content, ts}].';

CREATE INDEX IF NOT EXISTS agent_conversations_user_idx
  ON public.agent_conversations (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS agent_conversations_set_updated_at ON public.agent_conversations;
CREATE TRIGGER agent_conversations_set_updated_at
  BEFORE UPDATE ON public.agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP TRIGGER IF EXISTS agent_conversations_set_updated_at ON public.agent_conversations;
--   DROP TRIGGER IF EXISTS suppliers_credit_set_updated_at ON public.suppliers_credit;
--   DROP TABLE IF EXISTS public.agent_conversations;
--   DROP TABLE IF EXISTS public.suppliers_credit_movements;
--   DROP TABLE IF EXISTS public.suppliers_credit;
-- ════════════════════════════════════════════════════════════════════
