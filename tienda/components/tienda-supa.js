/* ══ TIENDA · CLIENTE SUPABASE ════════════════════════════════════════════
   La tienda tiene su PROPIO cliente, separado del de components/data.js.

   ⚠ El motivo no es de estilo. La app interna (/) y la tienda (/tienda/) son
   el MISMO origen para el navegador, así que comparten localStorage. Si las
   dos guardaran la sesión bajo la misma clave, un mayorista que entra a la
   tienda desde la computadora del depósito le pisaría la sesión al empleado
   que estaba en el sistema en esa misma máquina — y al revés. Por eso acá va
   una storageKey distinta: las dos sesiones conviven sin tocarse.

   La anon key es pública por diseño (viaja en cualquier request del browser);
   lo que protege los datos es RLS, no esconderla. Es la misma que usa el
   sistema interno: mismo proyecto Supabase, mismos endpoints.

   Este archivo se carga ANTES que b2b-data.js. b2b-data.js resuelve
   window.SUPA en cada llamada (lazy) y no lo captura al cargar, así que el
   orden alcanza; igual conviene no invertirlo.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  var SUPABASE_URL      = 'https://ditmbqkvzreekqnkimqv.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdG1icWt2enJlZWtxbmtpbXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTAyMDMsImV4cCI6MjA5MzA2NjIwM30.2hVZ3bJS_1vBe0rrR5BkYmg6-Fk5KHWwrLwG9gdaJE0';

  if (!window.supabase || !window.supabase.createClient) {
    /* Sin el UMD de supabase-js no hay nada que hacer: mejor decirlo fuerte
       en la consola que fallar después con un "undefined is not a function"
       adentro de la primera RPC. */
    console.error('[tienda] supabase-js no cargó. Revisá el <script> del CDN.');
    return;
  }

  window.SUPA = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'makario-tienda-auth',   // ← distinta de 'macario-auth' a propósito
      detectSessionInUrl: false,           // la tienda no usa magic links ni OAuth
    },
  });

  window.TIENDA_SUPABASE_URL = SUPABASE_URL;
})();
