import { Icon } from '@/components/shared/Icon';

export function ConfigPage() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Configuración</div>
          <div className="page-sub">Ajustes del sistema</div>
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:12}}>
        {[
          { i:'shield' as const, t:'Seguridad', s:'Cambiar contraseña, sesiones activas' },
          { i:'bell' as const, t:'Notificaciones', s:'Preferencias y umbrales' },
          { i:'truck' as const, t:'Canales de venta', s:'Horarios y plantillas Excel' },
          { i:'settings' as const, t:'Sistema', s:'Backup, integración, exportación' },
        ].map(c => (
          <div key={c.t} className="card" style={{padding:20, display:'flex', gap:14, cursor:'pointer'}}>
            <div style={{width:40, height:40, background:'var(--paper-dim)', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, flexShrink:0}}>
              <Icon n={c.i} s={18}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:14, fontWeight:700, marginBottom:3}}>{c.t}</div>
              <div style={{fontSize:11, color:'var(--ink-muted)'}}>{c.s}</div>
            </div>
            <Icon n="chev-right" s={16} c="var(--ink-faint)"/>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QRPage() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Scanner QR</div>
          <div className="page-sub">Confirmación de embalado</div>
        </div>
      </div>
      <div className="card" style={{padding:32}}>
        <div className="empty">
          <Icon n="qr" s={32} c="var(--ink-muted)"/>
          <div style={{fontSize:13, fontWeight:700}}>QR Scanner desktop</div>
          <div style={{fontSize:12, color:'var(--ink-muted)', textAlign:'center', maxWidth:400, lineHeight:1.5}}>
            Para escanear QRs usá la versión mobile (PWA) en tu celular: <code style={{fontFamily:'var(--mono)'}}>/m/scan</code>. Ahí tenés acceso a la cámara del dispositivo. Desde desktop podés ver los escaneos en el histórico.
          </div>
        </div>
      </div>
    </div>
  );
}
