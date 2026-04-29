/* ══ LOGIN SCREEN ══ */

function LoginScreen({ onLogin }) {
  const [user, setUser] = useState('sebastian');
  const [pwd, setPwd] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [focus, setFocus] = useState(null);

  function submit(e) {
    e?.preventDefault?.();
    if (!user.trim() || !pwd.trim()) { setErr('Ingresá usuario y contraseña.'); return; }
    setErr('');
    setLoading(true);
    /* match contra MOCK.users por username; si matchea, actualizar user activo */
    const match = window.MOCK.users.find(u => u.username.toLowerCase() === user.trim().toLowerCase());
    if (match) {
      window.MOCK.user = {
        ...window.MOCK.user,
        name: match.name,
        initials: match.name.split(' ').map(x => x[0]).join('').slice(0,2).toUpperCase(),
        role: match.role,
        roleLabel: window.MOCK.RL[match.role] || match.role,
        username: match.username,
      };
    }
    setTimeout(() => onLogin({ name: user, pwd }), 700);
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
              placeholder="sebastian"
              autoFocus
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
            {loading ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/> : 'Ingresar al Sistema'}
          </button>
        </form>

        <div style={{marginTop: 22, display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:10, color:'var(--ink-faint)', fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase'}}>
          <span>v 1.4.2</span>
          <span style={{display:'flex', alignItems:'center', gap:5}}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'var(--green)', display:'inline-block'}}/>
            Sistema operativo
          </span>
        </div>

        <div style={{marginTop:14, paddingTop:14, borderTop:'1px dashed var(--border)'}}>
          <div style={{fontSize:9, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:8, textAlign:'center'}}>Probar otro rol</div>
          <div style={{display:'flex', flexWrap:'wrap', gap:5, justifyContent:'center'}}>
            {['sebastian','miqueas','federico','max','gabriel','matias','flor'].map(u => (
              <button key={u} type="button" onClick={() => setUser(u)} style={{
                padding:'4px 9px', fontSize:10, fontWeight:600,
                background: user===u?'var(--ink)':'var(--paper-off)',
                color: user===u?'#fff':'var(--ink-soft)',
                border:'1px solid var(--border)', borderRadius:10, cursor:'pointer', textTransform:'capitalize'
              }}>{u}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.LoginScreen = LoginScreen;
