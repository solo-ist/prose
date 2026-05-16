// icon-options.jsx — Prose app logo explorations
// Each variant is a 320×320 macOS-style squircle. The brand vocabulary
// (Plex Mono Thin, Fraunces italic, cream + gold, paper-grain, near-black)
// is the only allowed material.

const NOISE_URL =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

const CREAM      = '#e3dbd1';
const CREAM_DIM  = '#7d7770';
const CREAM_DEEP = '#3e3b38';
const GOLD       = '#c8a45a';
const NEAR_BLACK = '#0a0a0a';
const PAPER      = '#f4eee5';
const PAPER_DEEP = '#1a1814';

// macOS app-icon squircle approximation. Apple's "continuous corners" use
// a superellipse — 22.37% radius is the standard CSS approximation.
const SQUIRCLE = 0.2237;

function IconShell({
  children, size = 320, bg = NEAR_BLACK, grain = true,
  light = false, ringColor, innerGlow,
}) {
  return (
    <div style={{
      position: 'relative',
      width: size,
      height: size,
      borderRadius: size * SQUIRCLE,
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
        <div style={{
          position: 'absolute',
          inset: 0,
          background: innerGlow,
          pointerEvents: 'none',
        }}/>
      )}
      {grain && (
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: NOISE_URL,
          backgroundSize: '200px 200px',
          opacity: light ? 0.09 : 0.16,
          mixBlendMode: light ? 'multiply' : 'screen',
          pointerEvents: 'none',
        }}/>
      )}
      {ringColor && (
        <div style={{
          position: 'absolute',
          inset: 0,
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

// ── 01. Refined P. — Plex Mono Thin, cream + gold dot ──────────────────────
function IconRefinedP() {
  return (
    <IconShell>
      <div style={{
        fontWeight: 200,
        fontSize: 240,
        letterSpacing: '-0.06em',
        color: CREAM,
        display: 'flex',
        alignItems: 'baseline',
        transform: 'translateY(8px)',
      }}>
        <span>P</span>
        <span style={{ color: GOLD, marginLeft: -4 }}>.</span>
      </div>
    </IconShell>
  );
}

// ── 02. Fraunces italic P — the signature brand pattern ────────────────────
function IconFrauncesP() {
  return (
    <IconShell>
      <div style={{
        fontFamily: '"Fraunces", serif',
        fontStyle: 'italic',
        fontWeight: 360,
        fontVariationSettings: '"opsz" 144, "SOFT" 30',
        fontSize: 320,
        color: CREAM,
        letterSpacing: '-0.02em',
        transform: 'translateY(8px) translateX(-6px)',
        position: 'relative',
      }}>
        P
        <span style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontStyle: 'normal',
          fontWeight: 300,
          color: GOLD,
          fontSize: 110,
          position: 'absolute',
          right: -28,
          bottom: 36,
        }}>.</span>
      </div>
    </IconShell>
  );
}

// ── 03. p.ist mini wordmark lockup ─────────────────────────────────────────
function IconPIstLockup() {
  return (
    <IconShell>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 14,
        transform: 'translateX(-4px)',
      }}>
        <div style={{
          fontSize: 170,
          fontWeight: 200,
          color: CREAM,
          letterSpacing: '-0.06em',
        }}>
          p<span style={{ color: GOLD }}>.</span>
        </div>
        <div style={{
          fontSize: 22,
          fontWeight: 400,
          color: CREAM_DIM,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          paddingLeft: 6,
        }}>
          prose
        </div>
      </div>
    </IconShell>
  );
}

// ── 04. Pilcrow ¶ — the paragraph mark, traditional prose semantics ────────
function IconPilcrow() {
  return (
    <IconShell>
      <div style={{
        fontFamily: '"Fraunces", serif',
        fontStyle: 'italic',
        fontWeight: 340,
        fontVariationSettings: '"opsz" 144',
        fontSize: 280,
        color: CREAM,
        transform: 'translateY(6px)',
      }}>
        ¶
      </div>
    </IconShell>
  );
}

// ── 05. Markdown asterisk — *emphasis* ─────────────────────────────────────
function IconAsterisk() {
  return (
    <IconShell>
      <div style={{
        position: 'relative',
        width: 240,
        height: 240,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          fontWeight: 200,
          fontSize: 360,
          color: CREAM,
          lineHeight: 1,
          transform: 'translateY(46px)',
        }}>*</div>
        <div style={{
          position: 'absolute',
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: GOLD,
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}/>
      </div>
    </IconShell>
  );
}

// ── 06. Markdown # — heading marker ────────────────────────────────────────
function IconHash() {
  return (
    <IconShell>
      <div style={{
        fontWeight: 200,
        fontSize: 260,
        color: CREAM,
        letterSpacing: '-0.04em',
        transform: 'translateY(2px)',
      }}>
        <span>#</span><span style={{ color: GOLD, fontSize: 96, verticalAlign: 'baseline' }}>.</span>
      </div>
    </IconShell>
  );
}

// ── 07. Just the period — reduction to atom ────────────────────────────────
function IconPeriod() {
  return (
    <IconShell innerGlow={`radial-gradient(circle at 50% 58%, rgba(200,164,90,0.18), transparent 55%)`}>
      <div style={{
        width: 64,
        height: 64,
        borderRadius: 8,   // matches Plex Mono's slightly-rounded square dot
        background: GOLD,
        boxShadow: '0 0 60px rgba(200,164,90,0.45)',
      }}/>
    </IconShell>
  );
}

// ── 08. >_ Prompt — agent-accessible / terminal lineage ────────────────────
function IconPrompt() {
  return (
    <IconShell>
      <div style={{
        fontWeight: 300,
        fontSize: 150,
        color: CREAM,
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        transform: 'translateY(4px)',
      }}>
        <span>&gt;</span>
        <span style={{
          display: 'inline-block',
          width: 56,
          height: 14,
          background: GOLD,
          marginBottom: 4,
        }}/>
      </div>
    </IconShell>
  );
}

// ── 09. Em dash with gold period — signature brand punctuation ─────────────
function IconEmDash() {
  return (
    <IconShell>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 0,
        fontWeight: 200,
        fontSize: 240,
        color: CREAM,
        letterSpacing: '-0.06em',
      }}>
        <span>—</span><span style={{ color: GOLD }}>.</span>
      </div>
    </IconShell>
  );
}

// ── 10. Caret block — the live editor cursor, frozen as a logo ─────────────
function IconCaret() {
  return (
    <IconShell>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, transform: 'translateY(-2px)' }}>
        <div style={{
          fontWeight: 300,
          fontSize: 170,
          color: CREAM_DIM,
          letterSpacing: '-0.04em',
          lineHeight: 1,
        }}>a</div>
        <div style={{
          width: 18,
          height: 140,
          background: GOLD,
        }}/>
      </div>
    </IconShell>
  );
}

// ── Originals / contrasts ──────────────────────────────────────────────────
function IconCurrent() {
  return (
    <IconShell bg="#000" grain={false}>
      <img src="assets/prose-icon-dark.png" alt="" style={{ width: 320, height: 320, borderRadius: 320 * SQUIRCLE }}/>
    </IconShell>
  );
}

// ── Light-mode pair (for dark-mode-skeptical reviewers) ────────────────────
function IconRefinedPLight() {
  return (
    <IconShell bg={PAPER} light ringColor="rgba(0,0,0,0.06)">
      <div style={{
        fontWeight: 200,
        fontSize: 240,
        letterSpacing: '-0.06em',
        color: PAPER_DEEP,
        display: 'flex',
        alignItems: 'baseline',
        transform: 'translateY(8px)',
      }}>
        <span>P</span>
        <span style={{ color: GOLD, marginLeft: -4 }}>.</span>
      </div>
    </IconShell>
  );
}

function IconFrauncesPLight() {
  return (
    <IconShell bg={PAPER} light ringColor="rgba(0,0,0,0.06)">
      <div style={{
        fontFamily: '"Fraunces", serif',
        fontStyle: 'italic',
        fontWeight: 360,
        fontVariationSettings: '"opsz" 144, "SOFT" 30',
        fontSize: 320,
        color: PAPER_DEEP,
        letterSpacing: '-0.02em',
        transform: 'translateY(8px) translateX(-6px)',
        position: 'relative',
      }}>
        P
        <span style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontStyle: 'normal',
          fontWeight: 400,
          color: GOLD,
          fontSize: 110,
          position: 'absolute',
          right: -28,
          bottom: 36,
        }}>.</span>
      </div>
    </IconShell>
  );
}

function IconPilcrowLight() {
  return (
    <IconShell bg={PAPER} light ringColor="rgba(0,0,0,0.06)">
      <div style={{
        fontFamily: '"Fraunces", serif',
        fontStyle: 'italic',
        fontWeight: 340,
        fontVariationSettings: '"opsz" 144',
        fontSize: 280,
        color: PAPER_DEEP,
        transform: 'translateY(6px)',
      }}>
        ¶
      </div>
    </IconShell>
  );
}

// ── Dock context strip — finalists at real dock size ──────────────────────
function DockStrip({ items, light = false }) {
  return (
    <div style={{
      width: 880,
      height: 200,
      borderRadius: 28,
      background: light
        ? 'linear-gradient(180deg, rgba(255,255,255,0.55), rgba(240,235,225,0.45))'
        : 'linear-gradient(180deg, rgba(40,40,40,0.6), rgba(20,20,20,0.55))',
      backdropFilter: 'blur(12px)',
      boxShadow: light
        ? '0 18px 48px rgba(80,60,30,0.18), inset 0 0 0 1px rgba(0,0,0,0.08)'
        : '0 18px 48px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.06)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 18,
      padding: '0 28px',
    }}>
      {items.map((Item, i) => (
        <div key={i} style={{ width: 120, height: 120, transform: 'scale(0.375)', transformOrigin: 'center' }}>
          <div style={{ width: 320, height: 320, transform: 'translate(-100px, -100px)' }}>
            <Item/>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Compose the canvas ─────────────────────────────────────────────────────
const A = (id, label, w, h, El, subtitle) => (
  <DCArtboard id={id} label={label} width={w} height={h}>
    <El/>
    {subtitle && <div style={{
      position: 'absolute', left: 0, right: 0, bottom: -28,
      fontFamily: '"IBM Plex Mono"', fontSize: 10, color: '#6b6256',
      letterSpacing: '0.06em', textAlign: 'left', paddingLeft: 2,
    }}>{subtitle}</div>}
  </DCArtboard>
);

function ProseLogoCanvas() {
  return (
    <DesignCanvas
      title="Prose · App logo explorations"
      subtitle="Each variant uses only the brand's existing material: Plex Mono Thin, Fraunces italic, cream + muted gold, paper-grain on near-black. 320×320 squircle (real macOS icon proportions)."
    >
      <DCSection
        id="ref"
        title="Reference"
        subtitle="The current Prose icon — green pixel P. on black. Reads as a CRT terminal app, not the warm essayist aesthetic of solo.ist / Prose."
      >
        <DCArtboard id="current" label="00 · Current (for comparison)" width={320} height={320}>
          <IconCurrent/>
        </DCArtboard>
      </DCSection>

      <DCSection
        id="letterforms"
        title="Letterforms"
        subtitle="Lean on the wordmark. The cream-on-near-black + single gold period is the brand's most repeated move — these put it on a face."
      >
        <DCArtboard id="refined-p" label="01 · Refined P." width={320} height={320}>
          <IconRefinedP/>
        </DCArtboard>
        <DCArtboard id="fraunces-p" label="02 · Fraunces italic P" width={320} height={320}>
          <IconFrauncesP/>
        </DCArtboard>
        <DCArtboard id="p-ist" label="03 · p.ist lockup" width={320} height={320}>
          <IconPIstLockup/>
        </DCArtboard>
      </DCSection>

      <DCSection
        id="marks"
        title="Markdown marks"
        subtitle="Lean on the format. Single glyphs from the markdown source language — pilcrow, asterisk, hash. The most distinctive of these (¶) reads instantly as 'prose tool' without spelling it out."
      >
        <DCArtboard id="pilcrow" label="04 · Pilcrow ¶" width={320} height={320}>
          <IconPilcrow/>
        </DCArtboard>
        <DCArtboard id="asterisk" label="05 · Asterisk *" width={320} height={320}>
          <IconAsterisk/>
        </DCArtboard>
        <DCArtboard id="hash" label="06 · Hash #" width={320} height={320}>
          <IconHash/>
        </DCArtboard>
      </DCSection>

      <DCSection
        id="reductive"
        title="Reductive"
        subtitle="Strip the icon to a single punctuation atom. Boldest options — work best paired with the wordmark elsewhere in the OS (window title, About box)."
      >
        <DCArtboard id="period" label="07 · The period" width={320} height={320}>
          <IconPeriod/>
        </DCArtboard>
        <DCArtboard id="em-dash" label="08 · Em dash + period" width={320} height={320}>
          <IconEmDash/>
        </DCArtboard>
        <DCArtboard id="caret" label="09 · Cursor block" width={320} height={320}>
          <IconCaret/>
        </DCArtboard>
        <DCArtboard id="prompt" label="10 · Prompt (>_)" width={320} height={320}>
          <IconPrompt/>
        </DCArtboard>
      </DCSection>

      <DCSection
        id="light"
        title="Light mode pairs"
        subtitle="macOS asks for a light variant too. Three finalists on paper-cream — same forms, inverted contrast, same gold dot."
      >
        <DCArtboard id="refined-p-light" label="01L · Refined P." width={320} height={320}>
          <IconRefinedPLight/>
        </DCArtboard>
        <DCArtboard id="fraunces-p-light" label="02L · Fraunces italic P" width={320} height={320}>
          <IconFrauncesPLight/>
        </DCArtboard>
        <DCArtboard id="pilcrow-light" label="04L · Pilcrow ¶" width={320} height={320}>
          <IconPilcrowLight/>
        </DCArtboard>
      </DCSection>

      <DCSection
        id="dock"
        title="In context"
        subtitle="Four finalists in a macOS dock at real proportions. The icon has to be distinctive at 64-ish px — these are."
      >
        <DCArtboard id="dock-dark" label="Dock · dark" width={880} height={200}>
          <DockStrip items={[IconRefinedP, IconFrauncesP, IconPilcrow, IconEmDash]}/>
        </DCArtboard>
        <DCArtboard id="dock-light" label="Dock · light" width={880} height={200}>
          <DockStrip light items={[IconRefinedPLight, IconFrauncesPLight, IconPilcrowLight, IconRefinedP]}/>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<ProseLogoCanvas/>);
