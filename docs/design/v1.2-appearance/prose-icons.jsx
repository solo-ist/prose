// prose-icons.jsx — shared library of Prose app-icon explorations.
// All variants render at a base 320×320 squircle. Use ProseIcons.Thumb to
// render any at an arbitrary smaller size via CSS scaling.

const _NOISE_URL =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

const PI_CREAM      = '#e3dbd1';
const PI_CREAM_DIM  = '#7d7770';
const PI_GOLD       = '#c8a45a';
const PI_NEAR_BLACK = '#0a0a0a';
const PI_PAPER      = '#f4eee5';
const PI_PAPER_DEEP = '#1a1814';
const PI_SQUIRCLE   = 0.2237;

function IconShell({
  children, size = 320, bg = PI_NEAR_BLACK, grain = true,
  light = false, ringColor, innerGlow,
}) {
  return (
    <div style={{
      position: 'relative',
      width: size,
      height: size,
      borderRadius: size * PI_SQUIRCLE,
      background: bg,
      overflow: 'hidden',
      boxShadow: light
        ? '0 10px 36px rgba(0,0,0,0.14), inset 0 0 0 1px rgba(0,0,0,0.06)'
        : '0 14px 44px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.045)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      WebkitFontSmoothing: 'antialiased',
    }}>
      {innerGlow && (
        <div style={{ position: 'absolute', inset: 0, background: innerGlow, pointerEvents: 'none' }}/>
      )}
      {grain && (
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: _NOISE_URL, backgroundSize: '200px 200px',
          opacity: light ? 0.09 : 0.16,
          mixBlendMode: light ? 'multiply' : 'screen',
          pointerEvents: 'none',
        }}/>
      )}
      {ringColor && (
        <div style={{
          position: 'absolute', inset: 0,
          borderRadius: 'inherit',
          boxShadow: `inset 0 0 0 1px ${ringColor}`,
          pointerEvents: 'none',
        }}/>
      )}
      <div style={{ position: 'relative', zIndex: 1, lineHeight: 1 }}>
        {children}
      </div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function IconRefinedP() {
  return (
    <IconShell>
      <div style={{
        fontWeight: 200, fontSize: 240, letterSpacing: '-0.06em', color: PI_CREAM,
        display: 'flex', alignItems: 'baseline', transform: 'translateY(8px)',
      }}>
        <span>P</span>
        <span style={{ color: PI_GOLD, marginLeft: -4 }}>.</span>
      </div>
    </IconShell>
  );
}

function IconFrauncesP() {
  return (
    <IconShell>
      <div style={{
        fontFamily: '"Fraunces", serif', fontStyle: 'italic', fontWeight: 360,
        fontVariationSettings: '"opsz" 144, "SOFT" 30',
        fontSize: 320, color: PI_CREAM, letterSpacing: '-0.02em',
        transform: 'translateY(8px) translateX(-6px)', position: 'relative',
      }}>
        P
        <span style={{
          fontFamily: '"IBM Plex Mono", monospace', fontStyle: 'normal',
          fontWeight: 300, color: PI_GOLD, fontSize: 110,
          position: 'absolute', right: -28, bottom: 36,
        }}>.</span>
      </div>
    </IconShell>
  );
}

function IconPIstLockup() {
  return (
    <IconShell>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        gap: 14, transform: 'translateX(-4px)',
      }}>
        <div style={{
          fontSize: 170, fontWeight: 200, color: PI_CREAM, letterSpacing: '-0.06em',
        }}>
          p<span style={{ color: PI_GOLD }}>.</span>
        </div>
        <div style={{
          fontSize: 22, fontWeight: 400, color: PI_CREAM_DIM,
          letterSpacing: '0.18em', textTransform: 'uppercase', paddingLeft: 6,
        }}>
          prose
        </div>
      </div>
    </IconShell>
  );
}

function IconPilcrow() {
  return (
    <IconShell>
      <div style={{
        fontFamily: '"Fraunces", serif', fontStyle: 'italic', fontWeight: 340,
        fontVariationSettings: '"opsz" 144',
        fontSize: 280, color: PI_CREAM, transform: 'translateY(6px)',
      }}>
        ¶
      </div>
    </IconShell>
  );
}

function IconAsterisk() {
  return (
    <IconShell>
      <div style={{
        position: 'relative', width: 240, height: 240,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          fontWeight: 200, fontSize: 360, color: PI_CREAM,
          lineHeight: 1, transform: 'translateY(46px)',
        }}>*</div>
        <div style={{
          position: 'absolute', width: 18, height: 18, borderRadius: '50%',
          background: PI_GOLD, left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
        }}/>
      </div>
    </IconShell>
  );
}

function IconHash() {
  return (
    <IconShell>
      <div style={{
        fontWeight: 200, fontSize: 260, color: PI_CREAM,
        letterSpacing: '-0.04em', transform: 'translateY(2px)',
      }}>
        <span>#</span><span style={{ color: PI_GOLD, fontSize: 96 }}>.</span>
      </div>
    </IconShell>
  );
}

function IconPeriod() {
  return (
    <IconShell innerGlow="radial-gradient(circle at 50% 58%, rgba(200,164,90,0.18), transparent 55%)">
      <div style={{
        width: 64, height: 64, borderRadius: 8,
        background: PI_GOLD,
        boxShadow: '0 0 60px rgba(200,164,90,0.45)',
      }}/>
    </IconShell>
  );
}

function IconPrompt() {
  return (
    <IconShell>
      <div style={{
        fontWeight: 300, fontSize: 150, color: PI_CREAM,
        display: 'flex', alignItems: 'baseline', gap: 10, transform: 'translateY(4px)',
      }}>
        <span>&gt;</span>
        <span style={{
          display: 'inline-block', width: 56, height: 14,
          background: PI_GOLD, marginBottom: 4,
        }}/>
      </div>
    </IconShell>
  );
}

function IconEmDash() {
  return (
    <IconShell>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 0,
        fontWeight: 200, fontSize: 240, color: PI_CREAM, letterSpacing: '-0.06em',
      }}>
        <span>—</span><span style={{ color: PI_GOLD }}>.</span>
      </div>
    </IconShell>
  );
}

function IconCaret() {
  return (
    <IconShell>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, transform: 'translateY(-2px)' }}>
        <div style={{
          fontWeight: 300, fontSize: 170, color: PI_CREAM_DIM,
          letterSpacing: '-0.04em', lineHeight: 1,
        }}>a</div>
        <div style={{ width: 18, height: 140, background: PI_GOLD }}/>
      </div>
    </IconShell>
  );
}

// Light variants of the strongest three
function IconRefinedPLight() {
  return (
    <IconShell bg={PI_PAPER} light ringColor="rgba(0,0,0,0.06)">
      <div style={{
        fontWeight: 200, fontSize: 240, letterSpacing: '-0.06em', color: PI_PAPER_DEEP,
        display: 'flex', alignItems: 'baseline', transform: 'translateY(8px)',
      }}>
        <span>P</span>
        <span style={{ color: PI_GOLD, marginLeft: -4 }}>.</span>
      </div>
    </IconShell>
  );
}

function IconFrauncesPLight() {
  return (
    <IconShell bg={PI_PAPER} light ringColor="rgba(0,0,0,0.06)">
      <div style={{
        fontFamily: '"Fraunces", serif', fontStyle: 'italic', fontWeight: 360,
        fontVariationSettings: '"opsz" 144, "SOFT" 30',
        fontSize: 320, color: PI_PAPER_DEEP, letterSpacing: '-0.02em',
        transform: 'translateY(8px) translateX(-6px)', position: 'relative',
      }}>
        P
        <span style={{
          fontFamily: '"IBM Plex Mono", monospace', fontStyle: 'normal',
          fontWeight: 400, color: PI_GOLD, fontSize: 110,
          position: 'absolute', right: -28, bottom: 36,
        }}>.</span>
      </div>
    </IconShell>
  );
}

function IconPilcrowLight() {
  return (
    <IconShell bg={PI_PAPER} light ringColor="rgba(0,0,0,0.06)">
      <div style={{
        fontFamily: '"Fraunces", serif', fontStyle: 'italic', fontWeight: 340,
        fontVariationSettings: '"opsz" 144',
        fontSize: 280, color: PI_PAPER_DEEP, transform: 'translateY(6px)',
      }}>
        ¶
      </div>
    </IconShell>
  );
}

// Legacy reference — the existing CRT-green pixel icon
function IconLegacy() {
  return (
    <IconShell bg="#000" grain={false}>
      <img src="assets/prose-icon-dark.png" alt=""
           style={{ width: 320, height: 320, borderRadius: 320 * PI_SQUIRCLE }}/>
    </IconShell>
  );
}

// Renders any icon component at an arbitrary smaller size by CSS-scaling
// the underlying 320×320 shell. Keeps geometry exact.
function IconThumb({ Component, size = 96 }) {
  const scale = size / 320;
  return (
    <div style={{
      width: size, height: size, position: 'relative',
      flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0,
        transform: `scale(${scale})`, transformOrigin: 'top left',
      }}>
        <Component/>
      </div>
    </div>
  );
}

// ── Catalog & default ──────────────────────────────────────────────────────

const PROSE_ICONS = [
  { id: 'pilcrow',    name: 'Pilcrow',        subtitle: '¶ · paragraph mark',             Component: IconPilcrow,    official: true },
  { id: 'refined-p',  name: 'Refined P.',     subtitle: 'Plex Mono Thin · cream + gold',  Component: IconRefinedP },
  { id: 'fraunces-p', name: 'Italic P',       subtitle: 'Fraunces · the signature italic', Component: IconFrauncesP },
  { id: 'p-ist',      name: 'p.ist lockup',   subtitle: 'mini wordmark',                  Component: IconPIstLockup },
  { id: 'asterisk',   name: 'Asterisk',       subtitle: '* · markdown emphasis',          Component: IconAsterisk },
  { id: 'hash',       name: 'Hash',           subtitle: '# · markdown heading',           Component: IconHash },
  { id: 'em-dash',    name: 'Em dash',        subtitle: '—. · signature punctuation',     Component: IconEmDash },
  { id: 'caret',      name: 'Cursor block',   subtitle: 'a| · the editor caret',          Component: IconCaret },
  { id: 'period',     name: 'The period',     subtitle: 'reductive · atom of the brand',  Component: IconPeriod },
  { id: 'prompt',     name: 'Prompt',         subtitle: '>_ · agent-accessible',          Component: IconPrompt },
  { id: 'legacy',     name: 'Legacy',         subtitle: 'classic pixel P. (1.0)',         Component: IconLegacy,    legacy: true },
];

window.ProseIcons = {
  // shell + helpers
  IconShell, IconThumb,
  // tokens
  CREAM: PI_CREAM, GOLD: PI_GOLD, NEAR_BLACK: PI_NEAR_BLACK, PAPER: PI_PAPER,
  SQUIRCLE: PI_SQUIRCLE,
  // catalog
  CATALOG: PROSE_ICONS,
  // individual components
  IconRefinedP, IconFrauncesP, IconPIstLockup,
  IconPilcrow, IconAsterisk, IconHash,
  IconPeriod, IconPrompt, IconEmDash, IconCaret,
  IconLegacy,
  IconRefinedPLight, IconFrauncesPLight, IconPilcrowLight,
};
