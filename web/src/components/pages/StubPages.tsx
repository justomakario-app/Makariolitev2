import { Icon } from '@/components/shared/Icon';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@macario/shared/lib/supabase';
import type { Database } from '@macario/shared/types/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

const ROLE_COLOR: Record<string, string> = {
  owner:'#0a0a0a', admin:'#7c3aed', encargado:'#2563eb',
  embalaje:'#16a34a', cnc:'#d97706', melamina:'#0891b2',
  pino:'#92400e', logistica:'#6366f1', ventas:'#db2777',
  carpinteria:'#a16207', marketing:'#0d9488',
};

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario', admin: 'Administración', encargado: 'Encargado',
  ventas: 'Ventas', cnc: 'CNC', melamina: 'Melamina', pino: 'Pino',
  embalaje: 'Embalaje', carpinteria: 'Carpintería',
  logistica: 'Logística', marketing: 'Marketing',
};

export function EquipoPage() {
  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase.from('profiles').select('*').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Equipo</div>
          <div className="page-sub">{profiles.filter(u => u.active).length} activos · {profiles.length} en total</div>
        </div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:12}}>
        {profiles.map(u => {
          const c = ROLE_COLOR[u.role] ?? '#888';
          const initials = u.name.split(' ').map(s => s[0]).join('').slice(0,2).toUpperCase();
          return (
            <div key={u.id} className="card" style={{padding:18, display:'flex', gap:14, alignItems:'center', opacity: u.active ? 1 : 0.55}}>
              <div style={{width:44, height:44, background: u.avatar_color ?? c, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:800, borderRadius:6, flexShrink:0}}>{initials}</div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:14, fontWeight:700}}>{u.name}{!u.active ? <span style={{marginLeft:8, fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:8, background:'var(--paper-dim)', color:'var(--ink-muted)', textTransform:'uppercase'}}>Inactivo</span> : null}</div>
                <div style={{fontSize:11, color:'var(--ink-muted)', fontFamily:'var(--mono)'}}>@{u.username}{u.area ? ' · ' + u.area : ''}</div>
                <div style={{marginTop:6, display:'inline-flex', alignItems:'center', gap:5, fontSize:10, fontWeight:700, textTransform:'uppercase', padding:'2px 8px', borderRadius:10, background:`${c}1a`, color:c}}>
                  {ROLE_LABEL[u.role] ?? u.role}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{marginTop:16, padding:14, background:'var(--paper-off)', border:'1px dashed var(--border-md)', borderRadius:6, fontSize:11, color:'var(--ink-soft)'}}>
        <Icon n="info" s={12}/> Invitar / editar / desactivar usuario — pendiente de portar al modal TS + Edge Function `invite_user`.
      </div>
    </div>
  );
}

export function HistoricoPage() {
  return <StubPage title="Histórico" hint="Calendario mensual + filtros + KPIs · pendiente de portar al esquema TS. Data: production_logs + view_historico_dia."/>;
}

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
  return <StubPage title="Scanner QR" hint="Confirmación de embalado · pendiente de portar input + cámara (Html5Qrcode) e insertar en qr_scans (auto operario_id = auth.uid())."/>;
}

function StubPage({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">{title}</div>
          <div className="page-sub">Backend listo · UI completa pendiente de port</div>
        </div>
      </div>
      <div className="card" style={{padding:32}}>
        <div className="empty">
          <Icon n="info" s={28} c="var(--ink-muted)"/>
          <div style={{fontSize:13, fontWeight:700}}>{title}</div>
          <div style={{fontSize:12, color:'var(--ink-muted)', textAlign:'center', maxWidth:400, lineHeight:1.5}}>
            {hint}
          </div>
        </div>
      </div>
    </div>
  );
}
