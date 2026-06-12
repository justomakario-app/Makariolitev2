/* ══ LÍNEA PRODUCTIVA — primitivas UI compartidas ══════════════════════
   Helpers reutilizados por TODAS las pantallas de sector (CNC, Melamina,
   Pino, Embalaje). Cargar después de shared.jsx (usa useState/useEffect)
   y antes de los *-sector.jsx.
   ═══════════════════════════════════════════════════════════════════════ */

/* Reloj vivo para la topbar (HH:MM, refresco 30s). */
function LpClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return <span>{hh}:{mm}</span>;
}

/* Niveles de urgencia (Mantenimiento) — color por nivel. */
const LP_URGENCIAS = [
  { id:'alta',  label:'Alta',  color:'#F87171' },
  { id:'media', label:'Media', color:'#FBBF24' },
  { id:'baja',  label:'Baja',  color:'#34D399' },
];

/* Estilo del botón redondo de stepper (−/+), tematizado por sector (U = tokens). */
function lpStepBtn(U) {
  return { border:`1px solid ${U.border}`, background:U.surface2, color:U.ink, borderRadius:8,
           width:28, height:28, fontSize:17, fontWeight:700, cursor:'pointer', lineHeight:1 };
}
