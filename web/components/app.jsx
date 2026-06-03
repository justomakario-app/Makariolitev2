/* ══ APP ROOT ══ */

function App() {
  const M = window.useMockData();
  const [page, setPage] = useState('dashboard');
  const [didLanding, setDidLanding] = useState(false);
  // Singleton global del modal de SKU para invocarlo desde cualquier
  // pantalla (ej: carrito de carga manual cuando el admin escribe un
  // SKU inexistente). CatalogoPage sigue usando ProductoEditModal con
  // su state local — los dos coexisten sin conflicto.
  const [skuModal, setSkuModal] = useState(null);

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

  /* Exponer/quitar el opener global del modal de SKU.
     opts: { newSku?: string, incompleto?: bool, onCreated?: (sku) => void } */
  useEffect(() => {
    window.openProductoEditModal = (opts = {}) => {
      setSkuModal({
        sku: (opts.newSku || '').toUpperCase(),
        isNew: true,
        incompleto: !!opts.incompleto,
        onCreated: opts.onCreated,
      });
    };
    return () => { try { delete window.openProductoEditModal; } catch (_) {} };
  }, []);

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
    if (['colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino'].includes(page))
      return <CarrierPage channel={page} onBack={() => setPage('dashboard')} onNav={setPage}/>;
    if (page === 'stock') {
      // Guard: stock solo para owner/admin/encargado. Operario que llegue
      // por URL hack o cache vuelve al dashboard sin warning.
      const role = (M.user.role || '').toLowerCase();
      if (!['owner','admin','encargado'].includes(role)) return <DashboardPage onNav={setPage}/>;
      return window.StockPage
        ? <window.StockPage onBack={() => setPage('dashboard')}/>
        : <DashboardPage onNav={setPage}/>;
    }
    if (page === 'produccion-hub')
      return window.ProduccionHubPage ? <window.ProduccionHubPage/> : <ProduccionPage/>;
    if (page === 'registrar') return <ProduccionPage/>;
    /* Compat: 'produccion' y 'stock' redirigen al hub (bookmarks viejos). */
    if (page === 'produccion') return window.ProduccionHubPage ? <window.ProduccionHubPage/> : <ProduccionPage/>;
    if (page === 'stock') {
      const role = (M.user.role || '').toLowerCase();
      if (!['owner','admin','encargado'].includes(role)) return <DashboardPage onNav={setPage}/>;
      return window.ProduccionHubPage ? <window.ProduccionHubPage/> : <DashboardPage onNav={setPage}/>;
    }
    if (page === 'qr')             return <QRPage/>;
    if (page === 'historico')      return <HistoricoPage/>;
    if (page === 'catalogo')       return <CatalogoPage/>;
    if (page === 'equipo')         return <EquipoPage/>;
    if (page === 'administracion') {
      // S2.21: Administración (proveedores + clientes + cuentas corrientes).
      // Owner + admin acceden, gated por FEATURE_ADMIN. Otros → fallback.
      const role = (M.user.role || '').toLowerCase();
      if (!window.FEATURE_ADMIN || !['owner','admin'].includes(role)) return <DashboardPage onNav={setPage}/>;
      return window.AdministracionPage ? <window.AdministracionPage/> : <DashboardPage onNav={setPage}/>;
    }
    if (page === 'finanzas') {
      // S2.21b: Finanzas (cash flow + plan cuentas + egresos + cheques). SOLO owner.
      const role = (M.user.role || '').toLowerCase();
      if (!['owner'].includes(role)) return <DashboardPage onNav={setPage}/>;
      return window.FinanzasPage ? <window.FinanzasPage/> : <DashboardPage onNav={setPage}/>;
    }
    if (page === 'rrhh') {
      // S2.21: Recursos Humanos. SOLO owner.
      const role = (M.user.role || '').toLowerCase();
      if (!['owner'].includes(role)) return <DashboardPage onNav={setPage}/>;
      return window.RrhhPage ? <window.RrhhPage/> : <DashboardPage onNav={setPage}/>;
    }
    if (page === 'ventas') {
      // S2.21b: Ventas. SOLO owner.
      const role = (M.user.role || '').toLowerCase();
      if (!['owner'].includes(role)) return <DashboardPage onNav={setPage}/>;
      return window.VentasPage ? <window.VentasPage/> : <DashboardPage onNav={setPage}/>;
    }
    if (page === 'marketing') {
      // S2.21b: Marketing. SOLO owner.
      const role = (M.user.role || '').toLowerCase();
      if (!['owner'].includes(role)) return <DashboardPage onNav={setPage}/>;
      return window.MarketingPage ? <window.MarketingPage/> : <DashboardPage onNav={setPage}/>;
    }
    /* Compat: rutas legacy 'admin', 'cash-flow' y 'contabilidad' redirigen a nuevos contenedores. */
    if (page === 'admin')        return window.AdministracionPage ? <window.AdministracionPage/> : <DashboardPage onNav={setPage}/>;
    if (page === 'cash-flow')    return window.FinanzasPage ? <window.FinanzasPage/> : <DashboardPage onNav={setPage}/>;
    if (page === 'contabilidad') return window.FinanzasPage ? <window.FinanzasPage/> : <DashboardPage onNav={setPage}/>;
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
      {skuModal && <GlobalSkuModal modal={skuModal} onClose={() => setSkuModal(null)}/>}
    </ToastProvider>
  );
}

/* GlobalSkuModal — wrapper que renderiza ProductoEditModal con el
   onSave del singleton. Vive dentro del ToastProvider para que
   useToast() funcione. NO reemplaza al modal local de CatalogoPage —
   son dos instancias independientes. */
function GlobalSkuModal({ modal, onClose }) {
  const toast = useToast();
  const M = window.useMockData();
  // cats: lista de la maestra sku_categories (incluye sin SKUs).
  // Fallback al cálculo viejo si MOCK.categories no está cargado.
  const cats = (M.categories && M.categories.length > 0)
    ? M.categories
    : [...new Set(Object.values(window.SKU_DB || {}).map(s => s.categoria).filter(Boolean))];

  const onSave = async (sku, data, isNew) => {
    if (isNew && window.SKU_DB[sku]) {
      toast.error(`SKU ${sku} ya existe`);
      return false;
    }
    try {
      const payload = {
        modelo: data.modelo,
        color: data.color === '—' ? null : data.color,
        color_hex: data.colorHex || null,
        categoria: data.categoria,
        es_fabricado: data.es_fabricado,
        activo: data.activo,
        incompleto: data.incompleto || false,
      };
      await window.MOCK_ACTIONS.crearOActualizarSku(sku, payload, isNew);
      toast.success(`SKU ${sku} creado${data.incompleto ? ' (incompleto)' : ''}`);
      try { modal.onCreated?.(sku); } catch (_) {}
      onClose();
      return true;
    } catch (e) {
      toast.error(e.message || 'No se pudo guardar el SKU');
      return false;
    }
  };

  // window.ProductoEditModal es el componente exportado desde pages.jsx.
  // Usamos referencia explícita a window para no depender del orden de
  // declaración de los archivos jsx.
  if (!window.ProductoEditModal) return null;
  const Cmp = window.ProductoEditModal;
  return (
    <Cmp
      editing={modal}
      onClose={onClose}
      onSave={onSave}
      cats={cats}
    />
  );
}

window.App = App;
