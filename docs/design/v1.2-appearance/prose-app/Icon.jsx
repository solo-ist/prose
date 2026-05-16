/* Lucide icon wrapper — uses the global `lucide` object loaded via CDN. */
function Icon({ name, size }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current || !window.lucide) return;
    const span = ref.current;
    span.innerHTML = '';
    const el = document.createElement('i');
    el.setAttribute('data-lucide', name);
    span.appendChild(el);
    window.lucide.createIcons({ attrs: { 'stroke-width': 1.5, width: size || 16, height: size || 16 } });
  }, [name, size]);
  return <span ref={ref} style={{ display: 'inline-flex', alignItems: 'center' }} aria-hidden="true" />;
}

window.Icon = Icon;
