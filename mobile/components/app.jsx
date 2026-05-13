/* ══ MOBILE APP ROOT ══ */

function App() {
  const M = window.useMockData();
  const [page, setPage] = useState('dashboard');
  const [didLanding, setDidLanding] = useState(false);
  // Singleton global del modal de SKU (paridad con web). Permite que el
  // carrito de carga manual abra el modal de creacion de SKU al vuelo.
  const [skuModal, setSkuModal] = useState(null);

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
    if (['colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino'].includes(page))
      return <CarrierPage channel={page} onBack={() => setPage('dashboard')}/>;
    if (page === 'stock') {
      // Guard: stock solo para owner/admin/encargado. Operario que llegue
      // por URL hack o cache vuelve al dashboard sin warning.
      const role = (M.user.role || '').toLowerCase();
      if (!['owner','admin','encargado'].includes(role)) return <DashboardPage onNav={setPage}/>;
      return window.StockPage
        ? <window.StockPage onBack={() => setPage('dashboard')}/>
        : <DashboardPage onNav={setPage}/>;
    }
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
      {skuModal && <GlobalSkuModal modal={skuModal} onClose={() => setSkuModal(null)}/>}
    </ToastProvider>
  );
}

/* GlobalSkuModal — wrapper que renderiza ProductoEditModal con onSave
   del singleton. Vive dentro del ToastProvider para que useToast()
   funcione. NO interfiere con otros usos del modal porque mobile no
   tiene CatalogoPage hoy. */
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

  if (!window.ProductoEditModal) return null;
  const Cmp = window.ProductoEditModal;
  return (
    <Cmp editing={modal} onClose={onClose} onSave={onSave} cats={cats}/>
  );
}

window.App = App;
