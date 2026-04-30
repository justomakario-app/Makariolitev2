import { useState } from 'react';
import { Icon } from '@/components/shared/Icon';
import { useToast } from '@/components/shared/Toast';
import { ConfirmModal } from '@/components/shared/Modal';
import { UsuarioEditModal } from '@/components/modals/UsuarioEditModal';
import { useProfiles, useToggleProfileActive } from '@macario/shared/hooks/useTeam';
import { useCurrentProfile } from '@macario/shared/hooks/useAuth';
import type { Database } from '@macario/shared/types/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

const ROLE_COLOR: Record<string, string> = {
  owner: '#0a0a0a', admin: '#7c3aed', encargado: '#2563eb',
  embalaje: '#16a34a', cnc: '#d97706', melamina: '#0891b2',
  pino: '#92400e', logistica: '#6366f1', ventas: '#db2777',
  carpinteria: '#a16207', marketing: '#0d9488',
};

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario', admin: 'Administración', encargado: 'Encargado General',
  ventas: 'Ventas', cnc: 'Sector CNC', melamina: 'Sector Melamina',
  pino: 'Sector Pino', embalaje: 'Sector Embalaje',
  carpinteria: 'Carpintería', logistica: 'Logística', marketing: 'Marketing',
};

export function EquipoPage() {
  const toast = useToast();
  const { data: profileData } = useCurrentProfile();
  const { data: profiles = [] } = useProfiles();
  const toggleActive = useToggleProfileActive();

  const [filter, setFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('todos');
  const [editing, setEditing] = useState<{ open: boolean; user: Profile | null }>({ open: false, user: null });
  const [confirmToggle, setConfirmToggle] = useState<Profile | null>(null);

  const role = profileData?.profile?.role;
  const canWrite = role === 'owner' || role === 'admin';

  const filtered = profiles.filter(u => {
    if (roleFilter !== 'todos' && u.role !== roleFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      if (
        !u.name.toLowerCase().includes(q)
        && !u.username.toLowerCase().includes(q)
        && !(u.area ?? '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const onToggle = async (u: Profile) => {
    try {
      await toggleActive.mutateAsync({ id: u.id, active: !u.active });
      toast.info(`${u.name} ${u.active ? 'desactivado' : 'reactivado'}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Equipo</div>
          <div className="page-sub">
            {profiles.filter(u => u.active).length} activos · {profiles.length} en total
          </div>
        </div>
        {canWrite && (
          <button className="btn-primary" onClick={() => setEditing({ open: true, user: null })}>
            <Icon n="plus" s={13}/> Invitar usuario
          </button>
        )}
      </div>

      <div className="filter-bar">
        <div>
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input
            className="filter-input"
            placeholder="Buscar nombre, usuario o área..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{paddingLeft: 30, minWidth: 240}}
          />
        </div>
        <select className="filter-select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="todos">Todos los roles</option>
          {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12}}>
        {filtered.map(u => {
          const c = ROLE_COLOR[u.role] ?? '#888';
          const initials = u.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
          return (
            <div
              key={u.id}
              className="card"
              style={{padding: 18, display: 'flex', gap: 14, alignItems: 'center', opacity: u.active ? 1 : 0.55}}
            >
              <div style={{
                width: 44, height: 44,
                background: u.avatar_color ?? c,
                color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 800, borderRadius: 6, flexShrink: 0,
              }}>{initials}</div>
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                  <div style={{fontSize: 14, fontWeight: 700}}>{u.name}</div>
                  {!u.active && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                      background: 'var(--paper-dim)', color: 'var(--ink-muted)',
                      textTransform: 'uppercase',
                    }}>Inactivo</span>
                  )}
                </div>
                <div style={{fontSize: 11, color: 'var(--ink-muted)', fontFamily: 'var(--mono)'}}>
                  @{u.username}{u.area ? ' · ' + u.area : ''}
                </div>
                <div style={{
                  marginTop: 6,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em',
                  padding: '2px 8px', borderRadius: 10,
                  background: `${c}1a`, color: c,
                }}>
                  {ROLE_LABEL[u.role] ?? u.role}
                </div>
              </div>
              {canWrite && (
                <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                  <button
                    className="btn-ghost"
                    style={{padding: '4px 8px', fontSize: 10}}
                    onClick={() => setEditing({ open: true, user: u })}
                    title="Editar"
                  >
                    <Icon n="edit" s={11}/>
                  </button>
                  <button
                    className="btn-ghost"
                    style={{padding: '4px 8px', fontSize: 10}}
                    onClick={() => setConfirmToggle(u)}
                    title={u.active ? 'Desactivar' : 'Reactivar'}
                  >
                    <Icon n={u.active ? 'x' : 'check'} s={11}/>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!canWrite && (
        <div style={{
          marginTop: 16, padding: 14, background: 'var(--paper-off)',
          border: '1px dashed var(--border-md)', borderRadius: 6,
          fontSize: 11, color: 'var(--ink-soft)',
        }}>
          <Icon n="info" s={12}/> Solo owner / admin pueden invitar o editar usuarios. Estás en modo lectura.
        </div>
      )}

      <UsuarioEditModal
        open={editing.open}
        editing={editing.user}
        onClose={() => setEditing({ open: false, user: null })}
      />
      <ConfirmModal
        open={!!confirmToggle}
        title={confirmToggle?.active ? `Desactivar ${confirmToggle.name}` : `Reactivar ${confirmToggle?.name ?? ''}`}
        message={confirmToggle?.active
          ? `${confirmToggle.name} ya no podrá ingresar al sistema. Acción reversible.`
          : `Reactivar ${confirmToggle?.name ?? ''} — vuelve a tener acceso.`}
        confirmText={confirmToggle?.active ? 'Desactivar' : 'Reactivar'}
        danger={confirmToggle?.active}
        onConfirm={() => confirmToggle && onToggle(confirmToggle)}
        onClose={() => setConfirmToggle(null)}
      />
    </div>
  );
}
