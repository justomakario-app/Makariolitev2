// Componente shared S2.1+
// Modal alternativo cuando un DELETE falla por has_relations
// y ofrece desactivar como salida.
// Usado por: suppliers-tab, customers-tab, expenses-tab,
//            y futuros tabs (empleados, recibos, cash-flow).
// NO eliminar este archivo sin verificar referencias.

function DesactivarFallbackModal({ entityLabel, target, msg, onClose, onDesactivar, running }) {
  const [checked, setChecked] = useState(false);
  const Cmp = window.Modal;
  const safeClose = () => { if (!running) onClose?.(); };

  return (
    <Cmp open={true} title={`Eliminar ${entityLabel}`} onClose={safeClose} footer={
      <>
        <button className="btn-ghost" onClick={safeClose} disabled={running}>Cerrar</button>
        {checked && (
          <button className="btn-primary" onClick={onDesactivar} disabled={running}>
            {running ? 'Desactivando…' : (<><Icon n="check" s={14}/> Desactivar {entityLabel}</>)}
          </button>
        )}
      </>
    }>
      <div style={{display:'flex', alignItems:'flex-start', gap:10, marginBottom:14}}>
        <Icon n="alert" s={24} c="var(--red)"/>
        <div style={{flex:1, fontSize:13, color:'var(--ink)'}}>
          <strong>No se puede eliminar este {entityLabel}.</strong>
          <div style={{marginTop:8, fontSize:12, color:'var(--ink-soft)', whiteSpace:'pre-wrap'}}>
            {msg || `Tiene relaciones asociadas.`}
          </div>
          <div style={{marginTop:10, fontSize:12, color:'var(--ink-muted)'}}>
            Para borrarlo, primero eliminá las relaciones. Alternativa: desactivarlo (queda
            oculto de los listados pero sus datos históricos se preservan).
          </div>
        </div>
      </div>
      <label className="expense-cta-label" style={{padding:'10px 12px', background:'var(--paper-dim)', borderRadius:6, cursor:'pointer'}}>
        <input type="checkbox" checked={checked}
               onChange={e => setChecked(e.target.checked)}/>
        <span>Desactivar el {entityLabel} en su lugar</span>
      </label>
    </Cmp>
  );
}

window.DesactivarFallbackModal = DesactivarFallbackModal;
