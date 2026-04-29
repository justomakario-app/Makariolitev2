/* ══ APP ROOT ══ */

function App() {
  const [logged, setLogged] = useState(true);
  const [page, setPage] = useState('dashboard');

  const M = window.useMockData();
  const unread = M.notifications.filter(n => !n.leida).length;

  const handleLogin = () => {
    setLogged(true);
    /* landing por rol */
    const landing = M.ROLE_NAV[M.user.role]?.landing || 'dashboard';
    setPage(landing);
  };
  const handleLogout = () => { setLogged(false); setPage('dashboard'); };

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
      <LoginScreen onLogin={handleLogin}/>
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
