/* ══ TIENDA · PRIMITIVOS DE UI ═══════════════════════════════════════════
   La tienda del cliente NO carga shared.jsx ni modals.jsx del sistema
   interno: esos archivos arrastran MOCK, la sesion del empleado y medio
   modulo de administracion. Un mayorista no tiene que descargar nada de
   eso, y menos todavia que un error ahi adentro le rompa la compra.

   Este archivo cumple el mismo papel que shared.jsx pero para la tienda:
   se carga primero y declara en el scope global (script clasico) los
   nombres que usan los demas archivos — Icon, useToast, y los hooks de
   React ya desestructurados. Misma convencion que el sistema interno.
   ═══════════════════════════════════════════════════════════════════════ */

const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;

/* ── Iconos ────────────────────────────────────────────────────────────
   Subconjunto de los de shared.jsx, con los mismos parametros de trazo
   para que la tienda se vea de la misma familia que el sistema.        */
const Icon = ({ n, s = 16, c = 'currentColor' }) => {
  const p = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: c,
              strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (n) {
    case 'cart':       return <svg {...p}><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>;
    case 'box':        return <svg {...p}><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>;
    case 'package':    return <svg {...p}><path d="M16.5 9.4l-9-5.19"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05"/><path d="M12 22V12"/></svg>;
    case 'history':    return <svg {...p}><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-7 3l-2 2"/><path d="M3 4v5h5"/><path d="M12 7v5l4 2"/></svg>;
    case 'search':     return <svg {...p}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>;
    case 'plus':       return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case 'minus':      return <svg {...p}><path d="M5 12h14"/></svg>;
    case 'check':      return <svg {...p}><path d="M20 6L9 17l-5-5"/></svg>;
    case 'check-circle': return <svg {...p}><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>;
    case 'x':          return <svg {...p}><path d="M18 6L6 18M6 6l12 12"/></svg>;
    case 'trash':      return <svg {...p}><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>;
    case 'lock':       return <svg {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
    case 'user':       return <svg {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    case 'logout':     return <svg {...p}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>;
    case 'alert':      return <svg {...p}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>;
    case 'info':       return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>;
    case 'clock':      return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>;
    case 'chev-down':  return <svg {...p}><path d="M6 9l6 6 6-6"/></svg>;
    case 'chev-right': return <svg {...p}><path d="M9 18l6-6-6-6"/></svg>;
    case 'arrow-left': return <svg {...p}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>;
    case 'refresh':    return <svg {...p}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/><path d="M20.49 15A9 9 0 015.64 18.36L1 14"/></svg>;
    case 'ticket':     return <svg {...p}><path d="M3 9a3 3 0 000 6v3a1 1 0 001 1h16a1 1 0 001-1v-3a3 3 0 010-6V6a1 1 0 00-1-1H4a1 1 0 00-1 1v3z"/><path d="M13 5v14"/></svg>;
    case 'mail':       return <svg {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7"/></svg>;
    case 'briefcase':  return <svg {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>;
    case 'card':       return <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>;
    case 'chart':      return <svg {...p}><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx=".5"/><rect x="12.5" y="8" width="3" height="10" rx=".5"/><rect x="18" y="4" width="3" height="14" rx=".5"/></svg>;
    case 'trend':      return <svg {...p}><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>;
    case 'dollar':     return <svg {...p}><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>;
    case 'calendar':   return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>;
    case 'key':        return <svg {...p}><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2"/><path d="M17 6l3 3"/></svg>;
    case 'eye':        return <svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
    case 'eye-off':    return <svg {...p}><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><path d="M1 1l22 22"/></svg>;
    default:           return <svg {...p}><circle cx="12" cy="12" r="9"/></svg>;
  }
};

/* ── Toast ─────────────────────────────────────────────────────────────
   Los errores del backend llegan con SQLSTATE (ver b2b-data.js). El toast
   los muestra tal cual: los mensajes de las RPC B2B ya estan escritos para
   que los lea el cliente ("El minimo de compra es X y tu pedido suma Y"),
   asi que no hay que reescribirlos ni esconderlos.                      */
const ToastCtx = createContext(null);
const useToast = () => useContext(ToastCtx);

const ToastProvider = ({ children }) => {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const push = useCallback((tipo, msg) => {
    const id = ++seq.current;
    setItems(l => [...l, { id, tipo, msg: String(msg || '') }]);
    setTimeout(() => setItems(l => l.filter(t => t.id !== id)), tipo === 'error' ? 7000 : 4000);
  }, []);

  const api = useMemo(() => ({
    error:   m => push('error', m),
    success: m => push('success', m),
    info:    m => push('info', m),
  }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="t-toasts">
        {items.map(t => (
          <div key={t.id} className={'t-toast t-toast-' + t.tipo}>
            <Icon n={t.tipo === 'error' ? 'alert' : t.tipo === 'success' ? 'check-circle' : 'info'} s={16}/>
            <span>{t.msg}</span>
            <button className="t-toast-x" onClick={() => setItems(l => l.filter(x => x.id !== t.id))}
                    aria-label="Cerrar aviso">
              <Icon n="x" s={13}/>
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
};

/* ── Piezas chicas ─────────────────────────────────────────────────────── */

const Spinner = ({ texto }) => (
  <div className="t-loading">
    <div className="t-spinner" aria-hidden="true"/>
    <span>{texto || 'Cargando…'}</span>
  </div>
);

const Vacio = ({ icono, titulo, children }) => (
  <div className="t-vacio">
    <Icon n={icono || 'box'} s={30} c="var(--ink-faint)"/>
    <h3>{titulo}</h3>
    {children && <p>{children}</p>}
  </div>
);

/* Aviso fijo (no se va solo). tipo: info | warn | error | ok */
const Aviso = ({ tipo = 'info', titulo, children }) => (
  <div className={'t-aviso t-aviso-' + tipo}>
    <Icon n={tipo === 'ok' ? 'check-circle' : tipo === 'info' ? 'info' : 'alert'} s={17}/>
    <div>
      {titulo && <b>{titulo}</b>}
      {children && <div>{children}</div>}
    </div>
  </div>
);

const Modal = ({ open, title, onClose, children, footer, ancho }) => {
  useEffect(() => {
    if (!open) return;
    const esc = e => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="t-overlay" onClick={e => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className="t-modal" style={ancho ? { maxWidth: ancho } : null} role="dialog" aria-modal="true">
        <div className="t-modal-head">
          <h2>{title}</h2>
          {onClose && <button className="t-icon-btn" onClick={onClose} aria-label="Cerrar"><Icon n="x" s={16}/></button>}
        </div>
        <div className="t-modal-body">{children}</div>
        {footer && <div className="t-modal-foot">{footer}</div>}
      </div>
    </div>
  );
};

/* ── Formato ───────────────────────────────────────────────────────────
   Reutiliza los formateadores de B2B_DATA para que la tienda y el panel
   interno muestren la plata exactamente igual.                          */
const money = n => window.B2B_DATA.money(n);
const fecha = s => window.B2B_DATA.fecha(s);
const fechaHora = s => window.B2B_DATA.fechaHora(s);

/* Cantidades: siempre enteras, sin decimales ni separador raro. */
const num = n => {
  const v = Number(n);
  return isFinite(v) ? v.toLocaleString('es-AR') : '—';
};

/* ── Reglas de venta del SKU ───────────────────────────────────────────
   El backend valida multiplo y minimo con errcode 22023. Esto es la misma
   regla del lado del cliente, para no dejarlo mandar algo que sabemos que
   va a rebotar. La autoridad sigue siendo el servidor.                   */
const reglaSku = (prod) => {
  const mult = Math.max(1, Number(prod && prod.multiplo_venta) || 1);
  const min  = Math.max(0, Number(prod && prod.minimo_sku) || 0);
  const paso = mult;
  /* El primer valor valido: el minimo redondeado hacia arriba al multiplo. */
  const inicial = Math.max(mult, Math.ceil(Math.max(min, 1) / mult) * mult);
  return { mult, min, paso, inicial };
};

/* Ajusta una cantidad tipeada a mano al multiplo/minimo mas cercano valido. */
const ajustarCantidad = (valor, prod) => {
  const { mult, min } = reglaSku(prod);
  let v = Math.floor(Number(valor) || 0);
  if (v <= 0) return 0;
  if (v % mult !== 0) v = Math.ceil(v / mult) * mult;
  if (v < min) v = Math.ceil(min / mult) * mult;
  return v;
};

/* Texto humano de la regla, para mostrar debajo del producto. */
const textoRegla = (prod) => {
  const { mult, min } = reglaSku(prod);
  const partes = [];
  if (mult > 1) partes.push(`se vende de a ${mult}`);
  if (min > 0 && min > mult) partes.push(`mínimo ${min}`);
  const bulto = Number(prod && prod.bulto_cantidad) || 0;
  if (bulto > 1) partes.push(`bulto de ${bulto}`);
  return partes.join(' · ');
};

window.TiendaUI = { Icon, ToastProvider, useToast, Spinner, Vacio, Aviso, Modal,
                    money, fecha, fechaHora, num, reglaSku, ajustarCantidad, textoRegla };
