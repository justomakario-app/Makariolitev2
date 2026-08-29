/* ══ FACTURAS DEL MAYORISTA (0169) ═══════════════════════════════════════
   Subir la factura que ya se emitió afuera y dejársela al cliente en su
   cuenta, donde se la baja cuando quiera. El sistema no emite ni numera
   nada: es un archivero con buena vista.

   Está en su propio archivo y no adentro de un tab porque se usa desde dos
   lados distintos:

     · Pedidos  → el detalle del pedido, con la factura ya atada a ese pedido
     · Clientes → todas las facturas del cliente, incluidas las sueltas
                  (una venta por teléfono que nunca pasó por la tienda)

   Los dos usan el mismo panel. Duplicarlo en los dos tabs habría sido
   duplicar también el circuito de subida, que es la parte que no conviene
   tener escrita dos veces.

   Ojo con el orden de carga: este archivo tiene que ir DESPUÉS de
   admin-data.js y ANTES de los tabs que lo usan. ══ */

/* La fecha de hoy en hora local, no en UTC. toISOString() devuelve UTC y en
   Argentina (UTC−3) después de las 21:00 eso ya es mañana: la factura de un
   martes a la noche se guardaba con fecha del miércoles. */
function b2bFacturaHoy() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + dd;
}

function b2bFacturaPeso(bytes) {
  const n = Number(bytes);
  if (!isFinite(n) || n <= 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
}

/* La fecha viene como 'YYYY-MM-DD' (date, sin hora). Pasarla por new Date()
   la interpreta como UTC medianoche y la muestra un día antes. Se parte a
   mano, que además es más rápido. */
function b2bFacturaFecha(iso) {
  if (!iso) return '';
  const p = String(iso).slice(0, 10).split('-');
  if (p.length !== 3) return '';
  return p[2] + '/' + p[1] + '/' + p[0];
}

/* ── La ficha de una factura en la lista ───────────────────────────────
   Bajar y quitar. Quitar pide confirmación en el mismo botón en vez de
   abrir un confirm() del navegador: son dos clicks igual, pero no frena
   toda la pantalla y no se ve prestado. ── */
function B2BFacturaFila({ f, onBorrada }) {
  const toast = useToast();
  const [bajando, setBajando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [borrando, setBorrando] = useState(false);

  const label = (window.ADMIN_DATA.FACTURA_TIPO_LABELS || {})[f.tipo] || 'Comprobante';

  /* El bucket es privado: la URL se pide al hacer click y vence en 10
     minutos. Y se dispara con un <a> de mentira en vez de window.open
     porque después del await el navegador ya no lo toma como un click de
     verdad y lo bloquea igual que un pop-up. */
  const bajar = async () => {
    if (bajando) return;
    setBajando(true);
    try {
      const nombre = window.B2B_DATA.facturaNombreArchivo(f);
      const url = await window.B2B_DATA.facturaUrl(f.path, nombre);
      if (!url) throw new Error('No pudimos abrir el archivo.');
      const a = document.createElement('a');
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      toast.error(e?.message || 'No pudimos bajar la factura');
    } finally {
      setBajando(false);
    }
  };

  const quitar = async () => {
    if (borrando) return;
    setBorrando(true);
    try {
      await window.ADMIN_DATA.borrarFactura(f.id);
      toast.success('La factura ya no le aparece al cliente');
      onBorrada?.(f);
    } catch (e) {
      toast.error(e?.message || 'No se pudo quitar la factura');
      setBorrando(false); setConfirmar(false);
    }
  };

  return (
    <li className="b2b-comp">
      <Icon n="file" s={15} c="var(--ink-muted)"/>
      <div className="b2b-comp-txt">
        <div className="b2b-comp-nom">
          <span className={'b2b-fac-tipo' + (f.tipo === 'nota_credito' ? ' nc' : '')}>{label}</span>
          {f.numero ? ' ' + f.numero : ' sin número'}
        </div>
        <div className="b2b-comp-sub">
          {[
            b2bFacturaFecha(f.fecha),
            f.total != null ? window.B2B_DATA.money(f.total) : '',
            f.pedido_numero ? 'Pedido ' + f.pedido_numero : '',
            b2bFacturaPeso(f.size_bytes),
            f.subio || '',
          ].filter(Boolean).join(' · ')}
        </div>
        {f.nota && <div className="b2b-comp-nota">{f.nota}</div>}
      </div>
      <button className="btn-ghost-sm" style={{marginLeft:0}} disabled={bajando} onClick={bajar}>
        <Icon n="download" s={12}/> {bajando ? 'Abriendo…' : 'Bajar'}
      </button>
      {confirmar ? (
        <button className="btn-ghost-sm b2b-fac-del" disabled={borrando} onClick={quitar}
                title="Sale de la cuenta del cliente. En la base queda registrada.">
          <Icon n="trash" s={12}/> {borrando ? 'Quitando…' : '¿Seguro?'}
        </button>
      ) : (
        <button className="btn-ghost-sm" onClick={() => setConfirmar(true)}
                title="Sacarla de la cuenta del cliente">
          <Icon n="trash" s={12}/>
        </button>
      )}
    </li>
  );
}

/* ── El panel: lo que ya tiene cargado + el formulario para sumar una ──
   props:
     clienteId      obligatorio
     clienteNombre  para los textos
     pedidoId       si viene, la factura queda atada a ese pedido
     pedidoNumero   para mostrarlo
     totalSugerido  precarga el importe (el total con IVA del pedido)
     sinIva         el pedido está marcado SIN IVA: avisa antes de subir
     formPlegado    arranca con el formulario cerrado detrás de un botón
     onCambio       se llama después de subir o de quitar, para que el que
                    lo abrió refresque su contador ── */
function B2BFacturasPanel({ clienteId, clienteNombre, pedidoId, pedidoNumero,
                            totalSugerido, sinIva, formPlegado, onCambio }) {
  const toast = useToast();
  const D = window.ADMIN_DATA;

  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const [file, setFile] = useState(null);
  const [sobre, setSobre] = useState(false);      // el archivo se está arrastrando encima
  const [tipo, setTipo] = useState('factura');
  const [numero, setNumero] = useState('');
  const [fecha, setFecha] = useState(b2bFacturaHoy());
  const [total, setTotal] = useState(
    totalSugerido != null && totalSugerido !== '' ? String(totalSugerido) : '');
  const [nota, setNota] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  /* Pedido sin IVA: el cliente pidió presupuesto y no espera factura. Se
     avisa y se deja seguir — hay casos reales (llamó y la pidió después) y
     bloquearlo obligaría a dar dos vueltas por el panel. El tilde es la
     confirmación explícita de que se está haciendo a propósito. */
  const [okSinIva, setOkSinIva] = useState(false);
  const [abrirForm, setAbrirForm] = useState(!formPlegado);
  const inputRef = useRef(null);

  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  /* Con pedidoId trae solo las de ese pedido; sin él, todas las del cliente
     (las de sus pedidos y las sueltas juntas, que es lo que se quiere ver
     desde la ficha del cliente). */
  const traer = useCallback(() => {
    setCargando(true); setError('');
    return D.listarFacturas(pedidoId ? { pedido_id: pedidoId } : { cliente_id: clienteId })
      .then(r => { if (vivo.current) setLista(r || []); })
      .catch(e => { if (vivo.current) setError(e?.message || 'No se pudieron cargar las facturas'); })
      .then(() => { if (vivo.current) setCargando(false); });
  }, [clienteId, pedidoId]);

  useEffect(() => { traer(); }, [traer]);

  const tomarArchivo = (f) => {
    if (!f) return;
    if ((D.FACTURA_MIMES || []).indexOf(f.type) < 0) {
      toast.error('Solo aceptamos PDF, JPG o PNG.');
      return;
    }
    if (f.size > D.FACTURA_MAX_BYTES) {
      toast.error('El archivo no puede pesar más de 10 MB.');
      return;
    }
    setFile(f);
    /* Si el archivo se llama "A-0001-00001234.pdf", el número ya está ahí.
       Se propone, no se impone: el campo queda editable. */
    if (!numero) {
      const base = f.name.replace(/\.[a-z0-9]+$/i, '');
      const m = base.match(/\d{3,5}[-\s]?\d{6,8}/) || base.match(/[A-Z]?-?\d{4}-\d{8}/i);
      if (m) setNumero(m[0].trim().slice(0, 40));
    }
  };

  const subir = async () => {
    if (subiendo) return;
    if (!file) { toast.error('Elegí el archivo de la factura.'); return; }
    if (sinIva && !okSinIva) {
      toast.error('Este pedido está marcado sin IVA: confirmá el aviso antes de subirla.');
      return;
    }
    setSubiendo(true);
    try {
      await D.subirFactura({
        cliente_id: clienteId,
        pedido_id: pedidoId || null,
        file: file,
        tipo: tipo,
        numero: numero.trim() || null,
        fecha: fecha || null,
        total: total.trim() === '' ? null : Number(String(total).replace(',', '.')),
        nota: nota.trim() || null,
      });
      toast.success('Listo: ya le aparece en su cuenta');
      setFile(null); setNumero(''); setNota('');
      if (inputRef.current) inputRef.current.value = '';
      await traer();
      onCambio?.();
    } catch (e) {
      toast.error(e?.message || 'No se pudo subir la factura');
    } finally {
      setSubiendo(false);
    }
  };

  const borrada = async () => { await traer(); onCambio?.(); };

  return (
    <div className="b2b-fac">
      {/* ── Lo que ya tiene ── */}
      {cargando ? (
        <div className="b2b-det-vacio">Buscando las facturas…</div>
      ) : error ? (
        <div className="b2b-det-vacio" style={{color:'var(--red)'}}>{error}</div>
      ) : lista.length === 0 ? (
        <div className="b2b-det-vacio">
          {pedidoId
            ? 'Este pedido todavía no tiene factura cargada.'
            : 'Todavía no le cargaste ninguna factura a este cliente.'}
        </div>
      ) : (
        <ul className="b2b-comps">
          {lista.map(f => <B2BFacturaFila key={f.id} f={f} onBorrada={borrada}/>)}
        </ul>
      )}

      {/* ── Cargar una nueva ──
          Plegado cuando el panel vive adentro del detalle de un pedido: ahí
          casi siempre se entra a mirar y no a cargar, y el formulario abierto
          empujaba los PDF media pantalla para abajo. ── */}
      {!abrirForm ? (
        <div className="b2b-fac-abrir">
          <button className="btn-ghost" onClick={() => setAbrirForm(true)}>
            <Icon n="upload" s={13}/> Cargar una factura
          </button>
        </div>
      ) : (
        <>
        <div className="b2b-det-tit">
          <Icon n="upload" s={13}/> Cargar una factura
        </div>

        <div className={'b2b-fac-drop' + (sobre ? ' on' : '') + (file ? ' listo' : '')}
             onDragOver={e => { e.preventDefault(); setSobre(true); }}
             onDragLeave={() => setSobre(false)}
             onDrop={e => {
               e.preventDefault(); setSobre(false);
               tomarArchivo(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
             }}
             onClick={() => inputRef.current && inputRef.current.click()}>
          <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png"
                 onChange={e => tomarArchivo(e.target.files && e.target.files[0])}/>
          <Icon n={file ? 'check-circle' : 'file'} s={20} c={file ? 'var(--green, #15803d)' : 'var(--ink-muted)'}/>
          <div className="b2b-fac-drop-txt">
            {file ? (
              <>
                <b>{file.name}</b>
                <span>{b2bFacturaPeso(file.size)} · tocá para cambiarlo</span>
              </>
            ) : (
              <>
                <b>Arrastrá el PDF acá o hacé click para elegirlo</b>
                <span>PDF, JPG o PNG · hasta 10 MB</span>
              </>
            )}
          </div>
        </div>

        <div className="b2b-fac-grid">
          <div className="field-group">
            <label className="field-label">Tipo</label>
            <select className="field-input" value={tipo} onChange={e => setTipo(e.target.value)}>
              {(D.FACTURA_TIPO_OPTIONS || []).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Número</label>
            <input className="field-input" type="text" maxLength={40}
                   value={numero} onChange={e => setNumero(e.target.value)}
                   placeholder="A-0001-00001234"/>
          </div>
          <div className="field-group">
            <label className="field-label">Fecha</label>
            <input className="field-input" type="date"
                   value={fecha} onChange={e => setFecha(e.target.value)}/>
          </div>
          <div className="field-group">
            <label className="field-label">Importe</label>
            <input className="field-input" type="number" min="0" step="0.01" inputMode="decimal"
                   value={total} onChange={e => setTotal(e.target.value)}
                   placeholder="Opcional"/>
          </div>
        </div>

        <div className="field-group">
          <label className="field-label">Nota para el cliente <span style={{fontWeight:400}}>(opcional)</span></label>
          <input className="field-input" type="text" maxLength={300}
                 value={nota} onChange={e => setNota(e.target.value)}
                 placeholder="Ej: incluye el flete de la entrega del 12"/>
        </div>

        {sinIva && (
          <label className="b2b-aviso-iva">
            <input type="checkbox" checked={okSinIva}
                   onChange={e => setOkSinIva(e.target.checked)}/>
            <span>
              <b>Este pedido está marcado SIN IVA.</b> El cliente lo pidió como
              presupuesto, así que no está esperando ninguna factura. Se puede
              subir igual — tildá para confirmar que va a propósito.
            </span>
          </label>
        )}

        <div className="b2b-fac-pie">
          <div className="b2b-fac-nota">
            {pedidoId
              ? <>Va a quedar colgada del pedido <b>{pedidoNumero}</b> y en el historial de facturas de {clienteNombre || 'el cliente'}.</>
              : <>Va al historial de facturas de <b>{clienteNombre || 'el cliente'}</b>, sin pedido asociado.</>}
            {' '}Le llega un mail avisándole, si tenés prendido “Avisarle también al cliente”.
          </div>
          <button className="btn-primary" disabled={subiendo || !file || (sinIva && !okSinIva)}
                  onClick={subir}>
            {subiendo ? 'Subiendo…' : (<><Icon n="upload" s={13}/> Subir y avisarle</>)}
          </button>
        </div>
        </>
      )}

    </div>
  );
}

/* ── El panel adentro de un modal, para llamarlo desde una tabla ── */
function B2BFacturasModal({ clienteId, clienteNombre, pedidoId, pedidoNumero, totalSugerido, onClose, onCambio }) {
  const Cmp = window.Modal;
  return (
    <Cmp open={true} size="lg"
         title={pedidoNumero ? `Facturas de ${pedidoNumero}` : `Facturas de ${clienteNombre || 'el cliente'}`}
         onClose={onClose}
         footer={<button className="btn-ghost" onClick={onClose}>Cerrar</button>}>
      <B2BFacturasPanel clienteId={clienteId} clienteNombre={clienteNombre}
                        pedidoId={pedidoId} pedidoNumero={pedidoNumero}
                        totalSugerido={totalSugerido} onCambio={onCambio}/>
    </Cmp>
  );
}

window.B2BFacturasPanel = B2BFacturasPanel;
window.B2BFacturasModal = B2BFacturasModal;
