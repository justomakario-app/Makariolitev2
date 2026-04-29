-- ═══════════════════════════════════════════════════════════════════════════
-- 0001_initial_schema.sql
-- Macario Lite — schema base
-- ───────────────────────────────────────────────────────────────────────────
-- Crea extensiones, enums, función helper updated_at, tablas de dominio
-- y operación, índices, triggers de updated_at, RLS habilitado en TODAS las
-- tablas (sin policies — eso va en migration 0003+) y seeds del sistema
-- (channels, sku_categories, role_permissions).
--
-- Idempotente: IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS / DO blocks.
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. EXTENSIONES
-- ──────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ──────────────────────────────────────────────────────────────────────────
-- 2. ENUMS
-- ──────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE role_enum AS ENUM (
    'owner','admin','encargado','ventas','cnc','melamina',
    'pino','embalaje','carpinteria','logistica','marketing'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cierre_enum AS ENUM ('horario','flexible');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status_enum AS ENUM (
    'pendiente','completado','arrastrado','archivado'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notif_type_enum AS ENUM (
    'stock_critico','pedido_urgente','nuevo_pedido','produccion','sistema'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. FUNCIÓN HELPER updated_at
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.set_updated_at() IS
  'Trigger function: setea updated_at = now() en cada UPDATE. Usar en BEFORE UPDATE.';

-- ══════════════════════════════════════════════════════════════════════════
-- 4. TABLAS DE DOMINIO
-- ══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 4.1 sku_categories
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sku_categories (
  name        text PRIMARY KEY CHECK (length(name) BETWEEN 1 AND 40),
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.sku_categories IS
  'Categorías del catálogo (Mesas, Ratonas, Recibidoras, Luz). PK natural por nombre — permite ABM dinámico desde el modal de crear SKU.';

ALTER TABLE public.sku_categories ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────────
-- 4.2 channels
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.channels (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  label         text NOT NULL,
  sub           text,
  color         text NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  bg            text NOT NULL CHECK (bg ~ '^#[0-9a-fA-F]{6}$'),
  tipo_cierre   cierre_enum NOT NULL DEFAULT 'flexible',
  cierre_hora   time,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.channels IS
  'Canales de venta. Seed en esta migration con 4 filas: colecta, flex, tiendanube, distribuidor.';
COMMENT ON COLUMN public.channels.id IS
  'lowercase, snake_case. Usado en TODAS las FKs. NUNCA usar el label como key.';
COMMENT ON COLUMN public.channels.tipo_cierre IS
  'horario = tiene cierre obligatorio diario (Colecta/Flex). flexible = se arrastra automático (TN/Distribuidor).';
COMMENT ON COLUMN public.channels.cierre_hora IS
  'Solo aplica si tipo_cierre=horario. NULL para flexible.';

DROP TRIGGER IF EXISTS channels_updated_at ON public.channels;
CREATE TRIGGER channels_updated_at
  BEFORE UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────────
-- 4.3 sku_catalog
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sku_catalog (
  sku           text PRIMARY KEY CHECK (sku ~ '^[A-Z]{2,4}[0-9]{2,5}$'),
  modelo        text NOT NULL CHECK (length(modelo) BETWEEN 1 AND 120),
  color         text,
  color_hex     text CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9a-fA-F]{6}$'),
  categoria     text NOT NULL REFERENCES public.sku_categories(name)
                  ON UPDATE CASCADE ON DELETE RESTRICT,
  es_fabricado  boolean NOT NULL DEFAULT true,
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.sku_catalog IS
  'Catálogo maestro de productos. SKU = PK natural. Soft-delete via activo=false (FK ON DELETE RESTRICT preserva histórico).';
COMMENT ON COLUMN public.sku_catalog.sku IS
  'Formato MAD###. Regex valida 2-4 letras mayúsculas + 2-5 dígitos.';
COMMENT ON COLUMN public.sku_catalog.es_fabricado IS
  'true=se fabrica internamente / false=reventa sin producción';
COMMENT ON COLUMN public.sku_catalog.color_hex IS
  'Hex de 7 chars (#RRGGBB) para swatch en UI. NULL si no aplica.';

DROP TRIGGER IF EXISTS sku_catalog_updated_at ON public.sku_catalog;
CREATE TRIGGER sku_catalog_updated_at
  BEFORE UPDATE ON public.sku_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_sku_catalog_categoria ON public.sku_catalog(categoria);
CREATE INDEX IF NOT EXISTS idx_sku_catalog_activo ON public.sku_catalog(activo) WHERE activo = true;

ALTER TABLE public.sku_catalog ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────────
-- 4.4 profiles (extiende auth.users)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,32}$'),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  email         text UNIQUE,
  role          role_enum NOT NULL DEFAULT 'embalaje',
  area          text,
  active        boolean NOT NULL DEFAULT true,
  avatar_color  text CHECK (avatar_color IS NULL OR avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.profiles IS
  'Perfil extendido del usuario. Linkado 1:1 con auth.users (id = auth.users.id). Soft-delete via active=false.';
COMMENT ON COLUMN public.profiles.username IS
  'Login handle. Regex: 3-32 chars [a-z0-9_]. UNIQUE. Usado para resolver email virtual {username}@macario.local.';
COMMENT ON COLUMN public.profiles.role IS
  'Determina permisos via RLS y la sección landing al login (ver role_permissions).';
COMMENT ON COLUMN public.profiles.area IS
  'Texto libre — el sector específico que muestra el usuario (ej. "Pino/Armado"). Puede o no coincidir con el rol.';
COMMENT ON COLUMN public.profiles.avatar_color IS
  'Hex 7 chars (#RRGGBB). Sobrescribe el default por rol. NULL = usar default del rol.';

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON public.profiles(active) WHERE active = true;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. TABLAS DE OPERACIÓN
-- ══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 5.1 import_batches
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.import_batches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id          text NOT NULL REFERENCES public.channels(id)
                        ON UPDATE CASCADE ON DELETE RESTRICT,
  filename            text NOT NULL,
  file_hash           text NOT NULL UNIQUE CHECK (file_hash ~ '^[a-f0-9]{64}$'),
  pedidos_count       int NOT NULL DEFAULT 0 CHECK (pedidos_count >= 0),
  unidades_count      int NOT NULL DEFAULT 0 CHECK (unidades_count >= 0),
  skus_desconocidos   text[] NOT NULL DEFAULT '{}',
  storage_path        text,
  imported_by         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  imported_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.import_batches IS
  'Lote de importación de Excel. Una fila por upload. file_hash UNIQUE garantiza idempotencia: re-importar el mismo archivo falla con error claro.';
COMMENT ON COLUMN public.import_batches.file_hash IS
  'SHA-256 hex del contenido. Calculado en frontend antes del upload. Decisión F: idempotencia.';
COMMENT ON COLUMN public.import_batches.storage_path IS
  'Path en bucket "imports" (Supabase Storage) — auditoría. Formato: imports/{channel_id}/{YYYY-MM-DD}/{batch_id}.xlsx';
COMMENT ON COLUMN public.import_batches.skus_desconocidos IS
  'Array de SKUs del Excel que no existían en el catálogo al importar. Se ignoran pero se registran.';

CREATE INDEX IF NOT EXISTS idx_import_batches_channel
  ON public.import_batches(channel_id, imported_at DESC);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────────
-- 5.2 jornadas
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jornadas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id            text NOT NULL REFERENCES public.channels(id)
                          ON UPDATE CASCADE ON DELETE RESTRICT,
  fecha                 date NOT NULL,
  pedidos_count         int NOT NULL DEFAULT 0 CHECK (pedidos_count >= 0),
  unidades_pedidas      int NOT NULL DEFAULT 0 CHECK (unidades_pedidas >= 0),
  unidades_producidas   int NOT NULL DEFAULT 0 CHECK (unidades_producidas >= 0),
  faltante_arrastrado   int NOT NULL DEFAULT 0 CHECK (faltante_arrastrado >= 0),
  snapshot              jsonb NOT NULL,
  closed_by             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  closed_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jornadas_unique_per_channel_fecha UNIQUE (channel_id, fecha)
);
COMMENT ON TABLE public.jornadas IS
  'Cierres de jornada. Snapshot inmutable. Solo aplica a canales con tipo_cierre=horario (Colecta/Flex). UPDATE/DELETE prohibido por RLS en Fase 3.';
COMMENT ON COLUMN public.jornadas.snapshot IS
  'JSON inmutable: [{sku, modelo, pedido, producido, faltante, stock}]. Foto del estado del carrier_state al momento del cierre.';
COMMENT ON COLUMN public.jornadas.faltante_arrastrado IS
  'Total de unidades que quedaron pendientes y se arrastran al día siguiente como pedidos status=arrastrado.';

CREATE INDEX IF NOT EXISTS idx_jornadas_channel
  ON public.jornadas(channel_id, fecha DESC);

ALTER TABLE public.jornadas ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────────
-- 5.3 orders
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      text NOT NULL REFERENCES public.channels(id)
                    ON UPDATE CASCADE ON DELETE RESTRICT,
  order_number    text NOT NULL,
  cliente         text,
  sku             text NOT NULL REFERENCES public.sku_catalog(sku)
                    ON UPDATE CASCADE ON DELETE RESTRICT,
  cantidad        int NOT NULL CHECK (cantidad > 0),
  fecha_pedido    date NOT NULL DEFAULT current_date,
  import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  status          order_status_enum NOT NULL DEFAULT 'pendiente',
  jornada_id      uuid REFERENCES public.jornadas(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_unique_per_channel_sku UNIQUE (channel_id, order_number, sku)
);
COMMENT ON TABLE public.orders IS
  'Pedido individual. UNIQUE por (channel_id, order_number, sku) — un order_number puede tener múltiples SKUs como filas separadas (decisión G del informe).';
COMMENT ON COLUMN public.orders.status IS
  'pendiente=activo / completado=todo producido / arrastrado=faltante de cierre previo / archivado=cerrado y completado';
COMMENT ON COLUMN public.orders.jornada_id IS
  'Se setea al cerrar jornada (RPC rpc_close_jornada). NULL mientras esté pendiente o arrastrado.';
COMMENT ON COLUMN public.orders.cliente IS
  'Texto libre con nombre del comprador. RLS en Fase 3: operarios NO pueden SELECT esta columna.';

CREATE INDEX IF NOT EXISTS idx_orders_channel_status
  ON public.orders(channel_id, status) WHERE status IN ('pendiente','arrastrado');
CREATE INDEX IF NOT EXISTS idx_orders_sku ON public.orders(sku);
CREATE INDEX IF NOT EXISTS idx_orders_fecha ON public.orders(fecha_pedido DESC);
CREATE INDEX IF NOT EXISTS idx_orders_batch
  ON public.orders(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_jornada
  ON public.orders(jornada_id) WHERE jornada_id IS NOT NULL;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────────
-- 5.4 production_logs (LEDGER INMUTABLE)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.production_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         text NOT NULL REFERENCES public.sku_catalog(sku)
                ON UPDATE CASCADE ON DELETE RESTRICT,
  channel_id  text NOT NULL REFERENCES public.channels(id)
                ON UPDATE CASCADE ON DELETE RESTRICT,
  cantidad    int NOT NULL CHECK (cantidad <> 0),
  operario_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  sector      text NOT NULL,
  fecha       date NOT NULL DEFAULT current_date,
  hora        time NOT NULL DEFAULT current_time,
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.production_logs IS
  'Ledger inmutable de producción. NUNCA UPDATE/DELETE. Para corrección, insertar log con cantidad negativa (CHECK <> 0 permite negativos).';
COMMENT ON COLUMN public.production_logs.cantidad IS
  'Permite valores negativos para correcciones (decisión H). Positivo = producción nueva. Negativo = corrección hacia abajo.';
COMMENT ON COLUMN public.production_logs.sector IS
  'Espejo del rol del operario al momento del log (CNC, Melamina, Pino, Embalaje, etc.). Auto-asignado por RPC rpc_register_production. Inmutable.';
COMMENT ON COLUMN public.production_logs.operario_id IS
  'Set automáticamente a auth.uid() por el RPC. Inmutable.';

CREATE INDEX IF NOT EXISTS idx_prodlog_fecha ON public.production_logs(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_prodlog_sku_channel ON public.production_logs(sku, channel_id);
CREATE INDEX IF NOT EXISTS idx_prodlog_operario ON public.production_logs(operario_id);
CREATE INDEX IF NOT EXISTS idx_prodlog_created ON public.production_logs(created_at DESC);

ALTER TABLE public.production_logs ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────────
-- 5.5 carrier_state (denormalización para queries rápidas)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.carrier_state (
  channel_id  text NOT NULL REFERENCES public.channels(id)
                ON UPDATE CASCADE ON DELETE RESTRICT,
  sku         text NOT NULL REFERENCES public.sku_catalog(sku)
                ON UPDATE CASCADE ON DELETE RESTRICT,
  pedido      int NOT NULL DEFAULT 0 CHECK (pedido >= 0),
  producido   int NOT NULL DEFAULT 0 CHECK (producido >= 0),
  faltante    int NOT NULL DEFAULT 0 CHECK (faltante >= 0),
  stock       int NOT NULL DEFAULT 0 CHECK (stock >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, sku)
);
COMMENT ON TABLE public.carrier_state IS
  'Estado denormalizado por (channel, sku) — agrega pedido + producido + faltante + stock. Mantenido por triggers de orders y production_logs (Fase 5). NUNCA escribir directo.';
COMMENT ON COLUMN public.carrier_state.faltante IS
  'GREATEST(0, pedido - producido). Mantenido por trigger.';
COMMENT ON COLUMN public.carrier_state.stock IS
  'GREATEST(0, producido - pedido). Excedente acumulado por canal (decisión C). NO se transfiere entre canales.';

DROP TRIGGER IF EXISTS carrier_state_updated_at ON public.carrier_state;
CREATE TRIGGER carrier_state_updated_at
  BEFORE UPDATE ON public.carrier_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_carrier_state_channel ON public.carrier_state(channel_id);
CREATE INDEX IF NOT EXISTS idx_carrier_state_pendientes
  ON public.carrier_state(channel_id) WHERE faltante > 0;

ALTER TABLE public.carrier_state ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────────
-- 5.6 notifications
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo        notif_type_enum NOT NULL,
  titulo      text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 200),
  mensaje     text NOT NULL CHECK (length(mensaje) BETWEEN 1 AND 1000),
  leida       boolean NOT NULL DEFAULT false,
  link        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.notifications IS
  'Notificaciones por usuario. RLS en Fase 3: SELECT/UPDATE/DELETE solo donde user_id = auth.uid(). INSERT solo por sistema (triggers/RPCs).';

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications(user_id) WHERE leida = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────────
-- 5.7 qr_scans
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qr_scans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  sku         text REFERENCES public.sku_catalog(sku)
                ON UPDATE CASCADE ON DELETE SET NULL,
  order_id    uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  operario_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  scanned_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.qr_scans IS
  'Eventos de escaneo de QR durante embalado. Audit trail. UPDATE/DELETE prohibido por RLS.';
COMMENT ON COLUMN public.qr_scans.code IS
  'Código completo escaneado (puede incluir prefijo "ML-XXXX · MAD###" o solo el SKU).';

CREATE INDEX IF NOT EXISTS idx_qrscans_sku
  ON public.qr_scans(sku, scanned_at DESC) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qrscans_operario
  ON public.qr_scans(operario_id, scanned_at DESC);

ALTER TABLE public.qr_scans ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────────
-- 5.8 role_permissions
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role        role_enum PRIMARY KEY,
  landing     text NOT NULL,
  items       text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.role_permissions IS
  'Mapping rol → landing + items visibles en sidebar. Lectura para todos los autenticados (RLS Fase 3). Solo owner puede modificar.';

DROP TRIGGER IF EXISTS role_permissions_updated_at ON public.role_permissions;
CREATE TRIGGER role_permissions_updated_at
  BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 6. SEEDS DEL SISTEMA (datos obligatorios — la app no funciona sin esto)
-- ══════════════════════════════════════════════════════════════════════════

-- 6.1 sku_categories (4 categorías base del mock)
INSERT INTO public.sku_categories (name, sort_order) VALUES
  ('Mesas',       1),
  ('Ratonas',     2),
  ('Recibidoras', 3),
  ('Luz',         4)
ON CONFLICT (name) DO NOTHING;

-- 6.2 channels (4 canales: Colecta, Flex, Tienda Nube, Distribuidor)
-- Valores tomados literalmente de window.CARRIERS (mock.js:124-129).
INSERT INTO public.channels (id, label, sub, color, bg, tipo_cierre, cierre_hora, sort_order) VALUES
  ('colecta',      'Colecta',         'ML · Retiro 12:00 hs', '#6366f1', '#f1f0ff', 'horario',  '12:00', 1),
  ('flex',         'Flex',            'ML · Retiro 14:00 hs', '#15803d', '#effaf1', 'horario',  '14:00', 2),
  ('tiendanube',   'Tienda Nube',     'Web propia',           '#2563eb', '#eff6ff', 'flexible', NULL,    3),
  ('distribuidor', 'Distribuidores',  'Mayoristas / bulto',   '#d97706', '#fffbeb', 'flexible', NULL,    4)
ON CONFLICT (id) DO UPDATE SET
  label       = EXCLUDED.label,
  sub         = EXCLUDED.sub,
  color       = EXCLUDED.color,
  bg          = EXCLUDED.bg,
  tipo_cierre = EXCLUDED.tipo_cierre,
  cierre_hora = EXCLUDED.cierre_hora,
  sort_order  = EXCLUDED.sort_order;

-- 6.3 role_permissions (mapping de window.MOCK.ROLE_NAV)
INSERT INTO public.role_permissions (role, landing, items) VALUES
  ('owner',     'dashboard',  ARRAY['dashboard','colecta','flex','tiendanube','distribuidor','produccion','registrar','historico','catalogo','equipo','notificaciones','perfil']),
  ('admin',     'dashboard',  ARRAY['dashboard','colecta','flex','tiendanube','distribuidor','produccion','registrar','historico','catalogo','equipo','notificaciones','perfil']),
  ('encargado', 'produccion', ARRAY['produccion','registrar','notificaciones','perfil']),
  ('cnc',       'produccion', ARRAY['produccion','registrar','perfil']),
  ('melamina',  'produccion', ARRAY['produccion','registrar','perfil']),
  ('pino',      'produccion', ARRAY['produccion','registrar','perfil']),
  ('embalaje',  'produccion', ARRAY['produccion','registrar','perfil']),
  ('logistica', 'produccion', ARRAY['produccion','registrar','perfil']),
  ('ventas',    'produccion', ARRAY['produccion','perfil']),
  ('carpinteria','produccion', ARRAY['produccion','registrar','perfil']),
  ('marketing', 'dashboard',  ARRAY['dashboard','perfil'])
ON CONFLICT (role) DO UPDATE SET
  landing = EXCLUDED.landing,
  items   = EXCLUDED.items;

-- ══════════════════════════════════════════════════════════════════════════
-- FIN 0001_initial_schema.sql
-- ══════════════════════════════════════════════════════════════════════════
