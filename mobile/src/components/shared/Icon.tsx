/* Port de mock.js Icon — todos los íconos usados por la app. */

type IconName =
  | 'home' | 'truck' | 'box' | 'layers' | 'package' | 'qr' | 'tag' | 'tools'
  | 'history' | 'users' | 'settings' | 'bell' | 'logout' | 'plus' | 'check'
  | 'check-circle' | 'x' | 'arrow-left' | 'arrow-right' | 'chev-down'
  | 'chev-right' | 'search' | 'filter' | 'download' | 'upload' | 'edit'
  | 'trash' | 'lock' | 'user' | 'menu' | 'eye' | 'eye-off' | 'copy'
  | 'refresh' | 'alert' | 'info' | 'calendar' | 'clock' | 'shield' | 'spark'
  | 'send' | 'chart' | 'dollar' | 'package-check' | 'flame' | 'camera' | 'loader';

interface IconProps {
  n: IconName;
  s?: number;
  c?: string;
}

export function Icon({ n, s = 16, c = 'currentColor' }: IconProps) {
  const props = {
    width: s,
    height: s,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: c,
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (n) {
    case 'home':       return <svg {...props}><path d="M3 12l9-9 9 9"/><path d="M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10"/></svg>;
    case 'truck':      return <svg {...props}><rect x="1" y="6" width="14" height="11" rx="1"/><path d="M15 9h4l3 4v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>;
    case 'box':        return <svg {...props}><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>;
    case 'layers':     return <svg {...props}><path d="M12 2l10 6-10 6L2 8l10-6z"/><path d="M2 16l10 6 10-6"/><path d="M2 12l10 6 10-6"/></svg>;
    case 'package':    return <svg {...props}><path d="M16.5 9.4l-9-5.19"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05"/><path d="M12 22V12"/></svg>;
    case 'qr':         return <svg {...props}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3z"/><path d="M20 14v7"/><path d="M14 20h3"/></svg>;
    case 'tag':        return <svg {...props}><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1.5"/></svg>;
    case 'tools':      return <svg {...props}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>;
    case 'history':    return <svg {...props}><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-7 3l-2 2"/><path d="M3 4v5h5"/><path d="M12 7v5l4 2"/></svg>;
    case 'users':      return <svg {...props}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>;
    case 'settings':   return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    case 'bell':       return <svg {...props}><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>;
    case 'logout':     return <svg {...props}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>;
    case 'plus':       return <svg {...props}><path d="M12 5v14M5 12h14"/></svg>;
    case 'check':      return <svg {...props}><path d="M20 6L9 17l-5-5"/></svg>;
    case 'check-circle': return <svg {...props}><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>;
    case 'x':          return <svg {...props}><path d="M18 6L6 18M6 6l12 12"/></svg>;
    case 'arrow-left': return <svg {...props}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>;
    case 'arrow-right':return <svg {...props}><path d="M5 12h14M12 5l7 7-7 7"/></svg>;
    case 'chev-down':  return <svg {...props}><path d="M6 9l6 6 6-6"/></svg>;
    case 'chev-right': return <svg {...props}><path d="M9 18l6-6-6-6"/></svg>;
    case 'search':     return <svg {...props}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>;
    case 'filter':     return <svg {...props}><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>;
    case 'download':   return <svg {...props}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>;
    case 'upload':     return <svg {...props}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>;
    case 'edit':       return <svg {...props}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
    case 'trash':      return <svg {...props}><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>;
    case 'lock':       return <svg {...props}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
    case 'user':       return <svg {...props}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    case 'menu':       return <svg {...props}><path d="M3 12h18M3 6h18M3 18h18"/></svg>;
    case 'eye':        return <svg {...props}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
    case 'eye-off':    return <svg {...props}><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><path d="M1 1l22 22"/></svg>;
    case 'copy':       return <svg {...props}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>;
    case 'refresh':    return <svg {...props}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/><path d="M20.49 15A9 9 0 015.64 18.36L1 14"/></svg>;
    case 'alert':      return <svg {...props}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>;
    case 'info':       return <svg {...props}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>;
    case 'calendar':   return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>;
    case 'clock':      return <svg {...props}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>;
    case 'shield':     return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    case 'spark':      return <svg {...props}><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>;
    case 'send':       return <svg {...props}><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>;
    case 'chart':      return <svg {...props}><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>;
    case 'dollar':     return <svg {...props}><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>;
    case 'package-check': return <svg {...props}><path d="M16 16l2 2 4-4"/><path d="M21 10V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l2-1.13"/><path d="M3.27 6.96L12 12.01l8.73-5.05"/><path d="M12 22V12"/></svg>;
    case 'flame':      return <svg {...props}><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>;
    case 'camera':     return <svg {...props}><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>;
    case 'loader':     return <svg {...props} style={{animation:'spin 1s linear infinite'}}><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>;
    default: return null;
  }
}
