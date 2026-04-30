import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Icon } from '@/components/shared/Icon';
import { Logo } from '@/components/shared/Logo';
import { useLogin, useSession } from '@macario/shared/hooks/useAuth';

export function LoginScreen() {
  const [user, setUser] = useState('');
  const [pwd, setPwd] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');

  const { user: currentUser } = useSession();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();

  // Si ya hay sesión, redirigir
  if (currentUser) {
    const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
    navigate(from, { replace: true });
    return null;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!user.trim() || !pwd) {
      setErr('Ingresá usuario y contraseña.');
      return;
    }
    try {
      await login.mutateAsync({ username: user, password: pwd });
      const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
      navigate(from, { replace: true });
    } catch (e) {
      setErr((e as Error).message ?? 'Error al iniciar sesión.');
    }
  };

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--paper)',
      padding: '24px 16px',
      position: 'relative',
    }}>
      {/* Decoración sutil de fondo */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0,0,0,0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,0,0,0.025) 1px, transparent 1px)
        `,
        backgroundSize: '36px 36px',
        pointerEvents: 'none',
      }}/>

      <div style={{
        width: '100%',
        maxWidth: 420,
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          marginBottom: 32,
        }}>
          <Logo size="lg"/>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 24,
          justifyContent: 'center',
        }}>
          <div style={{flex: 1, height: 1, background: 'var(--border-md)'}}/>
          <div style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--ink-muted)',
            whiteSpace: 'nowrap',
          }}>Acceso al Sistema</div>
          <div style={{flex: 1, height: 1, background: 'var(--border-md)'}}/>
        </div>

        <form onSubmit={submit}>
          <div className="field-group">
            <label className="field-label">Usuario</label>
            <input
              className="field-input"
              type="text"
              value={user}
              onChange={e => setUser(e.target.value)}
              placeholder="sebastian"
              autoFocus
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>

          <div className="field-group">
            <label className="field-label">Contraseña</label>
            <div style={{position:'relative'}}>
              <input
                className="field-input"
                type={show ? 'text' : 'password'}
                value={pwd}
                onChange={e => setPwd(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                style={{paddingRight: 44}}
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                style={{
                  position:'absolute', right: 6, top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: 10, color: 'var(--ink-muted)', display: 'flex',
                }}
                tabIndex={-1}
                aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                <Icon n={show ? 'eye-off' : 'eye'} s={16}/>
              </button>
            </div>
          </div>

          {err && (
            <div style={{
              padding: '12px 14px',
              background: 'var(--red-bg)',
              border: '1px solid rgba(220,38,38,.28)',
              color: 'var(--red)',
              fontSize: 12, fontWeight: 600,
              marginBottom: 14,
              borderRadius: 6,
              display: 'flex', gap: 8, alignItems: 'center',
            }}>
              <Icon n="alert" s={14}/> {err}
            </div>
          )}

          <button
            type="submit"
            className="login-btn"
            disabled={login.isPending}
            style={{minHeight: 50, fontSize: 13}}
          >
            {login.isPending
              ? <span className="loader" style={{borderColor: 'rgba(255,255,255,.3)', borderTopColor: '#fff'}}/>
              : 'Ingresar al Sistema'}
          </button>
        </form>

        <div style={{
          marginTop: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
          color: 'var(--ink-faint)',
          fontWeight: 600,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
        }}>
          <span>Mobile · v 0.1.0</span>
          <span style={{display: 'flex', alignItems: 'center', gap: 5}}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--green)', display: 'inline-block',
            }}/>
            Sistema operativo
          </span>
        </div>
      </div>
    </div>
  );
}
