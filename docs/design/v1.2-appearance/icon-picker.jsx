// icon-picker.jsx — Prose · Settings → Appearance
// Mode (Light/Dark/System) + Color (Termy/Prose/Mono) + App Icon.
// All three feed CSS custom properties on the settings window so the chrome
// itself swaps themes live; the desktop and dock stay independent.

const { useState, useEffect } = React;
const PI = window.ProseIcons;
const { IconThumb, CATALOG, SQUIRCLE } = PI;
const DEFAULT_ICON_ID = CATALOG.find(c => c.official)?.id || CATALOG[0].id;
const byId = (id) => CATALOG.find(c => c.id === id);

// ── Themes ────────────────────────────────────────────────────────────────
const THEMES = [
  { id: 'termy', name: 'Termy', subtitle: 'phosphor green',  tag: 'DEEP CUT' },
  { id: 'prose', name: 'Prose', subtitle: 'paper + gold',    tag: 'DEFAULT', official: true },
  { id: 'mono',  name: 'Mono',  subtitle: 'shadcn neutral',  tag: 'LEGACY 1.0' },
];
const DEFAULT_THEME_ID = THEMES.find(t => t.official)?.id || 'prose';

const MODES = [
  { id: 'light',  label: 'Light',  icon: 'sun' },
  { id: 'dark',   label: 'Dark',   icon: 'moon' },
  { id: 'system', label: 'System', icon: 'monitor' },
];
const DEFAULT_MODE = 'dark';

function useEffectiveMode(mode) {
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = (e) => setSystemDark(e.matches);
    mq.addEventListener?.('change', h);
    return () => mq.removeEventListener?.('change', h);
  }, []);
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
}

function useLucide(deps) {
  useEffect(() => {
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  }, deps);
}

// ── Desktop ───────────────────────────────────────────────────────────────
const NOISE_URL =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.45'/%3E%3C/svg%3E\")";

function Desktop({ children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'radial-gradient(ellipse 90% 70% at 50% 28%, #2a2218 0%, #110e09 55%, #050403 100%)',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: NOISE_URL, backgroundSize: '200px 200px',
        opacity: 0.10, mixBlendMode: 'screen', pointerEvents: 'none',
      }}/>
      <div style={{
        position: 'absolute', top: 36, right: 48,
        fontFamily: '"IBM Plex Mono"', fontWeight: 200,
        fontSize: 14, letterSpacing: '-0.01em',
        color: 'rgba(227,219,209,0.18)',
      }}>
        solo<span style={{ color: 'rgba(200,164,90,0.45)' }}>.ist</span>
      </div>
      {children}
    </div>
  );
}

// ── Settings window ──────────────────────────────────────────────────────
function SettingsWindow({ theme, mode, children }) {
  return (
    <div
      className="t-scope"
      data-theme={theme} data-mode={mode}
      style={{
        width: 940,
        height: 660,
        borderRadius: 12,
        background: 'var(--t-bg-2)',
        boxShadow: 'var(--t-window-shadow), 0 0 0 1px rgba(255,255,255,0.05)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        position: 'relative', zIndex: 2,
        color: 'var(--t-text)',
        fontFamily: '"IBM Plex Mono", monospace',
        transition: 'background .25s, box-shadow .25s, color .25s',
      }}
    >
      {/* Titlebar */}
      <div style={{
        height: 38,
        display: 'flex', alignItems: 'center',
        padding: '0 16px',
        background: 'var(--t-titlebar)',
        borderBottom: '1px solid var(--t-border)',
        position: 'relative', flexShrink: 0,
        transition: 'background .25s, border-color .25s',
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57' }}/>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }}/>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }}/>
        </div>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: '"IBM Plex Mono"', fontWeight: 400, fontSize: 12,
          color: 'var(--t-text-2)', letterSpacing: '0.02em', pointerEvents: 'none',
        }}>
          Prose <span style={{ color: 'var(--t-text-3)', margin: '0 8px' }}>·</span> Settings
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────
const NAV = [
  { id: 'general',    label: 'General',     icon: 'settings' },
  { id: 'editor',     label: 'Editor',      icon: 'file-text' },
  { id: 'ai',         label: 'AI · MCP',    icon: 'sparkles' },
  { id: 'sync',       label: 'Sync',        icon: 'cloud' },
  { id: 'account',    label: 'Account',     icon: 'circle-user-round' },
  { id: 'appearance', label: 'Appearance',  icon: 'palette',  active: true },
  { id: 'shortcuts',  label: 'Shortcuts',   icon: 'command' },
  { id: 'about',      label: 'About',       icon: 'info' },
];

function Sidebar() {
  useLucide([]);
  return (
    <div style={{
      width: 198,
      background: 'var(--t-bg-3)',
      borderRight: '1px solid var(--t-border)',
      padding: '14px 10px',
      display: 'flex', flexDirection: 'column', gap: 1,
      flexShrink: 0,
      transition: 'background .25s, border-color .25s',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '6px 9px', marginBottom: 8,
        background: 'var(--t-accent-soft)',
        border: '1px solid var(--t-border)',
        borderRadius: 6,
        fontFamily: '"IBM Plex Mono"', fontSize: 11, color: 'var(--t-text-3)',
      }}>
        <i data-lucide="search" style={{ width: 12, height: 12, strokeWidth: 1.6 }}></i>
        Search settings
      </div>
      {NAV.map((n) => (
        <div key={n.id} style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '7px 9px',
          borderRadius: 6,
          background: n.active ? 'var(--t-accent-soft)' : 'transparent',
          color: n.active ? 'var(--t-text)' : 'var(--t-text-2)',
          fontFamily: '"IBM Plex Mono"', fontWeight: 400, fontSize: 12,
          letterSpacing: '-0.005em',
          cursor: 'pointer', userSelect: 'none', position: 'relative',
        }}>
          {n.active && (
            <div style={{
              position: 'absolute', left: -10, top: 8, bottom: 8, width: 2,
              background: 'var(--t-accent)', borderRadius: 1,
            }}/>
          )}
          <i data-lucide={n.icon} style={{ width: 13, height: 13, strokeWidth: 1.6 }}></i>
          <span style={{ flex: 1 }}>{n.label}</span>
        </div>
      ))}
      <div style={{ flex: 1 }}/>
      <div style={{
        padding: '12px 9px 4px', borderTop: '1px solid var(--t-border)',
        display: 'flex', alignItems: 'center', gap: 8,
        marginTop: 8,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%',
          background: 'var(--t-accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: '"IBM Plex Mono"', fontSize: 10, fontWeight: 500,
          color: 'var(--t-accent-fg)',
        }}>g</div>
        <div style={{ fontFamily: '"IBM Plex Mono"', fontSize: 10, color: 'var(--t-text-2)', lineHeight: 1.3 }}>
          <div style={{ color: 'var(--t-text)' }}>guy</div>
          <div style={{ fontSize: 9, color: 'var(--t-text-3)' }}>BYOK · Anthropic</div>
        </div>
      </div>
    </div>
  );
}

// ── Section eyebrow + hairline ────────────────────────────────────────────
function SectionLabel({ children, rule = true }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      marginBottom: 12,
      fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
      color: 'var(--t-text-3)', fontWeight: 400,
    }}>
      <span>{children}</span>
      {rule && <div style={{ flex: 1, height: 1, background: 'var(--t-border)', maxWidth: 200 }}/>}
    </div>
  );
}

// ── Mode segmented control ────────────────────────────────────────────────
function ModeToggle({ mode, onChange, effectiveMode }) {
  useLucide([mode]);
  return (
    <div style={{
      display: 'inline-flex',
      background: 'var(--t-bg)',
      border: '1px solid var(--t-border)',
      borderRadius: 7,
      padding: 3,
      gap: 2,
    }}>
      {MODES.map((m) => {
        const selected = mode === m.id;
        return (
          <button key={m.id} onClick={() => onChange(m.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '5px 12px',
              fontFamily: '"IBM Plex Mono"', fontSize: 11.5,
              border: 'none', borderRadius: 5,
              background: selected ? 'var(--t-accent)' : 'transparent',
              color: selected ? 'var(--t-accent-fg)' : 'var(--t-text-2)',
              cursor: 'pointer',
              transition: 'background .15s, color .15s',
            }}>
            <i data-lucide={m.icon} style={{ width: 12, height: 12, strokeWidth: 1.7 }}></i>
            {m.label}
            {m.id === 'system' && mode === 'system' && (
              <span style={{
                fontSize: 9, opacity: 0.7, marginLeft: 1,
                letterSpacing: '0.05em',
              }}>· {effectiveMode}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Theme card ────────────────────────────────────────────────────────────
function ThemeCard({ theme, selected, mode, onSelect }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={() => onSelect(theme.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: selected ? 'var(--t-accent-soft)' : 'transparent',
        border: `1.5px solid ${selected ? 'var(--t-accent)' : 'var(--t-border)'}`,
        borderRadius: 10,
        padding: 12,
        textAlign: 'left',
        cursor: 'pointer',
        position: 'relative',
        fontFamily: '"IBM Plex Mono"',
        transform: hover && !selected ? 'translateY(-2px)' : 'none',
        transition: 'transform .15s, border-color .18s, background .18s',
      }}
    >
      {/* nested theme scope — preview tile shows THIS theme */}
      <div data-theme={theme.id} data-mode={mode} style={{
        height: 78,
        background: 'var(--t-bg)',
        borderRadius: 6,
        border: '1px solid var(--t-border)',
        padding: '10px 12px',
        display: 'flex', flexDirection: 'column',
        gap: 6, overflow: 'hidden',
      }}>
        {/* mini titlebar dots */}
        <div style={{ display: 'flex', gap: 3, marginBottom: 2 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#ff5f57', opacity: 0.7 }}/>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#febc2e', opacity: 0.7 }}/>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#28c840', opacity: 0.7 }}/>
        </div>
        <div style={{ height: 5, width: '80%', background: 'var(--t-text)', borderRadius: 1, opacity: 0.85 }}/>
        <div style={{ height: 4, width: '60%', background: 'var(--t-text-2)', borderRadius: 1 }}/>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 'auto' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--t-accent)' }}/>
          <div style={{ height: 3, width: 28, background: 'var(--t-text-3)', borderRadius: 1 }}/>
          <div style={{ height: 3, width: 16, background: 'var(--t-text-3)', borderRadius: 1, opacity: 0.5 }}/>
        </div>
      </div>

      {/* Label */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 400, color: 'var(--t-text)', letterSpacing: '-0.005em' }}>
          {theme.name}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--t-text-3)' }}>
          {theme.subtitle}
        </div>
      </div>
      {theme.tag && (
        <div style={{
          fontSize: 8.5, letterSpacing: '0.16em', textTransform: 'uppercase',
          color: theme.official ? 'var(--t-accent)' : 'var(--t-text-3)',
          marginTop: 5, fontWeight: 500,
        }}>
          {theme.tag}
        </div>
      )}

      {/* Selection dot */}
      {selected && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          width: 18, height: 18, borderRadius: '50%',
          background: 'var(--t-accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 0 2px var(--t-bg-2)',
        }}>
          <i data-lucide="check" style={{ width: 11, height: 11, color: 'var(--t-accent-fg)', strokeWidth: 3 }}></i>
        </div>
      )}
    </button>
  );
}

// ── Icon cell (in the App Icon grid) ──────────────────────────────────────
function IconCell({ item, selected, onSelect }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={() => onSelect(item.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 8, fontFamily: '"IBM Plex Mono"',
        transform: hover && !selected ? 'translateY(-2px)' : 'none',
        transition: 'transform .14s',
      }}
    >
      <div style={{
        position: 'relative',
        padding: 5,
        borderRadius: 22,
        background: selected ? 'var(--t-accent-soft)' : 'transparent',
        boxShadow: selected ? '0 0 0 2px var(--t-accent)' : 'none',
        transition: 'box-shadow .18s, background .18s',
      }}>
        <IconThumb Component={item.Component} size={78}/>
        {selected && (
          <div style={{
            position: 'absolute', top: -6, right: -6,
            width: 19, height: 19, borderRadius: '50%',
            background: 'var(--t-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 0 3px var(--t-bg-2)',
          }}>
            <i data-lucide="check" style={{ width: 11, height: 11, color: 'var(--t-accent-fg)', strokeWidth: 3 }}></i>
          </div>
        )}
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: 10.5, fontWeight: 400,
          color: selected ? 'var(--t-text)' : 'var(--t-text-2)',
          letterSpacing: '-0.005em',
        }}>{item.name}</div>
        {item.official && (
          <div style={{
            fontSize: 8.5, letterSpacing: '0.16em', textTransform: 'uppercase',
            color: 'var(--t-accent)', marginTop: 3, fontWeight: 500,
          }}>DEFAULT</div>
        )}
        {item.legacy && (
          <div style={{
            fontSize: 8.5, letterSpacing: '0.16em', textTransform: 'uppercase',
            color: 'var(--t-text-3)', marginTop: 3, fontWeight: 500,
          }}>1.0 LEGACY</div>
        )}
      </div>
    </button>
  );
}

// ── Appearance pane ───────────────────────────────────────────────────────
function AppearancePane({
  themeId, modeId, effectiveMode, iconId,
  onTheme, onMode, onIcon, onResetAll,
}) {
  const selectedIcon = byId(iconId);
  const isAllDefault =
    themeId === DEFAULT_THEME_ID &&
    modeId === DEFAULT_MODE &&
    iconId === DEFAULT_ICON_ID;
  useLucide([themeId, modeId, iconId]);

  return (
    <div style={{
      flex: 1, overflow: 'auto',
      padding: '22px 28px 22px',
      background: 'var(--t-bg-2)',
      color: 'var(--t-text)',
      fontFamily: '"IBM Plex Mono"',
      transition: 'background .25s, color .25s',
    }}>
      {/* Page title */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 22,
      }}>
        <h1 style={{
          fontFamily: '"IBM Plex Mono"', fontWeight: 400, fontSize: 19,
          letterSpacing: '-0.02em', color: 'var(--t-text)',
        }}>Appearance</h1>
        <div style={{
          fontSize: 10.5, color: 'var(--t-text-3)',
          letterSpacing: '0.04em',
        }}>
          <span style={{ color: 'var(--t-text-2)' }}>{themeById(themeId).name}</span>
          <span style={{ margin: '0 6px' }}>·</span>
          <span>{effectiveMode}</span>
          {modeId === 'system' && <span style={{ marginLeft: 6 }}>(system)</span>}
        </div>
      </div>

      {/* MODE */}
      <SectionLabel>Mode</SectionLabel>
      <div style={{ marginBottom: 22 }}>
        <ModeToggle mode={modeId} onChange={onMode} effectiveMode={effectiveMode}/>
      </div>

      {/* COLOR */}
      <SectionLabel>Color</SectionLabel>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14,
        marginBottom: 22,
      }}>
        {THEMES.map((t) => (
          <ThemeCard key={t.id} theme={t}
                     mode={effectiveMode}
                     selected={t.id === themeId}
                     onSelect={onTheme}/>
        ))}
      </div>

      {/* APP ICON */}
      <SectionLabel>App icon</SectionLabel>
      <p style={{
        fontFamily: '"IBM Plex Mono"', fontSize: 11.5, fontWeight: 300,
        color: 'var(--t-text-2)', lineHeight: 1.6,
        marginBottom: 16, maxWidth: 560,
      }}>
        Default is <em style={{
          fontFamily: '"Fraunces", serif', fontStyle: 'italic', color: 'var(--t-text)',
        }}>Pilcrow</em> — the paragraph mark used by prose typographers since the 12th century.
        <span style={{ color: 'var(--t-text-3)' }}> Changes apply immediately.</span>
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: 14,
        marginBottom: 22,
      }}>
        {CATALOG.map((item) => (
          <IconCell key={item.id} item={item}
                    selected={item.id === iconId}
                    onSelect={onIcon}/>
        ))}
      </div>

      {/* Reset row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 14, borderTop: '1px solid var(--t-border)',
        fontSize: 11, color: 'var(--t-text-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i data-lucide="info" style={{ width: 12, height: 12, strokeWidth: 1.6, color: 'var(--t-text-3)' }}></i>
          <span>
            Using <span style={{ color: 'var(--t-text)' }}>{themeById(themeId).name}</span>
            <span style={{ color: 'var(--t-text-3)' }}> · </span>
            <span style={{ color: 'var(--t-text)' }}>{effectiveMode}</span>
            <span style={{ color: 'var(--t-text-3)' }}> · </span>
            <span style={{ color: 'var(--t-text)' }}>{selectedIcon.name}</span>
          </span>
        </div>
        <button
          onClick={onResetAll}
          disabled={isAllDefault}
          style={{
            background: 'transparent',
            border: '1px solid var(--t-border)',
            color: isAllDefault ? 'var(--t-disabled)' : 'var(--t-text)',
            fontFamily: '"IBM Plex Mono"', fontSize: 11,
            padding: '5px 12px', borderRadius: 5,
            cursor: isAllDefault ? 'default' : 'pointer',
            opacity: isAllDefault ? 0.55 : 1,
            transition: 'border-color .12s, opacity .12s',
          }}
          onMouseEnter={(e) => { if (!isAllDefault) e.currentTarget.style.borderColor = 'var(--t-border-2)'; }}
          onMouseLeave={(e) => { if (!isAllDefault) e.currentTarget.style.borderColor = 'var(--t-border)'; }}
        >
          Reset all to default
        </button>
      </div>
    </div>
  );
}

// ── Dock ──────────────────────────────────────────────────────────────────
function DockNeighbor({ icon, color, label }) {
  return (
    <div title={label} style={{
      width: 56, height: 56,
      borderRadius: 56 * SQUIRCLE,
      background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 6px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.18), inset 0 0 0 1px rgba(0,0,0,0.18)',
      position: 'relative', flexShrink: 0,
    }}>
      <i data-lucide={icon} style={{
        width: 30, height: 30, color: '#fff', strokeWidth: 1.6,
        filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.18))',
      }}></i>
    </div>
  );
}

function Dock({ Component, iconName, themeName }) {
  useLucide([Component, iconName, themeName]);
  return (
    <div style={{
      position: 'absolute', left: '50%', bottom: 20,
      transform: 'translateX(-50%)', zIndex: 1,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 11px',
        background: 'rgba(15,12,8,0.65)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(200,164,90,0.25)',
        borderRadius: 999,
        fontFamily: '"IBM Plex Mono"', fontSize: 10, color: '#e3dbd1',
        letterSpacing: '0.02em',
        boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
      }}>
        <i data-lucide="arrow-down" style={{ width: 11, height: 11, color: '#c8a45a', strokeWidth: 2 }}></i>
        Live preview <span style={{ color: '#5a554d' }}>·</span> {iconName}
      </div>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 10,
        padding: '8px 12px 6px',
        borderRadius: 22,
        background: 'rgba(35,32,26,0.55)',
        backdropFilter: 'blur(28px) saturate(160%)',
        boxShadow: '0 22px 56px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.10), inset 0 0 0 1px rgba(255,255,255,0.06)',
      }}>
        <DockNeighbor icon="folder"         color="linear-gradient(180deg, #6cb6ff, #2e75c8)" label="Finder"/>
        <DockNeighbor icon="globe"          color="linear-gradient(180deg, #b8d8f5, #2a6fb8)" label="Safari"/>
        <DockNeighbor icon="mail"           color="linear-gradient(180deg, #87ceff, #2a93d6)" label="Mail"/>
        <DockNeighbor icon="message-square" color="linear-gradient(180deg, #7eea7a, #2da42a)" label="Messages"/>
        <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }}/>
        <div style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 56 * SQUIRCLE,
            background: 'radial-gradient(circle at 50% 100%, rgba(200,164,90,0.55), transparent 60%)',
            filter: 'blur(8px)', transform: 'translateY(6px)',
            pointerEvents: 'none',
          }}/>
          <div style={{ width: 56, height: 56, position: 'relative' }}>
            <IconThumb Component={Component} size={56}/>
          </div>
          <div style={{
            position: 'absolute', left: '50%', top: -34, transform: 'translateX(-50%)',
            padding: '4px 9px', borderRadius: 5,
            background: 'rgba(15,12,8,0.92)', backdropFilter: 'blur(6px)',
            border: '1px solid rgba(255,255,255,0.08)',
            fontFamily: '"IBM Plex Mono"', fontSize: 10, color: '#e3dbd1',
            whiteSpace: 'nowrap',
            boxShadow: '0 6px 14px rgba(0,0,0,0.35)',
          }}>
            Prose
          </div>
        </div>
        <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }}/>
        <DockNeighbor icon="calendar" color="#fff" label="Calendar"/>
        <DockNeighbor icon="music"    color="linear-gradient(180deg, #fb6d92, #e0356c)" label="Music"/>
        <DockNeighbor icon="settings" color="linear-gradient(180deg, #4a4a4a, #1f1f1f)" label="Settings"/>
      </div>
    </div>
  );
}

function themeById(id) { return THEMES.find(t => t.id === id) || THEMES[0]; }

// ── App root ──────────────────────────────────────────────────────────────
function App() {
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);
  const [modeId, setModeId]   = useState(DEFAULT_MODE);
  const [iconId, setIconId]   = useState(DEFAULT_ICON_ID);
  const effectiveMode = useEffectiveMode(modeId);
  const selectedItem = byId(iconId);

  useEffect(() => {
    document.title = `Prose · Settings · ${themeById(themeId).name} ${effectiveMode}`;
  }, [themeId, effectiveMode]);

  const resetAll = () => {
    setThemeId(DEFAULT_THEME_ID);
    setModeId(DEFAULT_MODE);
    setIconId(DEFAULT_ICON_ID);
  };

  return (
    <Desktop>
      <div style={{
        position: 'absolute',
        top: '50%', left: '50%',
        transform: 'translate(-50%, calc(-50% - 60px))',
      }}>
        <SettingsWindow theme={themeId} mode={effectiveMode}>
          <Sidebar/>
          <AppearancePane
            themeId={themeId}
            modeId={modeId}
            effectiveMode={effectiveMode}
            iconId={iconId}
            onTheme={setThemeId}
            onMode={setModeId}
            onIcon={setIconId}
            onResetAll={resetAll}
          />
        </SettingsWindow>
      </div>
      <Dock Component={selectedItem.Component}
            iconName={selectedItem.name}
            themeName={themeById(themeId).name}/>
    </Desktop>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
