import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Icon } from '@/components/shared/Icon';
import { Logo } from '@/components/shared/Logo';
import { useLogin, useSession } from '@/hooks/useAuth';

export function LoginScreen() {
  const [user, setUser] = useState('');
  const [pwd, setPwd] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');

  const { user: currentUser } = useSession();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();

  // Si ya hay sesión, redirigir a la home (no mostramos login)
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
    <div className="login-screen">
      <div className="lg-grid"/>
      <div className="lg-dots"/>
      <div className="lg-scan"/>
      <div className="lg-corner tl"/>
      <div className="lg-corner tr"/>
      <div className="lg-corner bl"/>
      <div className="lg-corner br"/>

      <div className="login-card">
        <span className="lcc tl"/>
        <span className="lcc tr"/>
        <span className="lcc bl"/>
        <span className="lcc br"/>

        <div style={{display:'flex', justifyContent:'center', marginBottom:28}}>
          <Logo size="lg" />
        </div>

        <div className="login-tag">
          <div className="login-tag-line"/>
          <div className="login-tag-label">Acceso al Sistema</div>
          <div className="login-tag-line"/>
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
                style={{paddingRight: 40}}
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                style={{
                  position:'absolute', right:6, top:'50%', transform:'translateY(-50%)',
                  background:'none', border:'none', cursor:'pointer', padding:8,
                  color:'var(--ink-muted)', display:'flex',
                }}
                tabIndex={-1}
                aria-label={show ? 'Ocultar' : 'Mostrar'}
              >
                <Icon n={show ? 'eye-off' : 'eye'} s={14}/>
              </button>
            </div>
          </div>

          {err && (
            <div style={{
              padding:'10px 12px', background:'var(--red-bg)',
              border:'1px solid rgba(220,38,38,.28)', color:'var(--red)',
              fontSize:12, fontWeight:600, marginBottom:14, borderRadius:4,
              display:'flex', gap:8, alignItems:'center',
            }}>
              <Icon n="alert" s={14}/> {err}
            </div>
          )}

          <button type="submit" className="login-btn" disabled={login.isPending}>
            {login.isPending
              ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/>
              : 'Ingresar al Sistema'}
          </button>
        </form>

        <div style={{
          marginTop: 22, display:'flex', justifyContent:'space-between', alignItems:'center',
          fontSize:10, color:'var(--ink-faint)', fontWeight:600,
          letterSpacing:'.08em', textTransform:'uppercase',
        }}>
          <span>v 0.1.0</span>
          <span style={{display:'flex', alignItems:'center', gap:5}}>
            <span style={{
              width:6, height:6, borderRadius:'50%',
              background:'var(--green)', display:'inline-block',
            }}/>
            Sistema operativo
          </span>
        </div>
      </div>
    </div>
  );
}
