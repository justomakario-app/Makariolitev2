/* ══ APP ROOT ══ */

function App() {
  const M = window.useMockData();
  const [page, setPage] = useState('dashboard');
  const [didLanding, setDidLanding] = useState(false);

  const logged = !!(M.user && M.user.name);
  const unread = (M.notifications || []).filter(n => !n.leida).length;

  /* Cuando se loguea, ir a la landing del rol (una sola vez) */
  useEffect(() => {
    if (logged && !didLanding) {
      const landing = M.ROLE_NAV[M.user.role]?.landing || 'dashboard';
      setPage(landing);
      setDidLanding(true);
    }
    if (!logged && didLanding) {
      setDidLanding(false);
      setPage('dashboard');
    }
  }, [logged, M.user.role, didLanding]);

  const handleLogout = async () => {
    try { await window.MOCK_ACTIONS.logout(); }
    catch (e) { console.error(e); }
  };

  /* Loader mientras termina el bootstrap inicial */
  if (!M.bootstrapped) {
    return (
      <div style={{display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--paper)'}}>
        <span className="loader" style={{width:24, height:24}}/>
      </div>
    );
  }

  /* registrar es un atajo a producción */
  const renderPage = () => {
    if (page === 'dashboard')   return <DashboardPage onNav={setPage}/>;
    if (['colecta','flex','tiendanube','distribuidor'].includes(page))
      return <CarrierPage channel={page} onBack={() => setPage('dashboard')} onNav={setPage}/>;
    if (page === 'produccion' || page === 'registrar') return <ProduccionPage/>;
    if (page === 'qr')             return <QRPage/>;
    if (page === 'historico')      return <HistoricoPage/>;
    if (page === 'catalogo')       return <CatalogoPage/>;
    if (page === 'equipo')         return <EquipoPage/>;
    if (page === 'notificaciones') return <NotificacionesPage/>;
    if (page === 'perfil' || page === 'config') return <ConfigPage/>;
    return <DashboardPage onNav={setPage}/>;
  };

  if (!logged) return (
    <ToastProvider>
      <LoginScreen/>
    </ToastProvider>
  );

  return (
    <ToastProvider>
      <div className="app-layout">
        <Sidebar current={page} onNav={setPage} onLogout={handleLogout} unread={unread}/>
        <main className="main-content">
          {renderPage()}
        </main>
      </div>
    </ToastProvider>
  );
}

window.App = App;
