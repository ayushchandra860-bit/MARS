import React, { useState, useEffect } from 'react';
import { AppSettings, DEFAULT_SETTINGS, ExpiryPreset } from '../../../shared/types/ipc';
import { invokeIpc } from '../hooks/useIpc';
import { IPC_INVOKE_CHANNELS } from '../../../shared/contracts/ipc-channels';

import { GlassPanel } from '../components/GlassPanel';

interface SettingsViewProps {
  settings: AppSettings | null;
  onUpdate: (updated: AppSettings) => void;
}

export type SettingsCategory = 
  | 'trading'
  | 'scanner'
  | 'signals'
  | 'notifications'
  | 'system'
  | 'appearance';

const CATEGORIES: { id: SettingsCategory; label: string; icon: string; desc: string }[] = [
  { id: 'trading', label: 'Trading', icon: '\u26A1', desc: 'Expiries & sensitivity' },
  { id: 'scanner', label: 'Scanner', icon: '\uD83D\uDCE1', desc: 'Scan cadence & capture targets' },
  { id: 'signals', label: 'Signals', icon: '\uD83D\uDCCA', desc: 'Filtering & threshold rules' },
  { id: 'notifications', label: 'Notifications', icon: '\uD83D\uDD14', desc: 'Audio alerts & desktop popups' },
  { id: 'system', label: 'System', icon: '\u2699', desc: 'Workstation & toolbar controls' },
  { id: 'appearance', label: 'Appearance', icon: '\uD83C\uDFA8', desc: 'Overlay opacity & HUD scale' },
];

const EXPIRY_OPTIONS: { value: ExpiryPreset; label: string }[] = [
  { value: 'auto', label: 'Auto (Smart)' },
  { value: '30s', label: '30 Seconds' },
  { value: '45s', label: '45 Seconds' },
  { value: '1m', label: '1 Minute' },
  { value: '2m', label: '2 Minutes' },
  { value: '3m', label: '3 Minutes' },
  { value: '4m', label: '4 Minutes' },
  { value: '5m', label: '5 Minutes' },
];

const sanitizeSettings = (settings: AppSettings): AppSettings => {
  const supported = new Set(EXPIRY_OPTIONS.map((opt) => opt.value));
  const enabledExpiries = (settings.enabledExpiries || ['auto']).filter((preset) => supported.has(preset));
  return {
    ...settings,
    enabledExpiries: enabledExpiries.length > 0 ? enabledExpiries : ['auto'],
  };
};

const SENSITIVITY_OPTIONS: { value: AppSettings['signalSensitivity']; label: string; desc: string }[] = [
  { value: 'conservative', label: 'Conservative', desc: '75%+ only, fewer but cleaner signals' },
  { value: 'balanced', label: 'Balanced', desc: '65%+ default mix of quality and frequency' },
  { value: 'aggressive', label: 'Aggressive', desc: '58%+ faster signals, more noise possible' },
];

export default function SettingsView({ settings, onUpdate }: SettingsViewProps) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('trading');
  const [localSettings, setLocalSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [savedFlash, setSavedFlash] = useState<boolean>(false);
  const loadedRef = React.useRef<boolean>(false);

  useEffect(() => {
    if (settings && !loadedRef.current) {
      loadedRef.current = true;
      setLocalSettings(sanitizeSettings(settings));
    }
  }, [settings]);

  const saveTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const pendingSaveRef = React.useRef<AppSettings | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const save = (next: AppSettings) => {
    next = sanitizeSettings(next);
    setLocalSettings(next);
    pendingSaveRef.current = next;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      const payload = pendingSaveRef.current;
      if (!payload) return;
      invokeIpc(IPC_INVOKE_CHANNELS.UPDATE_SETTINGS, payload)
        .then(() => {
          onUpdate(payload);
          setSavedFlash(true);
          setTimeout(() => setSavedFlash(false), 1200);
        })
        .catch((err) => {
          console.error('[SETTINGS AUTO-SAVE ERROR]', err);
        });
    }, 100);
  };

  const handleChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    save({ ...localSettings, [key]: value });
  };

  const handleToggleExpiry = (preset: ExpiryPreset) => {
    const current = localSettings.enabledExpiries || ['auto'];
    const isAuto = preset === 'auto';
    let next: ExpiryPreset[];
    if (isAuto) {
      next = ['auto'];
    } else {
      next = current.filter(e => e !== 'auto') as ExpiryPreset[];
      if (next.includes(preset)) {
        next = next.filter(e => e !== preset);
      } else {
        next.push(preset);
      }
      if (next.length === 0) next = ['auto'];
    }
    save({ ...localSettings, enabledExpiries: next });
  };

  const isExpiryActive = (preset: ExpiryPreset) => {
    const enabled = localSettings.enabledExpiries || ['auto'];
    return enabled.includes(preset);
  };

  return (
    <div>
      {/* Settings Header with Auto-Save Badge */}
      <div className="command-center-header" style={{ marginBottom: '20px' }}>
        <div className="header-title-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={{ margin: 0 }}>SYSTEM SETTINGS</h1>
            {savedFlash && (
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--color-emerald)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.5px',
                padding: '3px 8px',
                borderRadius: '4px',
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}>
                AUTO-SAVED &#10004;
              </span>
            )}
          </div>
          <p style={{ margin: '4px 0 0 0' }}>Configure trading behavior, overlay, notifications, and diagnostics</p>
        </div>
      </div>

      {/* Categorized Layout: Sidebar Tabs + Content Area */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '20px' }}>
        {/* Category Navigation Tabs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: isActive ? '1px solid var(--accent-cyan)' : '1px solid var(--glass-border)',
                  background: isActive ? 'rgba(0, 242, 254, 0.1)' : 'rgba(6, 9, 14, 0.4)',
                  color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <span style={{ fontSize: '15px' }}>{cat.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '0.3px' }}>{cat.label}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{cat.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Category Content Panels */}
        <div>
          {/* TRADING CATEGORY */}
          {activeCategory === 'trading' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <GlassPanel auroraBorder>
                <div className="card-header-clean">
                  <div className="card-title-clean">
                    <span style={{ color: 'var(--accent-cyan)' }}>&#9889;</span>
                    <span>TRADE EXPIRY (MULTI-SELECT)</span>
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                  Select one or multiple expiry presets. MARS will evaluate trade setups across enabled horizons.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '14px' }}>
                  {EXPIRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleToggleExpiry(opt.value)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: isExpiryActive(opt.value) ? '2px solid var(--accent-cyan)' : '1px solid var(--glass-border)',
                        background: isExpiryActive(opt.value) ? 'rgba(0, 242, 254, 0.12)' : 'rgba(6, 9, 14, 0.5)',
                        color: isExpiryActive(opt.value) ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        fontFamily: 'var(--font-mono)',
                        textAlign: 'center',
                      }}
                    >
                      {isExpiryActive(opt.value) ? '\u2714 ' : ''}{opt.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px' }}>
                  {localSettings.enabledExpiries?.includes('auto')
                    ? 'Auto Smart Mode: MARS dynamically selects optimal expiry from market structure and volatility.'
                    : `${(localSettings.enabledExpiries || []).length} expiry preset(s) active.`}
                </div>
              </GlassPanel>

              <GlassPanel>
                <div className="card-header-clean">
                  <div className="card-title-clean">
                    <span>SIGNAL SENSITIVITY</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                  {SENSITIVITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleChange('signalSensitivity', opt.value)}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        border: localSettings.signalSensitivity === opt.value ? '2px solid var(--accent-cyan)' : '1px solid var(--glass-border)',
                        background: localSettings.signalSensitivity === opt.value ? 'rgba(0, 242, 254, 0.08)' : 'rgba(6, 9, 14, 0.5)',
                        color: localSettings.signalSensitivity === opt.value ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '13px' }}>{opt.label}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </GlassPanel>

              <GlassPanel>
                <div className="card-header-clean">
                  <div className="card-title-clean">
                    <span>MINIMUM CONFIDENCE TO ALERT</span>
                  </div>
                </div>
                <div className="form-group" style={{ marginTop: '12px' }}>
                  <input
                    type="range"
                    min="20"
                    max="95"
                    step="5"
                    style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
                    value={localSettings.minConfidenceToAlert}
                    onChange={(e) => handleChange('minConfidenceToAlert', parseInt(e.target.value, 10))}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)', marginTop: '4px' }}>
                    <span>20%</span>
                    <span style={{ fontWeight: 700 }}>{localSettings.minConfidenceToAlert}%</span>
                    <span>95%</span>
                  </div>
                </div>
              </GlassPanel>
            </div>
          )}

          {/* SCANNER CATEGORY */}
          {activeCategory === 'scanner' && (
            <GlassPanel>
              <div className="card-header-clean">
                <div className="card-title-clean">
                  <span>SCANNER CADENCE & ACQUISITION</span>
                </div>
              </div>
              <div className="form-group" style={{ marginTop: '14px' }}>
                <label className="form-label">Scan Interval (ms)</label>
                <input
                  type="number"
                  min="500"
                  max="10000"
                  step="250"
                  className="form-input"
                  value={localSettings.scanIntervalMs}
                  onChange={(e) => handleChange('scanIntervalMs', parseInt(e.target.value, 10) || 2000)}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                  Cadence between scanner cycles. The loop self-tunes: slow cycles automatically back off up to 10s so weak CPUs are never pegged.
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '16px' }}>
                <label className="form-label">Signal Cooldown (sec)</label>
                <input
                  type="number"
                  min="0"
                  max="60"
                  step="5"
                  className="form-input"
                  value={localSettings.signalCooldownSec}
                  onChange={(e) => handleChange('signalCooldownSec', Math.max(0, Math.min(60, parseInt(e.target.value, 10) || 0)))}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                  Gap after a signal expires before a new one can form — stops instant weak re-signals right after a signal ends. 0 = off.
                </div>
              </div>

              <div className="toggle-switch" style={{ marginTop: '16px' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px' }}>Image OCR (tesseract.js)</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    CPU-heavy chart-pixel OCR fallback. OFF by default — keep OFF on 4-core machines; DOM scraping already reads the price.
                  </div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={localSettings.enableImageOcr}
                    onChange={(e) => handleChange('enableImageOcr', e.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
            </GlassPanel>
          )}

          {/* SIGNALS CATEGORY */}
          {activeCategory === 'signals' && (
            <GlassPanel>
              <div className="card-header-clean">
                <div className="card-title-clean">
                  <span>SIGNAL RULES & CANDIDATE FILTERING</span>
                </div>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '10px' }}>
                Signal filtering rules prioritize high-confluence setups across market structure, momentum, and multi-indicator agreement.
              </div>
            </GlassPanel>
          )}

          {/* NOTIFICATIONS CATEGORY */}
          {activeCategory === 'notifications' && (
            <GlassPanel>
              <div className="card-header-clean">
                <div className="card-title-clean">
                  <span>AUDIO ALERTS & NOTIFICATIONS</span>
                </div>
              </div>

              <div className="toggle-switch" style={{ marginBottom: '16px', marginTop: '14px' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px' }}>Master Sound</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Enable all trading audio alerts</div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={localSettings.soundEnabled}
                    onChange={(e) => handleChange('soundEnabled', e.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>

              <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '12px' }}>
                  INDEPENDENT SOUND TOGGLES
                </div>

                <div className="toggle-switch" style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--color-emerald)' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>BUY Signal Sound</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Ascending chime on BUY signal</div>
                    </div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={localSettings.soundBuyEnabled}
                      onChange={(e) => handleChange('soundBuyEnabled', e.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>

                <div className="toggle-switch" style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--color-coral)' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>SELL Signal Sound</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Descending chime on SELL signal</div>
                    </div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={localSettings.soundSellEnabled}
                      onChange={(e) => handleChange('soundSellEnabled', e.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>

                <div className="toggle-switch">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--color-amber)' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>WARNING Sound</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Double alert on trade deterioration</div>
                    </div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={localSettings.soundDeteriorationEnabled}
                      onChange={(e) => handleChange('soundDeteriorationEnabled', e.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>
              </div>
            </GlassPanel>
          )}

          {/* SYSTEM CATEGORY */}
          {activeCategory === 'system' && (
            <GlassPanel>
              <div className="card-header-clean">
                <div className="card-title-clean">
                  <span>SYSTEM & WORKSTATION</span>
                </div>
              </div>
              <div className="toggle-switch" style={{ marginTop: '14px' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px' }}>Overlay Enable</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Enable floating HUD overlay windows</div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={localSettings.overlayEnabled}
                    onChange={(e) => handleChange('overlayEnabled', e.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
                <div className="form-group" style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                  <label className="form-label">History Retention (Days)</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    className="form-input"
                    value={localSettings.historyRetentionDays}
                    onChange={(e) => handleChange('historyRetentionDays', parseInt(e.target.value, 10) || 30)}
                  />
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                    Signal history logs are retained in local SQLite database for this period.
                  </div>
                </div>

              </GlassPanel>
          )}

          {/* APPEARANCE CATEGORY */}
          {activeCategory === 'appearance' && (
            <GlassPanel>
              <div className="card-header-clean">
                <div className="card-title-clean">
                  <span>APPEARANCE & HUD</span>
                </div>
              </div>
              <div className="form-group" style={{ marginTop: '14px' }}>
                <label className="form-label">Overlay Glass Opacity</label>
                <input
                  type="range"
                  min="0.5"
                  max="1.0"
                  step="0.05"
                  style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
                  value={localSettings.overlayOpacity}
                  onChange={(e) => handleChange('overlayOpacity', parseFloat(e.target.value))}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)', marginTop: '4px' }}>
                  <span>50%</span>
                  <span style={{ fontWeight: 700 }}>{Math.round(localSettings.overlayOpacity * 100)}%</span>
                  <span>100%</span>
                </div>
              </div>
            </GlassPanel>
          )}
        </div>
      </div>
    </div>
  );
}
