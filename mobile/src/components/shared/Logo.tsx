interface LogoProps {
  size?: 'sm' | 'lg';
}

export function Logo({ size = 'sm' }: LogoProps) {
  const dims =
    size === 'lg' ? { main: 22, sub: 16 } : { main: 14, sub: 11 };
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', lineHeight: 1, position: 'relative', textAlign: 'center',
    }}>
      <div style={{
        position: 'relative',
        fontFamily: 'var(--font)',
        fontWeight: 900,
        fontSize: dims.main,
        letterSpacing: '-0.01em',
        color: 'var(--ink)',
        lineHeight: 1.05,
      }}>
        <span style={{ display: 'block' }}>JUSTO</span>
        <span style={{ display: 'block' }}>MAKARIO</span>
        <span style={{
          position: 'absolute',
          top: 1, right: -10,
          fontSize: dims.main * 0.42,
          fontWeight: 600,
          color: 'var(--ink-muted)',
        }}>®</span>
      </div>
      <div style={{
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontStyle: 'italic',
        fontWeight: 400,
        fontSize: dims.sub,
        color: 'var(--ink)',
        marginTop: 2,
      }}>Home</div>
    </div>
  );
}
