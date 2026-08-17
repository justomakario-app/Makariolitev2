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
  /* El total real, no el de las 50 cargadas: si no, el badge se satura y un
     pedido nuevo de la tienda no mueve el numero. Ver loadNotifications. */
  const unread = M.notificationsSinLeer || 0;

  /* Cuando se loguea, ir a la landing del rol (una sola vez) */
  useEffect(() => {
    if (logged && !didLanding) {
      let landing = M.ROLE_NAV[M.user.role]?.landing || 'dashboard';
      // S2.22: un admin permisionado aterriza en su primer módulo permitido
      // (no en dashboard, que puede no estar entre sus módulos).
      if (window.isPermissionedAdmin && window.isPermissionedAdmin()) {
        landing = window.firstAllowedNav ? window.firstAllowedNav() : landing;
      }
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
    // S2.22 "reemplazo total": si es admin permisionado y la página pedida
    // NO está entre sus módulos, lo redirigimos a su primer módulo permitido
    // (en vez de mostrar el dashboard, que puede no estar permitido).
    let p = page;
    if (window.isPermissionedAdmin && window.isPermissionedAdmin() && !window.canSeeNav(p)) {
      p = window.firstAllowedNav ? window.firstAllowedNav() : 'perfil';
    }
    const canSee = (id) => (window.canSeeNav ? window.canSeeNav(id) : true);

    if (p === 'dashboard')   return <DashboardPage onNav={setPage}/>;
    if (['colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino'].includes(p))
      return <CarrierPage channel={p} onBack={() => setPage('dashboard')} onNav={setPage}/>;
    if (p === 'stock') {
      // Guard: stock solo para owner/admin/encargado. Operario que llegue
      // por URL hack o cache vuelve al dashboard sin warning.
      const role = (M.user.role || '').toLowerCase();
      if (!['owner','admin','encargado'].includes(role)) return <DashboardPage onNav={setPage}/>;
      return window.StockPage
        ? <window.StockPage onBack={() => setPage('dashboard')}/>
        : <DashboardPage onNav={setPage}/>;
    }
    if (p === 'produccion-hub')
      return window.ProduccionHubPage ? <window.ProduccionHubPage/> : <ProduccionPage/>;
    if (p === 'registrar') return <ProduccionPage/>;
    /* Compat: 'produccion' redirige al hub (bookmarks viejos + landing S2.22). */
    if (p === 'produccion') return window.ProduccionHubPage ? <window.ProduccionHubPage/> : <ProduccionPage/>;
    if (p === 'qr')             return <QRPage/>;
    if (p === 'historico')      return <HistoricoPage/>;
    if (p === 'catalogo')       return <CatalogoPage/>;
    if (p === 'equipo')         return <EquipoPage/>;
    if (p === 'administracion') {
      // S2.21: Administración. Owner + admin (gated por FEATURE_ADMIN).
      // S2.22: además, admin permisionado requiere el módulo 'administracion'.
      if (!window.FEATURE_ADMIN || !canSee('administracion')) return <DashboardPage onNav={setPage}/>;
      return window.AdministracionPage ? <window.AdministracionPage/> : <DashboardPage onNav={setPage}/>;
    }
    if (p === 'finanzas') {
      // Owner siempre; admin solo con módulo 'finanzas'/'finanzas_egresos'.
      if (!canSee('finanzas')) return <DashboardPage onNav={setPage}/>;
      return window.FinanzasPage ? <window.FinanzasPage/> : <DashboardPage onNav={setPage}/>;
    }
    if (p === 'rrhh') {
      // SOLO owner (ningún módulo de permisos mapea a rrhh).
      if (!canSee('rrhh')) return <DashboardPage onNav={setPage}/>;
      return window.RrhhPage ? <window.RrhhPage/> : <DashboardPage onNav={setPage}/>;
    }
    if (p === 'ventas') {
      // Owner siempre; admin solo con módulo 'ventas'.
      if (!canSee('ventas')) return <DashboardPage onNav={setPage}/>;
      return window.VentasPage ? <window.VentasPage/> : <DashboardPage onNav={setPage}/>;
    }
    if (p === 'marketing') {
      // Owner siempre; admin solo con módulo 'marketing'.
      if (!canSee('marketing')) return <DashboardPage onNav={setPage}/>;
      return window.MarketingPage ? <window.MarketingPage/> : <DashboardPage onNav={setPage}/>;
    }
    /* Compat: rutas legacy 'admin', 'cash-flow' y 'contabilidad' redirigen a nuevos contenedores. */
    if (p === 'admin')        return window.AdministracionPage ? <window.AdministracionPage/> : <DashboardPage onNav={setPage}/>;
    if (p === 'cash-flow')    return window.FinanzasPage ? <window.FinanzasPage/> : <DashboardPage onNav={setPage}/>;
    if (p === 'contabilidad') return window.FinanzasPage ? <window.FinanzasPage/> : <DashboardPage onNav={setPage}/>;
    /* onNav acá es setPage pelado a propósito: la pantalla de notificaciones
       deja su "intención" en window.NAV_INTENT justo antes de navegar (a qué
       pestaña de Ventas ir, con qué pedido buscado) y limpiarla en el camino
       la rompería. La limpian VentasPage al montar y el Sidebar al navegar. */
    if (p === 'notificaciones') return <NotificacionesPage onNav={setPage}/>;
    if (p === 'perfil' || p === 'config') return <ConfigPage/>;
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
        {/* Navegar desde el menú borra cualquier intención pendiente: si no,
            entrar a Ventas por el menú podría caer en la pestaña del último
            aviso que se abrió. */}
        <Sidebar current={page} onNav={(p) => { window.NAV_INTENT = null; setPage(p); }}
                 onLogout={handleLogout} unread={unread}/>
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
