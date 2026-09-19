import { useState, useEffect, useRef, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useSentinelSocket } from './hooks/useSentinelSocket'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATE_COLOR = {
  NORMAL: '#2ECC71',
  WATCH: '#F1C40F',
  CRITICAL: '#E74C3C',
}

const C = {
  bg: '#060D1B',
  card: '#0B1525',
  cardAlt: '#0E1B2E',
  border: '#152130',
  borderBright: '#1C3050',
  ink: '#C0D4EC',
  dim: '#5A7592',
  ghost: '#3A5270',
  data: '#E4F0FF',
  blue: '#2E86C1',
  purple: '#8E44AD',
  orange: '#D35400',
}

const MAX_PTS = 42
let _logId = 10

const SITE_META = {
  site: 'Alpha-3',
  depth: '312 m',
  zone: 'Level-7B',
  operator: 'Sentinel Control',
  location: 'Dhanbad, Jharkhand',
}

// Dhanbad, Jharkhand — major coal mining region in India
const MINE_LOCATION = { lat: 23.7957, lng: 86.4304 }



function nowStr() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Kolkata' })
}
function tsFor(d) {
  return d.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Kolkata' })
}


// ─── Chart tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
      background: '#0B1525', border: `1px solid ${C.borderBright}`,
      borderRadius: 4, padding: '6px 10px', lineHeight: 1.6,
    }}>
      <div style={{ color: C.ghost, marginBottom: 2, fontSize: 9 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: <span style={{ color: C.data }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Chart card ───────────────────────────────────────────────────────────────

function ChartCard({ title, data, lines, unit, yDomain, y2Domain, latestValue, yAxisWidth, y2AxisWidth, style }) {
  const dual = !!y2Domain
  const latest = data[data.length - 1]
  const hasData = data.length > 0

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '10px 12px 6px',
      display: 'flex', flexDirection: 'column', gap: 6,
      ...style
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, fontWeight: 600,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: C.dim,
        }}>
          {title}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lines.map(l => (
            <span key={l.key} style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: l.color,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{ display: 'inline-block', width: 12, height: 2, background: l.color, borderRadius: 1 }} />
              {l.name}
            </span>
          ))}
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600,
            color: lines[0].color,
          }}>
            {latestValue ?? (latest ? String(latest.v) : '—')}
          </span>
        </div>
      </div>

      {hasData ? (
        <ResponsiveContainer width="100%" height={104}>
          <LineChart data={data} margin={{ top: 2, right: dual ? 6 : 4, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="1 4" stroke={C.border} vertical={false} />
            <XAxis
              dataKey="t"
              tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: C.ghost }}
              tickLine={false}
              axisLine={{ stroke: C.border }}
              interval={Math.floor(MAX_PTS / 4)}
            />
            {dual ? (
              <>
                <YAxis
                  yAxisId="left"
                  domain={yDomain || ['auto', 'auto']}
                  tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: C.ghost }}
                  tickLine={false}
                  axisLine={false}
                  width={yAxisWidth ?? 44}
                  tickCount={4}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={y2Domain}
                  tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: C.ghost }}
                  tickLine={false}
                  axisLine={false}
                  width={y2AxisWidth ?? 28}
                  tickCount={4}
                />
              </>
            ) : (
              <YAxis
                domain={yDomain || ['auto', 'auto']}
                tick={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fill: C.ghost }}
                tickLine={false}
                axisLine={false}
                width={yAxisWidth ?? 44}
                tickCount={4}
              />
            )}
            <Tooltip content={<ChartTooltip />} />
            {lines.map(l => (
              <Line
                key={l.key}
                type="monotone"
                dataKey={l.key}
                name={l.name}
                stroke={l.color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                yAxisId={dual ? (l.yAxisId || 'left') : undefined}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div style={{
          height: 104, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px dashed ${C.border}`, borderRadius: 4,
        }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: C.ghost, letterSpacing: '0.08em',
          }}>
            Awaiting data…
          </span>
        </div>
      )}

      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 8,
        color: C.ghost, textAlign: 'right', letterSpacing: '0.05em',
      }}>
        {unit}
      </div>
    </div>
  )
}

// ─── Status card ──────────────────────────────────────────────────────────────

const STATE_DESC = {
  NORMAL: 'All parameters within operational thresholds. No intervention required.',
  WATCH: 'One or more sensors approaching alert threshold. Heightened monitoring active.',
  CRITICAL: 'Threshold exceeded. Immediate inspection and escalation required.',
}

const SENSOR_ROWS = [
  { label: 'ACCELEROMETER', ok: (s) => s === 'NORMAL' },
  { label: 'ACOUSTIC MIC', ok: (s) => s === 'NORMAL' },
  { label: 'BAROMETRIC', ok: (s) => s !== 'CRITICAL' },
  { label: 'THERMISTOR', ok: () => true },
  { label: 'LOAD CELL', ok: (s) => s === 'NORMAL' },
  { label: 'CAMERA LINK', ok: () => true },
]

function StatusCard({ state, onStateChange, manualOverride, onSetOverride }) {
  const color = STATE_COLOR[state]
  const glowClass = state === 'WATCH' ? 'pulse-watch' : state === 'CRITICAL' ? 'pulse-critical' : ''

  return (
    <div
      className={glowClass}
      style={{
        background: C.card,
        border: `1px solid ${state !== 'NORMAL' ? color + '44' : C.border}`,
        borderRadius: 8, padding: '14px 14px 12px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* Left accent strip */}
      <div style={{
        position: 'absolute', top: 0, left: 0, width: 3, height: '100%',
        background: color, opacity: state === 'NORMAL' ? 0.45 : 0.9,
      }} />

      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, fontWeight: 600,
        letterSpacing: '0.2em', textTransform: 'uppercase', color: C.dim,
        alignSelf: 'flex-start', paddingLeft: 10,
      }}>
        System Status
      </div>

      {/* Circular status orb */}
      <div style={{
        width: 96, height: 96, borderRadius: '50%',
        border: `2px solid ${color}`,
        background: color + '0F',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: state !== 'NORMAL' ? `0 0 18px ${color}38, inset 0 0 16px ${color}08` : 'none',
      }}>
        <div style={{
          width: 58, height: 58, borderRadius: '50%',
          border: `1px solid ${color}40`,
          background: color + '14',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {state === 'NORMAL' ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17l-5-5" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : state === 'WATCH' ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 9v4m0 4h.01" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" />
              <path d="M12 8v4m0 4h.01" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          )}
        </div>
      </div>

      {/* State label */}
      <div style={{ textAlign: 'center', lineHeight: 1 }}>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 30, fontWeight: 800,
          letterSpacing: '0.18em', color, textTransform: 'uppercase',
        }}>
          {state}
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 8,
          color: C.ghost, letterSpacing: '0.12em', marginTop: 4,
        }}>
          SYSTEM STATE
        </div>
      </div>

      <div style={{ width: '100%', height: 1, background: C.border }} />

      {/* Sensor rows */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 7, paddingLeft: 10 }}>
        {SENSOR_ROWS.map(({ label, ok }) => {
          const isOk = ok(state)
          const dotColor = isOk ? '#2ECC71' : state === 'WATCH' ? '#F1C40F' : '#E74C3C'
          const statusText = isOk ? 'OK' : state === 'WATCH' ? 'WARN' : 'FAULT'
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: dotColor,
                boxShadow: isOk ? `0 0 5px ${dotColor}80` : undefined,
                flexShrink: 0,
              }} />
              <span style={{
                fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 500,
                letterSpacing: '0.1em', color: C.dim, flex: 1,
              }}>
                {label}
              </span>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 600,
                color: dotColor, marginRight: 2,
              }}>
                {statusText}
              </span>
            </div>
          )
        })}
      </div>

      <div style={{ width: '100%', height: 1, background: C.border }} />

      <div style={{
        fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, fontWeight: 300,
        color: '#4A6080', lineHeight: 1.55, paddingLeft: 10, paddingRight: 4,
        alignSelf: 'flex-start',
      }}>
        {STATE_DESC[state]}
      </div>

      {/* Demo state override — holds state until "Resume Live" is clicked */}
      <div style={{ width: '100%', paddingLeft: 10, paddingRight: 4 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          marginBottom: 5,
        }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke={manualOverride ? '#F1C40F' : '#3A5270'} strokeWidth="2.5" strokeLinecap="round" />
            <path d="M12 9v4m0 4h.01" stroke={manualOverride ? '#F1C40F' : '#3A5270'} strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontSize: 8, fontWeight: 600,
            letterSpacing: '0.16em', textTransform: 'uppercase',
            color: manualOverride ? '#F1C40F' : '#3A5270',
          }}>
            {manualOverride ? 'Override Active' : 'Force Test State'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {['NORMAL', 'WATCH', 'CRITICAL'].map((s) => (
            <button
              key={s}
              onClick={() => {
                onStateChange(s)
                onSetOverride(true)
              }}
              style={{
                flex: 1, padding: '5px 0',
                fontFamily: "'Barlow Condensed', sans-serif", fontSize: 9, fontWeight: 700,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                border: `1px solid ${state === s ? STATE_COLOR[s] : C.borderBright}`,
                borderRadius: 4, cursor: 'pointer',
                background: state === s ? STATE_COLOR[s] + '1A' : 'transparent',
                color: state === s ? STATE_COLOR[s] : C.ghost,
                transition: 'all 0.15s',
              }}
            >
              {s.slice(0, 4)}
            </button>
          ))}
        </div>
        {manualOverride && (
          <button
            onClick={() => onSetOverride(false)}
            style={{
              width: '100%', marginTop: 5, padding: '5px 0',
              fontFamily: "'Barlow Condensed', sans-serif", fontSize: 9, fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              border: `1px solid ${C.blue}`,
              borderRadius: 4, cursor: 'pointer',
              background: C.blue + '1A',
              color: C.blue,
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
              <polygon points="5,3 19,12 5,21" fill={C.blue} />
            </svg>
            Resume Live
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Event log ────────────────────────────────────────────────────────────────

const LEVEL_COLOR = {
  info: C.dim,
  warn: '#F1C40F',
  critical: '#E74C3C',
}

function EventLog({ entries }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '9px 12px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
      }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke={C.dim} strokeWidth="1.8" />
          <path d="M8 9h8M8 13h8M8 17h5" stroke={C.dim} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 600,
          letterSpacing: '0.16em', textTransform: 'uppercase', color: C.dim,
        }}>
          Event Log
        </span>
        <span style={{
          marginLeft: 'auto',
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: C.ghost,
        }}>
          {entries.length} entries
        </span>
      </div>

      {/* Scrollable entries */}
      <div className="sentinel-log" style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {entries.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', minHeight: 60,
          }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              color: C.ghost, letterSpacing: '0.08em',
            }}>
              No events recorded
            </span>
          </div>
        ) : entries.map((e) => (
          <div
            key={e.id}
            style={{
              padding: '5px 10px 5px 12px',
              borderBottom: `1px solid ${C.bg}`,
              display: 'flex', gap: 8, alignItems: 'flex-start',
            }}
          >
            {/* Level strip */}
            <div style={{
              width: 2, borderRadius: 1,
              background: LEVEL_COLOR[e.level],
              alignSelf: 'stretch', flexShrink: 0, minWidth: 2,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                color: C.ghost, marginBottom: 2,
              }}>
                {e.ts}
              </div>
              <div style={{
                fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11,
                color: e.level === 'info' ? '#8AA4BE' : LEVEL_COLOR[e.level],
                lineHeight: 1.45, wordBreak: 'break-word',
              }}>
                {e.msg}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ─── Top bar ─────────────────────────────────────────────────────────────────

function TopBar({ state, nodeId, connected, lastUpdateAgo, manualOverride, dataSource }) {
  const [clock, setClock] = useState(nowStr())

  useEffect(() => {
    const t = setInterval(() => setClock(nowStr()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '0 18px',
      background: C.card, borderBottom: `1px solid ${C.border}`,
      height: 52, flexShrink: 0,
    }}>
      {/* Logo + title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7l10 5 10-5-10-5z" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2 17l10 5 10-5" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2 12l10 5 10-5" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 17, fontWeight: 700,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ink,
        }}>
          Sentinel
        </span>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, fontWeight: 400,
          letterSpacing: '0.06em', color: C.ghost, marginTop: 1,
        }}>
          — Mine Subsidence Monitor
        </span>
      </div>

      <div style={{ flex: 1 }} />

      {/* Connection dot + data source indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          className={connected ? 'dot-online' : ''}
          style={{
            width: 7, height: 7, borderRadius: '50%',
            background: connected ? '#2ECC71' : '#E74C3C',
            boxShadow: `0 0 6px ${connected ? '#2ECC71' : '#E74C3C'}`,
          }}
        />
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 600,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: connected ? '#2ECC71' : '#E74C3C',
        }}>
          {connected
            ? (dataSource === 'ws' ? 'Live (WS)' : 'Live (Poll)')
            : 'Offline'
          }
        </span>
        {!connected && lastUpdateAgo !== null && (
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
            color: '#E74C3C', opacity: 0.7,
          }}>
            {lastUpdateAgo}s ago
          </span>
        )}
      </div>

      {manualOverride && (
        <div style={{
          padding: '3px 8px', borderRadius: 3,
          border: '1px solid #F1C40F50',
          background: '#F1C40F18',
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 9, fontWeight: 700,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: '#F1C40F',
        }}>
          Override
        </div>
      )}

      <div style={{ width: 1, height: 22, background: C.border }} />

      {/* Clock */}
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#8AA4BE',
        letterSpacing: '0.04em',
      }}>
        {clock} IST
      </span>

      <div style={{ width: 1, height: 22, background: C.border }} />

      {/* Node ID */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: C.ink }}>
          {nodeId}
        </span>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 8,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: C.ghost,
        }}>
          Site Node
        </span>
      </div>

      <div style={{ width: 1, height: 22, background: C.border }} />

      {/* Current state badge */}
      <div style={{
        padding: '4px 11px', borderRadius: 4,
        border: `1px solid ${STATE_COLOR[state]}50`,
        background: STATE_COLOR[state] + '18',
        fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, fontWeight: 700,
        letterSpacing: '0.16em', textTransform: 'uppercase',
        color: STATE_COLOR[state],
      }}>
        {state}
      </div>
    </div>
  )
}

function BottomBar({ camTimestamp, onSendAlert, riskScore, riskLabel, uptime, camConnected, mlEngine }) {
  const [alertState, setAlertState] = useState('idle') // idle | sending | success | error
  const [camError, setCamError] = useState(false)
  const [camKey, setCamKey] = useState(0)

  const handleAlert = async () => {
    if (alertState === 'sending') return
    setAlertState('sending')
    const success = await onSendAlert()
    setAlertState(success ? 'success' : 'error')
    setTimeout(() => setAlertState('idle'), 3000)
  }

  // Refresh camera image every 10 seconds
  useEffect(() => {
    const t = setInterval(() => {
      setCamError(false)
      setCamKey((k) => k + 1)
    }, 10000)
    return () => clearInterval(t)
  }, [])

  const riskVal = parseFloat(riskScore) || 0
  const riskColor = riskVal < 0.3 ? '#2ECC71' : riskVal < 0.6 ? '#F1C40F' : '#E74C3C'
  const filledBars = Math.max(1, Math.min(10, Math.round(riskVal * 10)))

  const META = [
    { label: 'SITE', value: SITE_META.site },
    { label: 'LOCATION', value: SITE_META.location },
    { label: 'DEPTH', value: SITE_META.depth },
    { label: 'ZONE', value: SITE_META.zone },
    { label: 'OPERATOR', value: SITE_META.operator },
    { label: 'UPTIME', value: uptime || '—' },
  ]

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px',
      background: C.card, borderTop: `1px solid ${C.border}`,
      height: 84, flexShrink: 0,
    }}>
      {/* Camera label */}
      <span style={{
        fontFamily: "'Barlow Condensed', sans-serif", fontSize: 10, fontWeight: 600,
        letterSpacing: '0.16em', textTransform: 'uppercase', color: C.dim, flexShrink: 0,
      }}>
        Latest Capture
      </span>

      {/* Camera thumbnail — live from backend, fallback to SVG placeholder */}
      <div style={{
        position: 'relative', borderRadius: 5, overflow: 'hidden',
        border: `1px solid ${C.borderBright}`, height: 60, width: 107, flexShrink: 0,
        background: '#040A14',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {!camError ? (
          <img
            key={camKey}
            src={`http://localhost:5000/api/camera?t=${camKey}`}
            alt="Site camera"
            onError={() => setCamError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke={C.ghost} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="4" stroke={C.ghost} strokeWidth="1.5" />
            </svg>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 7,
              color: C.ghost, letterSpacing: '0.1em',
            }}>
              NO FEED
            </span>
          </div>
        )}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '2px 5px',
          background: 'rgba(6, 13, 27, 0.88)',
          fontFamily: "'JetBrains Mono', monospace", fontSize: 7, color: C.dim,
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>{camTimestamp}</span>
          <span style={{ color: camConnected ? '#2ECC71' : C.ghost }}>
            {camConnected ? '●' : '○'} CAM-04
          </span>
        </div>
      </div>

      <div style={{ width: 1, height: 40, background: C.border, flexShrink: 0 }} />

      {/* Meta info */}
      {META.map(({ label, value }) => (
        <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
          <span style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontSize: 8, fontWeight: 600,
            letterSpacing: '0.16em', textTransform: 'uppercase', color: C.ghost,
          }}>
            {label}
          </span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#8AA4BE',
          }}>
            {value}
          </span>
        </div>
      ))}

      <div style={{ flex: 1 }} />

      {/* ML Engine status indicator */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 8, fontWeight: 600,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: C.ghost,
        }}>
          ML Engine
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: mlEngine === 'online' ? '#2ECC71' : mlEngine === 'offline' ? '#E74C3C' : '#F1C40F',
            boxShadow: mlEngine === 'online' ? '0 0 6px #2ECC7180' : 'none',
          }} />
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
            color: mlEngine === 'online' ? '#2ECC71' : mlEngine === 'offline' ? '#E74C3C' : '#F1C40F',
          }}>
            {mlEngine === 'online' ? 'Isolation Forest' : mlEngine === 'offline' ? 'Offline' : 'Connecting...'}
          </span>
        </div>
      </div>

      <div style={{ width: 1, height: 40, background: C.border, flexShrink: 0 }} />

      {/* Subsidence risk meter — dynamic from backend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 8, fontWeight: 600,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: C.ghost,
        }}>
          Risk Index
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
            const lit = n <= filledBars
            const barColor = n <= 3 ? '#2ECC71' : n <= 6 ? '#F1C40F' : '#E74C3C'
            return (
              <div key={n} style={{
                width: 6, height: 16, borderRadius: 2,
                background: lit ? barColor : (n <= 3 ? '#1A3A26' : n <= 6 ? '#3A2E0A' : '#3A1010'),
                border: `1px solid ${lit ? barColor + '40' : C.border}`,
              }} />
            )
          })}
        </div>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: riskColor }}>
          {riskLabel || 'LOW'} — {riskScore || '0.00'}
        </span>
      </div>

      <div style={{ width: 1, height: 40, background: C.border, flexShrink: 0 }} />

      {/* SMS alert button */}
      <button
        onClick={handleAlert}
        disabled={alertState === 'sending'}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '8px 18px',
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, fontWeight: 700,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          border: alertState === 'success' ? '1px solid #2ECC71' : alertState === 'error' ? '1px solid #E74C3C' : alertState === 'sending' ? '1px solid #F1C40F' : '1px solid #E74C3C',
          borderRadius: 6, cursor: alertState === 'sending' ? 'not-allowed' : 'pointer',
          background: alertState === 'success' ? '#2ECC7118' : alertState === 'error' ? '#E74C3C18' : alertState === 'sending' ? '#F1C40F18' : 'transparent',
          color: alertState === 'success' ? '#2ECC71' : alertState === 'error' ? '#E74C3C' : alertState === 'sending' ? '#F1C40F' : '#E74C3C',
          transition: 'all 0.25s',
          flexShrink: 0,
          opacity: alertState === 'sending' ? 0.7 : 1,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.52 12 19.79 19.79 0 011.2 3.37 2 2 0 013.18 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {alertState === 'sending' ? 'Sending...' : alertState === 'success' ? 'SMS sent successfully' : alertState === 'error' ? 'SMS failed' : 'Send Test Alert (SMS)'}
      </button>
    </div>
  )
}

// ─── App ─────────────────────────────────────────────────────────────────────

function createLogFromTelemetry(data, id) {
  if (data.type === 'sms') {
    return {
      id,
      ts: tsFor(new Date(data.timestamp)),
      msg: data.msg,
      level: data.level,
    }
  }

  const time = tsFor(new Date(data.timestamp))

  if (data.status === 'CRITICAL') {
    return {
      id,
      ts: time,
      msg: `CRITICAL sensor reading — vibration ${data.vibration}G`,
      level: 'critical',
    }
  }

  if (data.status === 'WATCH') {
    return {
      id,
      ts: time,
      msg: `Sensor reading requires monitoring — vibration ${data.vibration}G`,
      level: 'warn',
    }
  }

  return {
    id,
    ts: time,
    msg: `Sensors nominal — vibration ${data.vibration}G, pressure ${data.pressure} mbar`,
    level: 'info',
  }
}

// ─── GIS Map Panel ────────────────────────────────────────────────────────────

const MAP_CONTAINER = { width: '100%', height: '100%' }



function MapCard({ state }) {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const markerColor = STATE_COLOR[state] || '#2ECC71'

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Offline fallback
  if (!isOnline) {
    return (
      <div style={{
        background: C.card, borderRadius: 8,
        border: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 8, height: '100%', minHeight: 180, gridColumn: '1 / -1',
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" stroke={C.ghost} strokeWidth="1.5" />
          <circle cx="12" cy="10" r="3" stroke={C.ghost} strokeWidth="1.5" />
        </svg>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11, fontWeight: 600,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: C.ghost,
        }}>
          Map unavailable \u2014 offline mode
        </span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: C.dim }}>
          {MINE_LOCATION.lat.toFixed(4)}°N, {MINE_LOCATION.lng.toFixed(4)}°E
        </span>
      </div>
    )
  }

  // Custom marker icon using L.divIcon to support dynamic colors
  const markerHtml = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="${markerColor}" stroke="#060D1B" stroke-width="1.5">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"/>
    </svg>
  `
  const customIcon = L.divIcon({
    html: markerHtml,
    className: 'custom-leaflet-marker',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  })

  return (
    <div style={{
      background: C.card, borderRadius: 8, border: `1px solid ${C.border}`,
      overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 180, gridColumn: '1 / -1',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px', borderBottom: `1px solid ${C.border}`, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, fontWeight: 700,
            letterSpacing: '0.10em', textTransform: 'uppercase', color: C.ink,
          }}>
            Site Location
          </span>
        </div>
        <span style={{
          padding: '2px 8px', borderRadius: 3, border: `1px solid ${markerColor}50`,
          background: markerColor + '18', fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
          color: markerColor,
        }}>
          MN-04 · {state}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <MapContainer 
          center={[MINE_LOCATION.lat, MINE_LOCATION.lng]} 
          zoom={13} 
          style={MAP_CONTAINER}
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <Marker position={[MINE_LOCATION.lat, MINE_LOCATION.lng]} icon={customIcon}>
            <Popup>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#1a1a1a', minWidth: 160 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, fontWeight: 700 }}>MN-04 — {SITE_META.site}</div>
                <div>Depth: {SITE_META.depth}</div>
                <div>Zone: {SITE_META.zone}</div>
                <div>Operator: {SITE_META.operator}</div>
                <div style={{ marginTop: 4, fontWeight: 700, color: state === 'CRITICAL' ? '#c0392b' : state === 'WATCH' ? '#d4a017' : '#27ae60' }}>
                  Status: {state}
                </div>
              </div>
            </Popup>
          </Marker>
        </MapContainer>
        {/* Unobtrusive attribution */}
        <div style={{
          position: 'absolute', bottom: 2, right: 4, zIndex: 1000,
          fontFamily: 'sans-serif', fontSize: 9, color: '#5A7592', pointerEvents: 'none'
        }}>
          © OpenStreetMap contributors
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [systemState, setSystemState] = useState('NORMAL')
  const [connected, setConnected] = useState(false)
  const [vibData, setVibData] = useState([])
  const [acoData, setAcoData] = useState([])
  const [envData, setEnvData] = useState([])
  const [logEntries, setLogEntries] = useState([])
  const [camTs, setCamTs] = useState(nowStr)
  const [manualOverride, setManualOverride] = useState(false)
  const [lastUpdateAgo, setLastUpdateAgo] = useState(null)
  const [riskScore, setRiskScore] = useState('0.00')
  const [riskLabel, setRiskLabel] = useState('LOW')
  const [serverStart, setServerStart] = useState(null)
  const [uptimeStr, setUptimeStr] = useState('—')
  const [camConnected, setCamConnected] = useState(false)
  const [mlEngine, setMlEngine] = useState('connecting') // 'online' | 'offline' | 'connecting'

  // ─── WebSocket hook (primary data source) ─────────────────────────────────
  const { wsConnected, wsFailed, latestData: wsData, dataSource } = useSentinelSocket()

  const stateRef = useRef('NORMAL')
  useEffect(() => { stateRef.current = systemState }, [systemState])

  const manualOverrideRef = useRef(false)
  useEffect(() => { manualOverrideRef.current = manualOverride }, [manualOverride])

  const lastFetchRef = useRef(0)

  // Staleness check — every 1s, check if last successful fetch was >5s ago
  useEffect(() => {
    const t = setInterval(() => {
      if (lastFetchRef.current === 0) return
      const elapsed = Math.floor((Date.now() - lastFetchRef.current) / 1000)
      if (elapsed > 5) {
        setConnected(false)
        setLastUpdateAgo(elapsed)
      } else {
        setLastUpdateAgo(null)
      }
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const addLog = useCallback((msg, level) => {
    setLogEntries((prev) => [...prev.slice(-149), { id: ++_logId, ts: nowStr(), msg, level }])
  }, [])

  // ─── ML Engine health check ──────────────────────────────────────────────────
  useEffect(() => {
    const checkMl = async () => {
      try {
        const res = await fetch('http://localhost:5000/api/ml-status', {
          signal: AbortSignal.timeout(2000),
        })
        if (res.ok) {
          const data = await res.json()
          setMlEngine(data.online ? 'online' : 'offline')
        } else {
          setMlEngine('offline')
        }
      } catch {
        setMlEngine('offline')
      }
    }
    checkMl()
    const t = setInterval(checkMl, 5000)
    return () => clearInterval(t)
  }, [])

  // ─── Shared function: apply a telemetry data object to all chart/state vars ─
  const applyTelemetry = useCallback((data) => {
    const t = tsFor(new Date(data.timestamp))

    lastFetchRef.current = Date.now()
    setConnected(true)
    setLastUpdateAgo(null)
    setCamConnected(true)

    if (data.risk_score != null) setRiskScore(String(data.risk_score))
    if (data.risk_label) setRiskLabel(data.risk_label)
    if (data.server_start) setServerStart(data.server_start)

    // Track ML engine status from telemetry response
    if (data.ml) {
      setMlEngine(data.ml.engine === 'online' ? 'online' : 'offline')
    }

    // Use ML-determined status, skip PENDING
    if (!manualOverrideRef.current && data.status && data.status !== 'PENDING') {
      setSystemState(data.status)
    }

    setVibData((prev) => [
      ...prev.slice(-(MAX_PTS - 1)),
      { t, v: Number(data.vibration) },
    ])

    setAcoData((prev) => [
      ...prev.slice(-(MAX_PTS - 1)),
      { t, v: Number(data.acoustic) },
    ])

    setEnvData((prev) => [
      ...prev.slice(-(MAX_PTS - 1)),
      {
        t,
        v: Number(data.pressure),
        v2: Number(data.temperature),
      },
    ])
  }, [])

  // ─── Dynamic Uptime Calculator ───────────────────────────────────────────────
  useEffect(() => {
    if (!serverStart) return
    const calcUptime = () => {
      const ms = Date.now() - serverStart
      const d = Math.floor(ms / 86400000)
      const h = Math.floor((ms % 86400000) / 3600000)
      setUptimeStr(`${d}d ${h}h`)
    }
    calcUptime() // run immediately
    const interval = setInterval(calcUptime, 60000) // update every minute
    return () => clearInterval(interval)
  }, [serverStart])

  // ─── WebSocket data processor (primary data path) ──────────────────────────
  useEffect(() => {
    if (wsData) {
      applyTelemetry(wsData)
    }
  }, [wsData, applyTelemetry])

  // ─── REST polling fallback (activates only when WebSocket has failed) ──────
  useEffect(() => {
    // If WS is connected or still trying to connect, don't start polling
    if (!wsFailed) return

    console.log('[Sentinel] WebSocket unavailable — activating REST polling fallback')

    const fetchTelemetry = async () => {
      try {
        const response = await fetch('http://localhost:5000/api/telemetry')

        if (!response.ok) {
          throw new Error('Failed to fetch telemetry')
        }

        const data = await response.json()
        applyTelemetry(data)
      } catch (error) {
        console.error('Telemetry fetch failed:', error)
        setConnected(false)
        setCamConnected(false)
      }
    }

    fetchTelemetry()

    const interval = setInterval(fetchTelemetry, 2000)

    return () => clearInterval(interval)
  }, [wsFailed, applyTelemetry])

  // Camera timestamp — every 30 s
  useEffect(() => {
    const t = setInterval(() => setCamTs(nowStr()), 30000)
    return () => clearInterval(t)
  }, [])

  // Log state transitions
  const prevStateRef = useRef(systemState)
  useEffect(() => {
    if (prevStateRef.current !== systemState) {
      addLog(
        `System state changed: ${prevStateRef.current} → ${systemState}`,
        systemState === 'NORMAL' ? 'info' : systemState === 'WATCH' ? 'warn' : 'critical',
      )
      prevStateRef.current = systemState
    }
  }, [systemState, addLog])

  // Fetch event history from backend
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await fetch('http://localhost:5000/api/events')

        if (!response.ok) {
          throw new Error('Failed to fetch events')
        }

        const data = await response.json()

        const logs = data.map((item, index) =>
          createLogFromTelemetry(item, index + 1)
        )

        setLogEntries(logs)
      } catch (error) {
        console.error('Events fetch failed:', error)
      }
    }

    fetchEvents()

    const interval = setInterval(fetchEvents, 2000)

    return () => clearInterval(interval)
  }, [])

  const handleSendAlert = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:5000/api/test-alert', {
        method: 'POST',
      })
      const result = await response.json()
      
      if (result.success) {
        addLog(result.message, 'warn')
        return true
      } else {
        addLog(result.message || 'Alert dispatch failed', 'critical')
        return false
      }
    } catch (error) {
      addLog('Alert dispatch failed', 'critical')
      return false
    }
  }, [addLog])

  // Latest values for chart headers
  const lastVib = vibData[vibData.length - 1]?.v
  const lastAco = acoData[acoData.length - 1]?.v
  const lastEnv = envData[envData.length - 1]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: C.bg, overflow: 'hidden',
    }}>
      <TopBar state={systemState} nodeId="MN-04" connected={connected} lastUpdateAgo={lastUpdateAgo} manualOverride={manualOverride} dataSource={dataSource} />

      <main style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: '244px 1fr 260px',
        gap: 9, padding: 9, overflow: 'hidden',
        minHeight: 0,
      }}>
        {/* Left \u2014 Status card */}
        <StatusCard state={systemState} onStateChange={setSystemState} manualOverride={manualOverride} onSetOverride={setManualOverride} />

        {/* Center — 2×3 grid (charts + map) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr 1fr',
          gap: 9, minHeight: 0,
        }}>
          <ChartCard
            title="Ground Vibration"
            data={vibData}
            lines={[{ key: 'v', color: '#3A85D0', name: 'G-force', yAxisId: 'left' }]}
            unit="Accelerometer (G)"
            yDomain={[0, 0.30]}
            latestValue={lastVib !== undefined ? `${lastVib.toFixed(4)} G` : '\u2014'}
          />
          <ChartCard
            title="Acoustic Signature"
            data={acoData}
            lines={[{ key: 'v', color: '#9B59B6', name: 'dB SPL', yAxisId: 'left' }]}
            unit="Microphone (dB SPL)"
            yDomain={[35, 100]}
            latestValue={lastAco !== undefined ? `${lastAco} dB` : '\u2014'}
          />
          <ChartCard
            title="Environmental Trend"
            data={envData}
            lines={[
              { key: 'v', color: '#2ECC71', name: 'mbar', yAxisId: 'left' },
              { key: 'v2', color: '#F1C40F', name: '\u00B0C', yAxisId: 'right' },
            ]}
            unit="Barometer & Temp"
            yDomain={[1005, 1025]}
            y2Domain={[10, 40]}
            latestValue={lastEnv !== undefined ? `${lastEnv.v} mbar \u00B7 ${lastEnv.v2}\u00B0C` : '\u2014'}
            yAxisWidth={50}
            y2AxisWidth={26}
            style={{ gridColumn: '1 / -1' }}
          />
          <MapCard state={systemState} />
        </div>

        {/* Right \u2014 Event log */}
        <EventLog entries={logEntries} />
      </main>

      <BottomBar
        camTimestamp={camTs}
        onSendAlert={handleSendAlert}
        riskScore={riskScore}
        riskLabel={riskLabel}
        uptime={uptimeStr}
        camConnected={camConnected}
        mlEngine={mlEngine}
      />
    </div>
  )
}
