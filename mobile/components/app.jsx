/* ══ MOBILE APP ROOT ══ */

function App() {
  const M = window.useMockData();
  const [page, setPage] = useState('dashboard');
  const [didLanding, setDidLanding] = useState(false);

  const logged = !!(M.user && M.user.name);
  const unread = (M.notifications || []).filter(n => !n.leida).length;

  /* Landing por rol al loguear */
  useEffect(() => {
    if (logged && !didLanding) {
      const role = M.user.role;
      /* En mobile, los operarios aterrizan en SCAN; admin/owner en dashboard */
      const operarioRoles = ['cnc','melamina','pino','embalaje','logistica','encargado','carpinteria'];
      const landing = operarioRoles.includes(role) ? 'scan' : 'dashboard';
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

  /* Loader inicial */
  if (!M.bootstrapped) {
    return (
      <div style={{display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--paper)'}}>
        <span className="loader" style={{width:24, height:24}}/>
      </div>
    );
  }

  if (!logged) return (
    <ToastProvider><LoginScreen/></ToastProvider>
  );

  const renderPage = () => {
    if (page === 'dashboard')   return <DashboardPage onNav={setPage}/>;
    if (page === 'scan')        return <ScanPage onNav={setPage}/>;
    if (page === 'produccion')  return <ProduccionPage/>;
    if (page === 'notificaciones') return <NotificacionesPage/>;
    if (page === 'perfil')      return <PerfilPage onLogout={handleLogout}/>;
    if (['colecta','flex','tiendanube','distribuidor'].includes(page))
      return <CarrierPage channel={page} onBack={() => setPage('dashboard')}/>;
    return <DashboardPage onNav={setPage}/>;
  };

  return (
    <ToastProvider>
      <div className="m-app">
        <main className="m-main">
          {renderPage()}
        </main>
        <BottomBar current={page} onNav={setPage} unread={unread}/>
      </div>
    </ToastProvider>
  );
}

window.App = App;
