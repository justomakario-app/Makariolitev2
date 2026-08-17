/* ══ B2B DATA LAYER (window.B2B_DATA) ═══════════════════════════════════
   Capa de acceso a datos de la tienda mayorista (migraciones 0151-0156).
   La consumen LAS DOS mitades: el panel interno (admin/b2b-*.jsx) y el
   storefront del cliente en /tienda/, que carga este mismo archivo por ruta
   absoluta (/components/b2b-data.js) en vez de tener una copia. Es a
   proposito: acá vive el contrato con las RPC, y una copia paralela se iba a
   desincronizar en el primer cambio de backend.
   ⚠ Entonces: lo que se agregue acá lo ve tambien el cliente. Nada de meter
   secretos ni logica de administracion en este archivo.

   Convenciones heredadas del proyecto:
   - window.SUPA resuelto lazy (como lp-data.jsx), NO capturado al cargar:
     este archivo puede entrar antes que data.js termine de inicializar.
   - Todas las RPC del backend B2B reciben { p_payload } (igual que LP).
   - Las RPC de LISTA devuelven un array jsonb pelado; las de MUTACION
     devuelven un objeto { ok: true, ... }. No hay envoltorio comun: cada
     helper de abajo documenta lo que devuelve su RPC.
   - Los errores del backend viajan con SQLSTATE; se re-lanzan como Error
     con .code para que la UI distinga "sin permiso" de "no encontrado".

   Feature flag: FAIL-CLOSED. Sin tabla, sin fila, sin sesion o con error
   de red ⇒ deshabilitado. El backend ademas vuelve a chequearlo en cada
   RPC (b2b_fn_guard), asi que esconder el tab es solo cosmetica: aunque
   alguien fuerce la UI, el servidor sigue diciendo que no.
   ═══════════════════════════════════════════════════════════════════════ */

window.B2B_DATA = window.B2B_DATA || (function () {
  const sb = () => window.SUPA;

  /* Traduce el error de PostgREST a un Error de JS conservando el SQLSTATE.
     Los codigos que devuelve el backend B2B:
       42501 sin permiso / modulo deshabilitado
       P0002 no encontrado (SKU, invitacion, pedido)
       22023 dato invalido (publicar sin precio, cantidad negativa)
       0A000 operacion no permitida en ese estado (anular un pedido ya en curso)
       23514 violacion de CHECK que el backend no alcanzo a traducir */
  const wrap = (error, fallback) => {
    const e = new Error((error && error.message) || fallback);
    if (error && error.code) e.code = error.code;
    if (error && error.hint) e.hint = error.hint;
    return e;
  };

  const rpc = async (name, payload, fallback) => {
    const { data, error } = await sb().rpc(name, { p_payload: payload || {} });
    if (error) throw wrap(error, fallback || 'No se pudo completar la operacion');
    return data;
  };

  /* Las RPC de lista devuelven jsonb_agg, que es null cuando no hay filas
     aunque el backend lo envuelva en coalesce: si el dia de manana alguna
     ruta devuelve null, la UI no debe romperse iterando. */
  const lista = async (name, payload, fallback) => {
    const data = await rpc(name, payload, fallback);
    return Array.isArray(data) ? data : [];
  };

  const sel = async (tabla, cols, build, fallback) => {
    let q = sb().from(tabla).select(cols);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw wrap(error, fallback || 'No se pudo cargar');
    return data || [];
  };

  return {
    /* ── Feature flag ────────────────────────────────────────────────── */
    flag: async () => {
      try {
        const { data, error } = await sb()
          .from('app_flags').select('enabled').eq('name', 'b2b').maybeSingle();
        if (error) return false;
        return !!(data && data.enabled);
      } catch (e) { return false; }
    },

    /* ── Identidad: invitaciones y aprobacion de usuarios (0151) ─────── */

    /* Devuelve { ok, invitacion_id, token, expira_at }.
       ★ El token en claro se devuelve UNA SOLA VEZ: en la tabla queda el
       hash. Si la pantalla lo pierde, no hay forma de recuperarlo — hay que
       emitir una invitacion nueva. La UI tiene que mostrarlo y dejar
       copiarlo antes de cerrar el modal.
       payload: { email, canal, cliente_id? | cliente_nombre, cliente_cuit?, dias_validez? } */
    crearInvitacion: (p) => rpc('b2b_rpc_crear_invitacion', p, 'No se pudo crear la invitacion'),

    /* Dar de baja una invitacion que todavia no se uso (0158). El token en
       claro se manda por WhatsApp o mail: si se filtra, o se invito al mail
       equivocado, esto es lo unico que lo corta antes de que alguien lo canjee.
       payload: { invitacion_id }. Una ya usada devuelve 0A000 — para sacarle el
       acceso a alguien que ya entro se suspende el usuario, no la invitacion. */
    revocarInvitacion: (p) => rpc('b2b_rpc_revocar_invitacion', p, 'No se pudo revocar la invitacion'),

    /* Invitaciones emitidas. Lectura directa: RLS is_owner_or_admin().
       Nunca trae token_hash — no sirve para nada en la UI y es un secreto.
       `revocada_at` viene de 0158; `expira_at` en el pasado con estado
       'pendiente' es una invitacion vencida (el backend no la re-etiqueta:
       la vigencia se calcula al canjear). */
    invitaciones: (opts) => sel(
      'b2b_invitacion',
      'id, email, cliente_id, cliente_nombre, cliente_cuit, canal, estado, expira_at, usada_at, revocada_at, created_at',
      q => {
        const o = opts || {};
        if (o.estado) q = q.eq('estado', o.estado);
        return q.order('created_at', { ascending: false }).limit(o.limit || 200);
      },
      'No se pudieron cargar las invitaciones'
    ),

    /* Usuarios B2B. El caso de uso principal es estado='pendiente' (la cola
       de aprobacion). Embebe el cliente por la FK cliente_id -> customers_b2b. */
    usuarios: (opts) => sel(
      'b2b_usuario',
      'id, email, nombre, telefono, estado, es_titular, rechazo_motivo, ultimo_acceso_at, created_at, ' +
      'cliente:customers_b2b!b2b_usuario_cliente_id_fkey(id, nombre, cuit, b2b_canal, b2b_habilitado)',
      q => {
        const o = opts || {};
        if (o.estado) q = q.eq('estado', o.estado);
        return q.order('created_at', { ascending: false }).limit(o.limit || 500);
      },
      'No se pudieron cargar los usuarios de la tienda'
    ),

    /* Cuantos esperan aprobacion, para el badge del tab. Sin traer las filas. */
    pendientesCount: async () => {
      try {
        const { count, error } = await sb()
          .from('b2b_usuario').select('id', { count: 'exact', head: true })
          .eq('estado', 'pendiente');
        if (error) return 0;
        return count || 0;
      } catch (e) { return 0; }
    },

    /* Aprobar / rechazar / suspender. Aprobar ademas marca al cliente como
       es_mayorista + b2b_habilitado, o sea que recien ahi aparece en el
       modulo Mayoristas del admin.
       payload: { usuario_id, estado: 'aprobado'|'rechazado'|'suspendido', motivo? } */
    resolverUsuario: (p) => rpc('b2b_rpc_resolver_usuario', p, 'No se pudo resolver el usuario'),

    /* ── Ficha del CLIENTE, no del usuario (0155) ────────────────────── */

    /* La vista por cliente (empresa), que es como se factura. `usuarios` de
       arriba es por PERSONA: dos compradores de la misma ferreteria son dos
       filas alla y una sola aca. Trae canal, coeficiente, habilitacion,
       condicion de pago, cuantos compradores tiene, cuantos esperan
       aprobacion, cuantos pedidos hizo y cuanto suman. */
    adminClientes: (p) => lista('b2b_rpc_admin_clientes', p, 'No se pudieron cargar los clientes'),

    /* Cambiar canal / habilitacion / condicion de pago / notas.
       payload: { cliente_id, canal?, habilitado?, condicion_pago?, notas_internas? }
       ★ Solo escribe las claves que MANDES: omitir 'canal' no lo borra, lo
       deja como estaba. Por eso hay que mandar el objeto parcial, no la fila
       entera con los campos vacios.
       ★ Cambiar el canal cambia lo que ese cliente ve de ahora en mas; los
       pedidos ya enviados conservan el precio con el que se enviaron. */
    setCliente: (p) => rpc('b2b_rpc_admin_set_cliente', p, 'No se pudo guardar el cliente'),

    /* ── Escotilla de emergencia: alta interna a mano (0155) ─────────── */

    /* Desde 0155 el trigger solo crea un profile si el alta vino del
       service_role (app_metadata.interno). Un usuario creado a mano desde el
       Dashboard de Supabase NO puede llevar esa marca, asi que queda con
       credencial y sin profile: entra y no ve nada. Esto le da el profile.
       OWNER-ONLY. payload: { user_id | email, username?, name?, role?, area? } */
    altaInterna: (p) => rpc('rpc_admin_alta_interna', p, 'No se pudo dar de alta al usuario'),

    /* Altas que el trigger bloqueo (intentos de registro por afuera).
       Es la bitacora de 0155: si alguien intenta entrar solo, queda aca. */
    altasBloqueadas: (opts) => sel(
      'auth_alta_bloqueada',
      'id, user_id, email, motivo, metadata, created_at',
      q => q.order('created_at', { ascending: false }).limit((opts || {}).limit || 100),
      'No se pudieron cargar los intentos de alta'
    ),

    /* ── Catalogo y precios (0152) ───────────────────────────────────── */

    /* Grilla del admin. Desde 0160 vienen DOS mapas por canal y no son lo
       mismo:
         precios_por_canal → lo que ese canal paga HOY, ya resuelto (su
                             precio de lista si tiene, si no precio_base ×
                             coeficiente). Sirve para mostrar.
         precios_lista     → SOLO los precios cargados a mano, {} si no hay
                             ninguno. Es lo unico que se puede editar; si se
                             usara el otro para llenar los inputs, el numero
                             calculado quedaria escrito como si alguien lo
                             hubiera decidido.
       payload: { solo_publicados? } */
    adminCatalogo: (p) => lista('b2b_rpc_admin_catalogo', p, 'No se pudo cargar el catalogo'),

    /* Un SKU o un lote: { items:[{sku, precio_base, publicado, ...}] }.
       `precios_canal: { mayorista: 8888, distribuidor: null }` carga o borra
       el precio de lista de ese canal (null lo devuelve a la formula).
       Devuelve { ok, actualizados }. */
    setProducto: (p) => rpc('b2b_rpc_admin_set_producto', p, 'No se pudo guardar el producto'),

    /* Sin payload: lee. Con { canales:[...] }: escribe y devuelve el estado
       final. Escribir es OWNER-ONLY (un admin recibe 42501). */
    canales: (p) => lista('b2b_rpc_admin_canales', p, 'No se pudieron cargar los canales'),

    /* ── Foto del producto (bucket b2b_fotos, 0156) ──────────────────────
       Una carpeta por SKU, un archivo por producto: subir de nuevo pisa la
       anterior en vez de dejar huerfanos. El nombre lleva la extension del
       tipo real del archivo, no la del nombre original, que puede mentir.
       El bucket es PUBLICO de lectura y solo owner/admin puede escribir, asi
       que esto falla con 403 si lo llama cualquier otro. */
    subirFotoProducto: async (sku, file) => {
      const tipos = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const ext = tipos[file && file.type];
      if (!ext) throw new Error('La foto tiene que ser JPG, PNG o WEBP.');
      if (file.size > 2 * 1024 * 1024) throw new Error('La foto no puede pasar de 2 MB.');
      const path = `${String(sku).trim()}/foto.${ext}`;
      const { error } = await sb().storage
        .from('b2b_fotos').upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw wrap(error, 'No se pudo subir la foto');
      return path;
    },

    /* Ruta guardada -> URL para el <img>. La ruta de un SKU es siempre la
       misma a proposito (subir de nuevo pisa la anterior), asi que despues de
       cambiar la foto el navegador seguiria mostrando la vieja: `v` es el
       cache-buster para ese caso. No se guarda en la base, es solo de vista. */
    fotoUrl: (path, v) => {
      if (!path) return null;
      const { data } = sb().storage.from('b2b_fotos').getPublicUrl(path);
      const url = data && data.publicUrl ? data.publicUrl : null;
      if (!url) return null;
      return v ? `${url}?v=${encodeURIComponent(v)}` : url;
    },

    /* ── Pedidos (0153) ──────────────────────────────────────────────── */

    /* Lo que el admin ve de la tienda. Cada fila cruza el pedido B2B con su
       espejo en pedidos_mayoristas: pedido_mayorista_id, numero_pedido,
       estado_admin, cliente, canal, comprador, total_neto, unidades.
       payload: { estado? } filtra por estado_admin.
       El AVANCE de estado NO se hace por acá: se hace donde el admin ya lo
       venia haciendo (ADMIN_DATA.updateEstadoPedidoMayorista), y el trigger
       b2b_tg_sync_estado lo espeja al pedido B2B. Un solo lugar de verdad.
       0161 agrega tres columnas: estado_tienda (el estado del lado del
       cliente), facturado_at y factura_nro. estado_admin y estado_tienda
       dicen lo mismo SALVO cuando el pedido esta facturado: 'facturado' solo
       existe del lado de la tienda, asi que un pedido facturado se ve como
       estado_admin='entregado' + estado_tienda='facturado'. */
    adminPedidos: (p) => lista('b2b_rpc_admin_pedidos', p, 'No se pudieron cargar los pedidos'),

    /* Marcar un pedido como facturado y guardarle el numero (0158).
       payload: { pedido_id, factura_nro? } — pedido_id es el b2b_pedido_id.
       Es la UNICA transicion de estado que se decide del lado de la tienda:
       no existe 'facturado' en pedidos_mayoristas, y el sistema no tiene
       tabla de facturas ni integracion con ARCA. Acá se anota lo que se
       emitio afuera, para que el cliente lo vea en "Mis pedidos".
       Pide que el pedido este despachado (si no, 0A000) y se puede volver a
       llamar sobre uno ya facturado para corregir el numero.
       Desde 0161 volver atras el estado del admin ya NO lo desfactura. */
    facturarPedido: (p) => rpc('b2b_rpc_admin_facturar_pedido', p, 'No se pudo facturar el pedido'),

    /* ── Storefront del cliente ───────────────────────────────────────
       La UI de estas vive en /tienda/. Quedan expuestas tambien acá para
       poder probar el circuito del cliente desde el panel sin abrir la
       otra app (y porque el panel interno todavia puede querer mirar un
       carrito ajeno el dia que se agregue "pedir por cuenta del cliente"). */
    miCuenta:      (p) => rpc('b2b_rpc_mi_cuenta', p, 'No se pudo leer la cuenta'),
    verInvitacion: (p) => rpc('b2b_rpc_ver_invitacion', p, 'No se pudo leer la invitacion'),
    canjearInvitacion: (p) => rpc('b2b_rpc_canjear_invitacion', p, 'No se pudo canjear la invitacion'),
    catalogo:      (p) => lista('b2b_rpc_catalogo', p, 'No se pudo cargar el catalogo'),
    carrito:       (p) => rpc('b2b_rpc_carrito', p, 'No se pudo cargar el carrito'),
    carritoSetItem:  (p) => rpc('b2b_rpc_carrito_set_item', p, 'No se pudo actualizar el carrito'),
    carritoSetDatos: (p) => rpc('b2b_rpc_carrito_set_datos', p, 'No se pudieron guardar los datos'),
    enviarPedido:  (p) => rpc('b2b_rpc_enviar_pedido', p, 'No se pudo enviar el pedido'),
    misPedidos:    (p) => lista('b2b_rpc_mis_pedidos', p, 'No se pudieron cargar tus pedidos'),
    anularPedido:  (p) => rpc('b2b_rpc_anular_pedido', p, 'No se pudo anular el pedido'),

    /* El pedido recurrente (0157): vuelca un pedido propio ya enviado en el
       carrito actual. No hay disparo automatico por fecha — no hay scheduler
       en la base — pero es lo que el mayorista hace de verdad: pedir otra vez
       lo mismo.
       payload: { pedido_id | numero, modo: 'agregar' | 'reemplazar' }
       ★ Recarga a PRECIO DE HOY, no al congelado del pedido viejo: el precio
       congelado protege un pedido ya enviado, no habilita a comprar para
       siempre a la lista del año pasado.
       Devuelve { ok, origen, agregados,
                  omitidos:  [{sku, motivo}],                   ← ya no se venden
                  ajustados: [{sku, pedida, cargada, motivo}] } ← cambio el multiplo
       Las dos listas hay que MOSTRARLAS: si se ignoran, el cliente cree que
       repitio el pedido entero y se entera cuando le llega distinto. */
    repetirPedido: (p) => rpc('b2b_rpc_repetir_pedido', p, 'No se pudo repetir el pedido'),

    /* ── Formato ─────────────────────────────────────────────────────── */
    money: (n) => {
      const v = Number(n);
      if (!isFinite(v)) return '—';
      return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    fecha: (iso) => {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d)) return '—';
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },
    fechaHora: (iso) => {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d)) return '—';
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' +
             d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    },

    /* ── Exportar a CSV ──────────────────────────────────────────────────
       Pensado para el Excel que se usa acá, que no es el default global:

       · SEPARADOR ';'. El Excel en es-AR usa el punto y coma como separador
         de lista porque la coma ya es el separador decimal. Con ',' el
         archivo se abre todo en la columna A y hay que ir a "Texto en
         columnas" cada vez.
       · BOM al principio. Sin el BOM, Excel lee el archivo como ANSI y
         "Corralón" aparece como "CorralÃ³n".
       · Los números van con coma decimal y SIN separador de miles: con el
         punto de miles Excel los toma como texto y no suman.
       · Se escapa duplicando la comilla, que es lo que espera el RFC 4180 y
         entienden Excel, Sheets y LibreOffice por igual.

       `filas` es un array de objetos; las claves de la primera fila son los
       encabezados. Devuelve la cantidad exportada para poder avisarla. */
    numeroCSV: (n) => {
      const v = Number(n);
      if (n === null || n === undefined || n === '' || !isFinite(v)) return '';
      return String(v).replace('.', ',');
    },
    descargarCSV: (nombreArchivo, filas) => {
      const datos = Array.isArray(filas) ? filas : [];
      if (datos.length === 0) return 0;
      const cols = Object.keys(datos[0]);
      const celda = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[";\n\r]/.test(s) ? '"' + s.split('"').join('""') + '"' : s;
      };
      const texto = [cols.join(';')]
        .concat(datos.map(f => cols.map(c => celda(f[c])).join(';')))
        .join('\r\n');
      const blob = new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = nombreArchivo;
      document.body.appendChild(a);
      a.click();
      /* Revocar en el mismo tick cancela la descarga en algunos navegadores. */
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
      return datos.length;
    },
  };
})();
