/* ══ RRHH PAGE (S2.21b · S2.24 hs extras)
   Página standalone con 4 tabs:
   - Empleados (DEFAULT) — usa EmployeesTab.
   - Recibos — usa RecibosTab.
   - Gestión hs extras — HsExtrasTab (S2.24).
   - Reportes salariales — usa ReportesTab.

   SOLO owner. Guard runtime en app.jsx + filtro ROLE_NAV.
   ══ */

function RrhhPage() {
  const TABS = [
    { id:'empleados',  label:'Empleados' },
    { id:'recibos',    label:'Recibos' },
    { id:'hs-extras',  label:'Gestión hs extras' },
    { id:'reportes',   label:'Reportes salariales' },
  ];
  const [tab, setTab] = useState('empleados');
  const active = TABS.find(t => t.id === tab) || TABS[0];

  const subtituloMap = {
    empleados:  'Plantilla de empleados, ficha ampliada y bulk import.',
    recibos:    'Recibos de sueldo (adelanto, quincena, sueldo) y PDFs.',
    'hs-extras':'Gestión de horas extras por empleado.',
    reportes:   'Histórico salarial y reportes comparativos.',
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Recursos Humanos · {active.label}</div>
          <div className="page-sub">{subtituloMap[tab] || ''}</div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'empleados' && window.EmployeesTab ? <window.EmployeesTab/> :
         tab === 'recibos'   && window.RecibosTab   ? <window.RecibosTab/> :
         tab === 'reportes'  && window.ReportesTab  ? <window.ReportesTab/> :
         tab === 'hs-extras' ? <HsExtrasTab/> : (
          <div className="admin-empty-state">
            <Icon n="users" s={32} c="var(--ink-muted)"/>
            <h3>{active.label}</h3>
            <p>Próximamente</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Helpers compartidos del tab hs extras ── */
const HE_UI = { bg:'#F9FAFB', card:'#FFFFFF', border:'#E5E7EB', borderSoft:'#F0F1F3', ink:'#111827', inkSoft:'#374151', inkMuted:'#6B7280', inkFaint:'#9CA3AF', green:'#16A34A', radius:12 };
const HE_MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function heMoney(n) {
  const A = window.ADMIN_DATA;
  if (A && A.formatMoney) return A.formatMoney(Number(n) || 0, 'ARS');
  return '$' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function heFecha(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split('-');
  return (y && m && dd) ? `${dd}/${m}/${y}` : s;
}

/* ══ HS EXTRAS TAB — registro + historial + reporte mensual ══ */
function HsExtrasTab() {
  const toast = useToast();
  const role = (window.MOCK?.user?.role || '').toLowerCase();
  const isOwner = role === 'owner';
  const A = window.ADMIN_DATA;
  const now = new Date();

  const [vista, setVista]       = useState('registro');   // 'registro' | 'reporte'
  const [empleados, setEmpleados] = useState([]);
  const [loadingEmp, setLoadingEmp] = useState(true);

  // Form de registro
  const [fEmp, setFEmp]   = useState('');
  const [fFecha, setFFecha] = useState(now.toISOString().slice(0,10));
  const [fHoras, setFHoras] = useState('');
  const [fValor, setFValor] = useState('');
  const [fDesc, setFDesc]   = useState('');
  const [saving, setSaving] = useState(false);
  const [valorModal, setValorModal] = useState(null);   // empleado a editar valor/hora

  // Filtros + lista del historial
  const [fltMes, setFltMes]   = useState(now.getMonth() + 1);
  const [fltAnio, setFltAnio] = useState(now.getFullYear());
  const [fltEmp, setFltEmp]   = useState('');
  const [fltPend, setFltPend] = useState(false);
  const [registros, setRegistros] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [delTarget, setDelTarget] = useState(null);
  const [deleting, setDeleting]   = useState(false);

  const empSel = empleados.find(e => e.id === fEmp) || null;

  const loadEmpleados = async () => {
    setLoadingEmp(true);
    try { setEmpleados(await A.loadEmployees({ includeInactive: false })); }
    catch (err) { toast.error(err?.message || 'No se pudieron cargar empleados'); }
    finally { setLoadingEmp(false); }
  };

  const loadList = async () => {
    setLoadingList(true);
    try {
      const payload = { periodo_mes: fltMes, periodo_anio: fltAnio };
      if (fltEmp) payload.employee_id = fltEmp;
      if (fltPend) payload.liquidado = false;
      setRegistros(await A.listHorasExtras(payload));
    } catch (err) { toast.error(err?.message || 'No se pudo cargar el historial'); }
    finally { setLoadingList(false); }
  };

  useEffect(() => { loadEmpleados(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { loadList(); /* eslint-disable-next-line */ }, [fltMes, fltAnio, fltEmp, fltPend]);

  // Al elegir empleado, precargar su valor hora extra.
  const onSelectEmp = (id) => {
    setFEmp(id);
    const e = empleados.find(x => x.id === id);
    setFValor(e && e.valor_hora_extra != null ? String(e.valor_hora_extra) : '');
  };

  const totalForm = (Number(fHoras) || 0) * (Number(fValor) || 0);

  const registrar = async () => {
    if (saving) return;
    if (!fEmp) { toast.error('Elegí un empleado'); return; }
    const horas = Number(fHoras);
    if (!horas || horas <= 0) { toast.error('Cantidad de horas inválida'); return; }
    const valor = Number(fValor);
    if (isNaN(valor) || valor < 0) { toast.error('Valor por hora inválido'); return; }
    setSaving(true);
    try {
      await A.createHoraExtra({
        employee_id: fEmp, fecha: fFecha,
        cantidad_horas: String(horas), valor_hora: String(valor),
        descripcion: fDesc.trim(),
      });
      toast.success('Hora extra registrada');
      setFHoras(''); setFDesc('');
      await loadList();
    } catch (err) {
      if (err && /periodo_cerrado/i.test(err.message || '')) toast.error('No se puede: período contable cerrado.');
      else toast.error(err?.message || 'No se pudo registrar');
      setSaving(false); return;
    }
    setSaving(false);
  };

  const doDelete = async () => {
    if (!delTarget || deleting) return;
    setDeleting(true);
    try {
      await A.deleteHoraExtra({ id: delTarget.id });
      toast.success('Registro eliminado');
      setDelTarget(null);
      await loadList();
    } catch (err) { toast.error(err?.message || 'No se pudo eliminar'); }
    finally { setDeleting(false); }
  };

  // Totalizador del historial
  const tot = registros.reduce((acc, r) => {
    acc.horas += Number(r.cantidad_horas) || 0;
    acc.total += Number(r.total) || 0;
    if (!r.liquidado) acc.pend += Number(r.total) || 0;
    return acc;
  }, { horas: 0, total: 0, pend: 0 });

  const anios = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) anios.push(y);

  if (vista === 'reporte') {
    return <HsExtrasReporte onVolver={() => setVista('registro')}/>;
  }

  const cardStyle = { background:HE_UI.card, border:`1px solid ${HE_UI.border}`, borderRadius:HE_UI.radius, padding:20 };

  return (
    <div style={{background:HE_UI.bg, borderRadius:HE_UI.radius, padding:16}}>
      <div style={{display:'flex', justifyContent:'flex-end', marginBottom:14}}>
        <button className="btn-ghost" onClick={() => setVista('reporte')}>
          <Icon n="chart" s={14}/> Ver reporte del mes
        </button>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(340px, 1fr))', gap:16, alignItems:'start'}}>
        {/* ── PANEL IZQUIERDO — Registro ── */}
        <div style={cardStyle}>
          <div style={{fontSize:15, fontWeight:700, color:HE_UI.ink, marginBottom:14}}>Registrar hora extra</div>

          <div className="field-group">
            <label className="field-label">Empleado</label>
            <select className="field-input" value={fEmp} onChange={e => onSelectEmp(e.target.value)} disabled={loadingEmp}>
              <option value="">— Elegí empleado —</option>
              {empleados.map(e => (
                <option key={e.id} value={e.id}>{e.nombre}{e.categoria ? ` · ${e.categoria}` : ''}</option>
              ))}
            </select>
            {empSel && (
              <div style={{display:'flex', alignItems:'center', gap:8, marginTop:6}}>
                <span style={{fontSize:11, fontWeight:700, padding:'2px 9px', borderRadius:999, background:'#EEF2FF', color:'#4F46E5'}}>
                  Valor/hora actual: {heMoney(empSel.valor_hora_extra || 0)}
                </span>
                {isOwner && (
                  <button className="btn-ghost" style={{padding:'3px 8px', fontSize:11}} onClick={() => setValorModal(empSel)}>
                    <Icon n="edit" s={11}/> Editar valor/hora
                  </button>
                )}
              </div>
            )}
          </div>

          <div style={{display:'flex', gap:12}}>
            <div className="field-group" style={{flex:1}}>
              <label className="field-label">Fecha</label>
              <input type="date" className="field-input" value={fFecha} onChange={e => setFFecha(e.target.value)}/>
            </div>
            <div className="field-group" style={{flex:1}}>
              <label className="field-label">Cantidad de horas</label>
              <input type="number" step="0.5" min="0" className="field-input" value={fHoras}
                     placeholder="Ej: 2.5" onChange={e => setFHoras(e.target.value)}/>
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">Valor por hora ($)</label>
            <input type="number" step="0.01" min="0" className="field-input" value={fValor}
                   onChange={e => setFValor(e.target.value)}/>
            <div className="field-help">Pre-cargado del empleado. Podés ajustarlo para este registro.</div>
          </div>

          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'10px 12px', background:'#F0FDF4', borderRadius:8, margin:'4px 0 14px'}}>
            <span style={{fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:HE_UI.inkMuted}}>Total</span>
            <span style={{fontFamily:'var(--mono)', fontSize:22, fontWeight:800, color:HE_UI.green}}>{heMoney(totalForm)}</span>
          </div>

          <div className="field-group">
            <label className="field-label">Descripción (opcional)</label>
            <input className="field-input" value={fDesc} placeholder="Ej: cierre de mes, pedido urgente…"
                   onChange={e => setFDesc(e.target.value)}/>
          </div>

          <button className="btn-primary" style={{width:'100%', justifyContent:'center'}} onClick={registrar} disabled={saving}>
            {saving ? 'Registrando…' : (<><Icon n="plus" s={14}/> Registrar</>)}
          </button>
        </div>

        {/* ── PANEL DERECHO — Historial ── */}
        <div style={cardStyle}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:12, flexWrap:'wrap'}}>
            <div style={{fontSize:15, fontWeight:700, color:HE_UI.ink}}>Historial</div>
          </div>

          <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:12}}>
            <select className="field-input" style={{flex:'1 1 120px', padding:'7px 10px'}} value={fltMes} onChange={e => setFltMes(Number(e.target.value))}>
              {HE_MESES.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
            </select>
            <select className="field-input" style={{width:100, padding:'7px 10px'}} value={fltAnio} onChange={e => setFltAnio(Number(e.target.value))}>
              {anios.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="field-input" style={{flex:'1 1 140px', padding:'7px 10px'}} value={fltEmp} onChange={e => setFltEmp(e.target.value)}>
              <option value="">Todos</option>
              {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
            <label style={{display:'flex', alignItems:'center', gap:6, fontSize:12, color:HE_UI.inkSoft, fontWeight:600, whiteSpace:'nowrap'}}>
              <input type="checkbox" checked={fltPend} onChange={e => setFltPend(e.target.checked)}/>
              Solo pendientes
            </label>
          </div>

          {loadingList ? (
            <div style={{display:'flex', justifyContent:'center', padding:'32px 0'}}><span className="loader" style={{width:22, height:22}}/></div>
          ) : registros.length === 0 ? (
            <div style={{textAlign:'center', padding:'32px 0', color:HE_UI.inkMuted}}>
              <Icon n="clock" s={28} c={HE_UI.inkFaint}/>
              <div style={{fontSize:13, marginTop:8}}>Sin registros en este período.</div>
            </div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', gap:8}}>
              {registros.map(r => (
                <div key={r.id} style={{border:`1px solid ${HE_UI.border}`, borderRadius:10, padding:'12px 14px'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontWeight:600, fontSize:14, color:HE_UI.ink}}>{r.empleado_nombre}</div>
                      <div style={{fontSize:11, color:HE_UI.inkMuted}}>{r.empleado_categoria || '—'}</div>
                      <div style={{fontSize:12, color:HE_UI.inkSoft, marginTop:5}}>
                        {heFecha(r.fecha)} · {r.cantidad_horas} hs × {heMoney(r.valor_hora)}
                      </div>
                      {r.descripcion && <div style={{fontSize:11, color:HE_UI.inkMuted, marginTop:3}}>{r.descripcion}</div>}
                    </div>
                    <div style={{textAlign:'right', flexShrink:0}}>
                      <div style={{fontFamily:'var(--mono)', fontWeight:800, fontSize:15, color:HE_UI.green}}>{heMoney(r.total)}</div>
                      <div style={{marginTop:5}}>
                        {r.liquidado
                          ? <span style={{fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:999, background:'#D1FAE5', color:'#059669', textTransform:'uppercase', letterSpacing:'.04em'}}>Liquidado</span>
                          : <span style={{fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:999, background:'#FEF3C7', color:'#B45309', textTransform:'uppercase', letterSpacing:'.04em'}}>Pendiente</span>}
                      </div>
                      {isOwner && !r.liquidado && (
                        <button className="btn-ghost" style={{padding:'4px 8px', fontSize:10, marginTop:6, color:'#DC2626', borderColor:'#FCA5A5', background:'#FEF2F2'}}
                                onClick={() => setDelTarget(r)} title="Eliminar registro">
                          <Icon n="trash" s={11}/>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{marginTop:14, paddingTop:12, borderTop:`1px solid ${HE_UI.borderSoft}`, fontSize:13, color:HE_UI.inkSoft, fontWeight:600}}>
            {tot.horas} hs · <strong style={{color:HE_UI.ink}}>{heMoney(tot.total)}</strong> total · <strong style={{color:'#B45309'}}>{heMoney(tot.pend)}</strong> pendiente de liquidar
          </div>
        </div>
      </div>

      {valorModal && (
        <ValorHoraModal
          empleado={valorModal}
          onClose={() => setValorModal(null)}
          onSaved={async (nuevo) => {
            setValorModal(null);
            await loadEmpleados();
            if (empSel && empSel.id === nuevo.id) setFValor(String(nuevo.valor));
          }}
        />
      )}

      {delTarget && window.ConfirmModal && (
        <window.ConfirmModal
          open={true}
          title="Eliminar hora extra"
          message={`¿Eliminar el registro de ${delTarget.empleado_nombre} (${heFecha(delTarget.fecha)}, ${heMoney(delTarget.total)})? Esta acción no se puede deshacer.`}
          confirmText="Eliminar" danger
          onClose={() => { if (!deleting) setDelTarget(null); }}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}

/* Mini-modal para editar el valor_hora_extra del empleado. */
function ValorHoraModal({ empleado, onClose, onSaved }) {
  const toast = useToast();
  const [valor, setValor] = useState(empleado.valor_hora_extra != null ? String(empleado.valor_hora_extra) : '');
  const [saving, setSaving] = useState(false);
  const Cmp = window.Modal;

  const guardar = async () => {
    const v = Number(valor);
    if (isNaN(v) || v < 0) { toast.error('Valor inválido'); return; }
    setSaving(true);
    try {
      await window.ADMIN_DATA.updateValorHoraEmpleado({ employee_id: empleado.id, valor_hora_extra: String(v) });
      toast.success('Valor por hora actualizado');
      onSaved?.({ id: empleado.id, valor: v });
    } catch (err) { toast.error(err?.message || 'No se pudo actualizar'); setSaving(false); }
  };

  return (
    <Cmp open={true} title={`Valor hora extra · ${empleado.nombre}`} onClose={() => { if (!saving) onClose?.(); }} footer={
      <>
        <button className="btn-ghost" onClick={() => { if (!saving) onClose?.(); }} disabled={saving}>Cancelar</button>
        <button className="btn-primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </>
    }>
      <div className="field-group">
        <label className="field-label">Valor por hora extra ($)</label>
        <input type="number" step="0.01" min="0" className="field-input" value={valor} autoFocus
               onChange={e => setValor(e.target.value)}/>
        <div className="field-help">Se guarda en la ficha del empleado y se usa como default al registrar horas.</div>
      </div>
    </Cmp>
  );
}

/* ══ REPORTE MENSUAL — tabla por empleado + export PDF ══ */
function HsExtrasReporte({ onVolver }) {
  const toast = useToast();
  const A = window.ADMIN_DATA;
  const now = new Date();
  const [mes, setMes]   = useState(now.getMonth() + 1);
  const [anio, setAnio] = useState(now.getFullYear());
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exp, setExp] = useState(null);   // employee_id expandido

  const anios = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) anios.push(y);

  const load = async () => {
    setLoading(true);
    try { setData(await A.reporteHsExtras({ periodo_mes: mes, periodo_anio: anio })); }
    catch (err) { toast.error(err?.message || 'No se pudo cargar el reporte'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [mes, anio]);

  const totales = data.reduce((acc, r) => {
    acc.horas += Number(r.total_horas) || 0;
    acc.total += Number(r.total_pesos) || 0;
    acc.liq   += Number(r.total_liquidado) || 0;
    acc.pend  += Number(r.total_pendiente) || 0;
    return acc;
  }, { horas: 0, total: 0, liq: 0, pend: 0 });

  const exportarPDF = () => {
    if (!window.jspdf || !window.jspdf.jsPDF) { toast.error('Librería PDF no cargada — refrescá la página'); return; }
    if (!data.length) { toast.info('Nada para exportar en este período'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = 18;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.setFontSize(10);
    doc.text(window.MAKARIO_BRAND_NAME || 'Justo Makario', 12, y); y += 7;
    doc.setFontSize(15);
    doc.text(`Horas extras · ${HE_MESES[mes-1]} ${anio}`, 12, y); y += 8;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    const headers = ['Empleado','Categoría','Horas','Total','Liquidado','Pendiente'];
    const colX = [12, 70, 110, 130, 155, 180];
    doc.setFillColor(240,240,240); doc.rect(12, y-4, 186, 6, 'F');
    doc.setFont('helvetica','bold');
    headers.forEach((h,i) => doc.text(h, colX[i], y));
    y += 5; doc.setFont('helvetica','normal');
    for (const r of data) {
      if (y > 280) { doc.addPage(); y = 18; }
      const row = [
        String(r.empleado_nombre || '').slice(0, 32),
        String(r.categoria || '—').slice(0, 18),
        String(r.total_horas || 0),
        heMoney(r.total_pesos), heMoney(r.total_liquidado), heMoney(r.total_pendiente),
      ];
      row.forEach((c,i) => doc.text(String(c), colX[i], y));
      y += 5;
    }
    y += 2; doc.setFont('helvetica','bold');
    doc.text('TOTALES', 12, y);
    doc.text(String(totales.horas), colX[2], y);
    doc.text(heMoney(totales.total), colX[3], y);
    doc.text(heMoney(totales.liq), colX[4], y);
    doc.text(heMoney(totales.pend), colX[5], y);
    doc.save(`hs-extras-${anio}-${String(mes).padStart(2,'0')}.pdf`);
    toast.success('PDF exportado');
  };

  return (
    <div style={{background:HE_UI.bg, borderRadius:HE_UI.radius, padding:16}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:14, flexWrap:'wrap'}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <button className="btn-ghost" onClick={onVolver}>← Volver al registro</button>
          <select className="field-input" style={{padding:'7px 10px'}} value={mes} onChange={e => setMes(Number(e.target.value))}>
            {HE_MESES.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
          <select className="field-input" style={{width:100, padding:'7px 10px'}} value={anio} onChange={e => setAnio(Number(e.target.value))}>
            {anios.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button className="btn-primary" onClick={exportarPDF} disabled={!data.length}>
          <Icon n="download" s={13}/> Exportar PDF
        </button>
      </div>

      <div style={{background:HE_UI.card, border:`1px solid ${HE_UI.border}`, borderRadius:HE_UI.radius, padding:0, overflow:'hidden'}}>
        {loading ? (
          <div style={{display:'flex', justifyContent:'center', padding:'40px 0'}}><span className="loader" style={{width:24, height:24}}/></div>
        ) : data.length === 0 ? (
          <div style={{textAlign:'center', padding:'40px 0', color:HE_UI.inkMuted}}>
            <Icon n="chart" s={30} c={HE_UI.inkFaint}/>
            <div style={{fontSize:13, marginTop:8}}>Sin horas extras en {HE_MESES[mes-1]} {anio}.</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Empleado</th><th>Categoría</th>
                <th style={{textAlign:'right'}}>Horas</th>
                <th style={{textAlign:'right'}}>Total</th>
                <th style={{textAlign:'right'}}>Liquidado</th>
                <th style={{textAlign:'right'}}>Pendiente</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map(r => {
                const open = exp === r.employee_id;
                return (
                  <React.Fragment key={r.employee_id}>
                    <tr style={{cursor:'pointer'}} onClick={() => setExp(open ? null : r.employee_id)}>
                      <td style={{fontWeight:600}}>{r.empleado_nombre}</td>
                      <td style={{color:HE_UI.inkMuted}}>{r.categoria || '—'}</td>
                      <td style={{textAlign:'right'}}><span className="cell-color-num">{r.total_horas}</span></td>
                      <td style={{textAlign:'right', fontWeight:600}}>{heMoney(r.total_pesos)}</td>
                      <td style={{textAlign:'right', color:'#059669'}}>{heMoney(r.total_liquidado)}</td>
                      <td style={{textAlign:'right', color:'#B45309'}}>{heMoney(r.total_pendiente)}</td>
                      <td style={{textAlign:'right', width:1}}><Icon n={open ? 'chev-down' : 'chev-right'} s={13} c={HE_UI.inkMuted}/></td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} style={{background:'#FAFBFC', padding:'8px 16px'}}>
                          <table className="data-table" style={{margin:0}}>
                            <thead><tr><th>Fecha</th><th style={{textAlign:'right'}}>Horas</th><th style={{textAlign:'right'}}>Valor/h</th><th style={{textAlign:'right'}}>Total</th><th>Descripción</th><th>Estado</th></tr></thead>
                            <tbody>
                              {(r.detalle || []).map((d, i) => (
                                <tr key={d.id || i}>
                                  <td>{heFecha(d.fecha)}</td>
                                  <td style={{textAlign:'right'}}>{d.cantidad_horas}</td>
                                  <td style={{textAlign:'right'}}>{heMoney(d.valor_hora)}</td>
                                  <td style={{textAlign:'right', fontWeight:600}}>{heMoney(d.total)}</td>
                                  <td style={{color:HE_UI.inkMuted}}>{d.descripcion || '—'}</td>
                                  <td>{d.liquidado ? 'Liquidado' : 'Pendiente'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              <tr style={{borderTop:`2px solid ${HE_UI.border}`, fontWeight:800}}>
                <td colSpan={2}>TOTALES</td>
                <td style={{textAlign:'right'}}>{totales.horas}</td>
                <td style={{textAlign:'right'}}>{heMoney(totales.total)}</td>
                <td style={{textAlign:'right', color:'#059669'}}>{heMoney(totales.liq)}</td>
                <td style={{textAlign:'right', color:'#B45309'}}>{heMoney(totales.pend)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

window.RrhhPage = RrhhPage;
window.HsExtrasTab = HsExtrasTab;
