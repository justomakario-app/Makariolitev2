/* ══ COMPROBANTE UPLOADER (S2.3)
   Drag-and-drop O click para subir comprobante (JPG/PNG/PDF, max 10MB)
   al bucket admin_receipts. Genera path determinista por expense_id si
   se conoce, sino path temporal con session-uuid.

   Storage layout:
     expenses/{expenseId}/comprobante.{ext}
     expenses/_pending/{sessionUuid}/comprobante.{ext}  (caso create)

   Props:
     - expenseId: uuid | null   (null en create antes de guardar)
     - initial: { url, mime, size_bytes } | null
     - disabled: boolean
     - onChange: ({ url, mime, size_bytes } | null) => void

   Limitacion S2.3: en mode='create', el archivo se sube ANTES de crear
   el expense. Si el usuario cancela, queda un archivo huerfano. Se
   acepta como trade-off por ahora — limpieza periodica en sprint
   hardening.
   ══ */

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

function extFromMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png')  return 'png';
  if (mime === 'application/pdf') return 'pdf';
  return 'bin';
}

function formatBytes(b) {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function ComprobanteUploader({ expenseId, initial, disabled, onChange }) {
  const toast = useToast();
  const [state, setState] = useState(() => {
    if (initial && initial.url) return { url: initial.url, mime: initial.mime || null, size_bytes: initial.size_bytes || null };
    return null;
  });
  const [uploading, setUploading] = useState(false);
  const [signedUrl, setSignedUrl] = useState(null);
  const [signedUrlLoading, setSignedUrlLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const fileInputRef = useRef(null);

  const isImage = state && state.mime && state.mime.startsWith('image/');
  const isPdf   = state && state.mime === 'application/pdf';

  /* Generar preview signed URL on demand (no en mount automatico para no
     gastar request si user no lo necesita). */
  const fetchPreview = async () => {
    if (!state || !state.url) return;
    setSignedUrlLoading(true);
    try {
      const url = await window.ADMIN_DATA.getComprobanteSignedUrl(state.url);
      setSignedUrl(url);
    } catch (err) {
      toast.error('No se pudo generar URL de preview: ' + (err.message || 'error'));
    } finally {
      setSignedUrlLoading(false);
    }
  };

  /* Para thumbnails de imagen, autocargamos signed URL al montar si hay state. */
  useEffect(() => {
    if (state && state.url && isImage && !signedUrl) {
      fetchPreview();
    }
    /* eslint-disable-next-line */
  }, [state]);

  const handleFile = async (file) => {
    if (!file) return;
    if (!ALLOWED_MIME.includes(file.type)) {
      toast.error(`Formato no permitido: ${file.type || 'desconocido'}. Solo JPG/PNG/PDF.`);
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      toast.error(`Archivo demasiado grande: ${formatBytes(file.size)}. Máximo 10MB.`);
      return;
    }
    setUploading(true);
    try {
      /* Capa 2 cleanup defensivo: si ya había un comprobante previo subido
         a _pending/ (mode='create' sin guardar todavía), borrar el anterior
         antes de subir el reemplazo. Evita que "subir foto → subir PDF →
         cancelar" deje 2 archivos huérfanos. */
      const prevPath = state && state.url;
      if (prevPath && prevPath.includes('/_pending/')) {
        try {
          await window.ADMIN_DATA.deleteComprobante(prevPath);
        } catch (e) {
          console.warn('No se pudo limpiar archivo previo:', e);
          // no bloquear el upload nuevo
        }
      }

      const folder = expenseId || `_pending/${(crypto?.randomUUID && crypto.randomUUID()) || Date.now()}`;
      const ext = extFromMime(file.type);
      const path = `expenses/${folder}/comprobante.${ext}`;
      const { error } = await window.SUPA.storage
        .from('admin_receipts')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw new Error(error.message || 'Upload fallo');

      const next = { url: path, mime: file.type, size_bytes: file.size };
      setState(next);
      setSignedUrl(null);
      onChange?.(next);
      toast.success('Comprobante subido');
    } catch (err) {
      toast.error(err.message || 'No se pudo subir');
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled || uploading) return;
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const onDragOver = (e) => { e.preventDefault(); if (!disabled) setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const openFilePicker = () => {
    if (disabled || uploading) return;
    fileInputRef.current?.click();
  };

  const onFileInput = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
    e.target.value = ''; // permite re-seleccionar mismo archivo
  };

  /* Click "Eliminar" → abre ConfirmModal estilizado (consistencia con
     resto del modulo Admin, en lugar del window.confirm nativo). */
  const handleDelete = () => {
    if (!state || !state.url) return;
    if (disabled || uploading) return;
    setConfirmDeleteOpen(true);
  };

  /* onConfirm del ConfirmModal → ejecuta el borrado real. */
  const doDelete = async () => {
    if (!state || !state.url) return;
    setUploading(true);
    try {
      await window.ADMIN_DATA.deleteComprobante(state.url);
      setState(null);
      setSignedUrl(null);
      onChange?.(null);
      toast.success('Comprobante eliminado');
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    } finally {
      setUploading(false);
    }
  };

  const openInNewTab = async () => {
    let url = signedUrl;
    if (!url) {
      try {
        url = await window.ADMIN_DATA.getComprobanteSignedUrl(state.url);
        setSignedUrl(url);
      } catch (err) {
        toast.error('No se pudo abrir');
        return;
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  /* Sin comprobante → dropzone */
  if (!state) {
    return (
      <div className={`comprobante-dropzone ${dragOver ? 'is-dragover' : ''} ${disabled ? 'is-disabled' : ''}`}
           onDrop={onDrop}
           onDragOver={onDragOver}
           onDragLeave={onDragLeave}
           onClick={openFilePicker}>
        <input ref={fileInputRef}
               type="file"
               accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
               style={{display:'none'}}
               onChange={onFileInput}/>
        <Icon n="upload" s={28} c="var(--ink-muted)"/>
        <div className="comprobante-dropzone-title">
          {uploading ? 'Subiendo…' : 'Arrastrá un archivo aquí o hacé click'}
        </div>
        <div className="comprobante-dropzone-help">
          JPG · PNG · PDF · Máx 10MB
        </div>
      </div>
    );
  }

  /* Con comprobante → preview + acciones */
  return (
    <React.Fragment>
      <div className="comprobante-preview">
        <div className="comprobante-preview-thumb">
          {isImage && signedUrl
            ? <img src={signedUrl} alt="comprobante" className="comprobante-thumb-img"/>
            : isImage && signedUrlLoading
              ? <span className="loader" style={{width:18, height:18}}/>
              : isPdf
                ? <Icon n="layers" s={36} c="var(--ink-soft)"/>
                : <Icon n="package" s={36} c="var(--ink-soft)"/>}
        </div>
        <div className="comprobante-preview-info">
          <div className="comprobante-preview-name">{state.url.split('/').pop()}</div>
          <div className="comprobante-preview-meta">
            {state.mime || '—'} · {formatBytes(state.size_bytes)}
          </div>
          <div className="comprobante-preview-actions">
            <button type="button" className="btn-ghost-sm" onClick={openInNewTab} disabled={uploading}>
              <Icon n="eye" s={12}/> Ver
            </button>
            <button type="button" className="btn-ghost-sm danger" onClick={handleDelete} disabled={disabled || uploading}>
              <Icon n="trash" s={12}/> Eliminar
            </button>
          </div>
        </div>
      </div>
      {confirmDeleteOpen && window.ConfirmModal && (
        <window.ConfirmModal
          open={true}
          title="Eliminar comprobante"
          message="¿Eliminar el comprobante subido? Esta acción no se puede deshacer."
          confirmText="Eliminar"
          danger
          onClose={() => setConfirmDeleteOpen(false)}
          onConfirm={doDelete}/>
      )}
    </React.Fragment>
  );
}

window.ComprobanteUploader = ComprobanteUploader;
