/* ══ LOGIN SCREEN — Supabase Auth real ══ */

function LoginScreen() {
  const [user, setUser]       = useState('');
  const [pwd, setPwd]         = useState('');
  const [show, setShow]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [focus, setFocus]     = useState(null);

  async function submit(e) {
    e?.preventDefault?.();
    if (!user.trim() || !pwd.trim()) { setErr('Ingresá usuario y contraseña.'); return; }
    setErr('');
    setLoading(true);
    try {
      await window.MOCK_ACTIONS.login({ username: user.trim(), password: pwd });
      // App detecta el cambio cuando MOCK_BUS emite (M.user.name pasa a tener valor).
    } catch (e) {
      setErr(e?.message || 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  }

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

        <div style={{display:'flex', justifyContent:'center', marginBottom: 28}}>
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
              className={`field-input ${focus==='u'?'focused':''}`}
              type="text"
              value={user}
              onChange={e => setUser(e.target.value)}
              onFocus={() => setFocus('u')}
              onBlur={() => setFocus(null)}
              placeholder="usuario o email"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="field-group">
            <label className="field-label">Contraseña</label>
            <div style={{position:'relative'}}>
              <input
                className={`field-input ${focus==='p'?'focused':''}`}
                type={show ? 'text' : 'password'}
                value={pwd}
                onChange={e => setPwd(e.target.value)}
                onFocus={() => setFocus('p')}
                onBlur={() => setFocus(null)}
                placeholder="••••••••"
                autoComplete="current-password"
                style={{paddingRight: 40}}
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                style={{position:'absolute', right:6, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', padding:8, color:'var(--ink-muted)', display:'flex'}}
                tabIndex={-1}
                aria-label={show ? 'Ocultar' : 'Mostrar'}
              >
                <Icon n={show?'eye-off':'eye'} s={14}/>
              </button>
            </div>
          </div>

          {err && (
            <div style={{padding:'10px 12px', background:'var(--red-bg)', border:'1px solid rgba(220,38,38,.28)', color:'var(--red)', fontSize:12, fontWeight:600, marginBottom:14, borderRadius:4, display:'flex', gap:8, alignItems:'center'}}>
              <Icon n="alert" s={14}/> {err}
            </div>
          )}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading
              ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/>
              : 'Ingresar al Sistema'}
          </button>
        </form>

        <div style={{marginTop: 22, display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:10, color:'var(--ink-faint)', fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase'}}>
          <span>v 1.0.0</span>
          <span style={{display:'flex', alignItems:'center', gap:5}}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'var(--green)', display:'inline-block'}}/>
            Sistema operativo
          </span>
        </div>
      </div>
    </div>
  );
}

window.LoginScreen = LoginScreen;
