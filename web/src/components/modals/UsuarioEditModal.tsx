import { useState } from 'react';
import { Modal } from '@/components/shared/Modal';
import { Icon } from '@/components/shared/Icon';
import { useToast } from '@/components/shared/Toast';
import { useInviteUser, useUpdateProfile } from '@macario/shared/hooks/useTeam';
import type { Database } from '@macario/shared/types/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];
type RoleEnum = Database['public']['Enums']['role_enum'];

const ROLE_OPTIONS: { value: RoleEnum; label: string }[] = [
  { value: 'owner', label: 'Propietario' },
  { value: 'admin', label: 'Administración' },
  { value: 'encargado', label: 'Encargado General' },
  { value: 'ventas', label: 'Ventas' },
  { value: 'cnc', label: 'Sector CNC' },
  { value: 'melamina', label: 'Sector Melamina' },
  { value: 'pino', label: 'Sector Pino' },
  { value: 'embalaje', label: 'Sector Embalaje' },
  { value: 'carpinteria', label: 'Carpintería' },
  { value: 'logistica', label: 'Logística' },
  { value: 'marketing', label: 'Marketing' },
];

function genTempPassword(): string {
  const adjs = ['Pino', 'Roble', 'Mesa', 'Banco', 'Cubo', 'Tabla', 'Hoja', 'Nube'];
  const num = Math.floor(100 + Math.random() * 900);
  return adjs[Math.floor(Math.random() * adjs.length)] + num + '!';
}

interface Props {
  open: boolean;
  /** Si null = modo invitar. Si Profile = modo editar. */
  editing: Profile | null;
  onClose: () => void;
}

export function UsuarioEditModal({ open, editing, onClose }: Props) {
  const isNew = !editing;
  const toast = useToast();
  const invite = useInviteUser();
  const update = useUpdateProfile();

  const [name, setName] = useState(editing?.name ?? '');
  const [username, setUsername] = useState(editing?.username ?? '');
  const [role, setRole] = useState<RoleEnum>((editing?.role as RoleEnum) ?? 'embalaje');
  const [area, setArea] = useState(editing?.area ?? '');

  // Solo en modo invitar
  const [pwMode, setPwMode] = useState<'auto' | 'manual'>('auto');
  const [password, setPassword] = useState(isNew ? genTempPassword() : '');
  const [pwVisible, setPwVisible] = useState(true);

  const regen = () => setPassword(genTempPassword());

  const copy = (txt: string) => {
    if (navigator.clipboard) navigator.clipboard.writeText(txt);
    toast.success('Copiado al portapapeles');
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Falta el nombre');
      return;
    }
    if (!username.trim()) {
      toast.error('Falta el nombre de usuario');
      return;
    }
    const cleanUsername = username.trim().toLowerCase().replace(/\s+/g, '');

    if (isNew) {
      if (password.length < 6) {
        toast.error('La contraseña debe tener al menos 6 caracteres');
        return;
      }
      try {
        const result = await invite.mutateAsync({
          username: cleanUsername,
          name: name.trim(),
          role,
          area: area.trim() || null,
          password,
        });
        toast.success(`${result.name} agregado al equipo · password: ${password}`);
        onClose();
      } catch (e) {
        toast.error((e as Error).message);
      }
    } else {
      try {
        await update.mutateAsync({
          id: editing!.id,
          data: {
            name: name.trim(),
            role,
            area: area.trim() || null,
          },
        });
        toast.success(`${name.trim()} actualizado`);
        onClose();
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  };

  const busy = invite.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? 'Invitar usuario' : `Editar @${editing!.username}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy
              ? <span className="loader" style={{borderColor: 'rgba(255,255,255,.3)', borderTopColor: '#fff'}}/>
              : <><Icon n="check" s={14}/> {isNew ? 'Invitar' : 'Guardar'}</>}
          </button>
        </>
      }
    >
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12}}>
        <div>
          <label className="field-label">Nombre completo</label>
          <input
            className="field-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ej: Juan Pérez"
          />
        </div>
        <div>
          <label className="field-label">Usuario</label>
          <input
            className="field-input"
            value={username}
            onChange={e => setUsername(e.target.value)}
            disabled={!isNew}
            placeholder="juan"
            style={{fontFamily: 'var(--mono)'}}
          />
          {!isNew && <div style={{fontSize: 10, color: 'var(--ink-muted)', marginTop: 4}}>El usuario no se puede cambiar.</div>}
          {isNew && <div style={{fontSize: 10, color: 'var(--ink-muted)', marginTop: 4}}>Solo letras minúsculas, números y `_`. 3-32 chars.</div>}
        </div>
      </div>

      <div style={{marginTop: 14}}>
        <label className="field-label">Rol</label>
        <select className="field-input" value={role} onChange={e => setRole(e.target.value as RoleEnum)}>
          {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <div style={{fontSize: 10, color: 'var(--ink-muted)', marginTop: 4}}>
          El rol determina qué secciones ve este usuario al iniciar sesión.
        </div>
      </div>

      <div style={{marginTop: 14}}>
        <label className="field-label">Área / Sector (opcional)</label>
        <input
          className="field-input"
          value={area}
          onChange={e => setArea(e.target.value)}
          placeholder="Ej: Producción, Embalaje, Logística..."
        />
      </div>

      {/* Contraseña — solo en alta */}
      {isNew && (
        <div style={{marginTop: 18, padding: 14, background: 'var(--paper-off)', border: '1px solid var(--border)', borderRadius: 6}}>
          <div style={{fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-muted)', marginBottom: 10}}>
            Contraseña inicial
          </div>

          <div style={{display: 'flex', gap: 6, marginBottom: 10}}>
            <button
              type="button"
              onClick={() => setPwMode('auto')}
              style={{
                flex: 1, padding: '8px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: pwMode === 'auto' ? 'var(--ink)' : 'var(--paper)',
                color: pwMode === 'auto' ? '#fff' : 'var(--ink-soft)',
                border: '1px solid var(--border)', borderRadius: 4,
              }}
            >Generar automática</button>
            <button
              type="button"
              onClick={() => { setPwMode('manual'); setPassword(''); }}
              style={{
                flex: 1, padding: '8px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: pwMode === 'manual' ? 'var(--ink)' : 'var(--paper)',
                color: pwMode === 'manual' ? '#fff' : 'var(--ink-soft)',
                border: '1px solid var(--border)', borderRadius: 4,
              }}
            >Definir manual</button>
          </div>

          <div style={{display: 'flex', gap: 6}}>
            <div style={{flex: 1, position: 'relative'}}>
              <input
                className="field-input"
                type={pwVisible ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={pwMode === 'manual' ? 'Mínimo 6 caracteres' : ''}
                style={{fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, paddingRight: 36}}
                readOnly={pwMode === 'auto'}
              />
              <button
                type="button"
                onClick={() => setPwVisible(v => !v)}
                style={{position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', padding: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)'}}
                title={pwVisible ? 'Ocultar' : 'Mostrar'}
              >
                <Icon n={pwVisible ? 'eye-off' : 'eye'} s={14}/>
              </button>
            </div>
            {pwMode === 'auto' && (
              <button type="button" className="btn-ghost" onClick={regen} style={{padding: '8px 12px'}} title="Regenerar">
                <Icon n="refresh" s={14}/>
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={() => copy(password)} style={{padding: '8px 12px'}} title="Copiar" disabled={!password}>
              <Icon n="copy" s={14}/>
            </button>
          </div>

          <div style={{marginTop: 10, fontSize: 10, color: 'var(--ink-muted)', lineHeight: 1.6}}>
            {pwMode === 'auto'
              ? 'Se generó una contraseña fácil de recordar. Compartila con el usuario por WhatsApp o en persona — la podrá cambiar al ingresar.'
              : 'Definí una contraseña simple. El usuario la podrá cambiar después desde su perfil.'}
          </div>
        </div>
      )}

      {/* Reset password (modo edición) */}
      {!isNew && (
        <div style={{marginTop: 18, padding: 14, background: 'var(--paper-off)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.6}}>
          <Icon n="info" s={12}/>{' '}
          Para resetear la contraseña, andá a Supabase Dashboard → Authentication → Users → buscar @{editing!.username} → "Reset password".
        </div>
      )}
    </Modal>
  );
}
