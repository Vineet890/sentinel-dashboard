import { useState, useEffect, useRef, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────────────

export type SystemState = 'NORMAL' | 'WATCH' | 'CRITICAL'

export interface DataPoint { t: string; v: number; v2?: number }

export interface LogEntry {
  id: number
  ts: string
  msg: string
  level: 'info' | 'warn' | 'critical'
}
export interface Telemetry {
  timestamp: string
  vibration: string
  acoustic: string
  pressure: string
  temperature: string
  strain: string
  status: SystemState
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATE_COLOR: Record<SystemState, string> = {
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

function nowStr() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}
function tsFor(d: Date) {
  return d.toLocaleTimeString('en-GB', { hour12: false })
}

// ─── Data generators ─────────────────────────────────────────────────────────

function nextVib(state: SystemState, prev: number) {
  const base = state === 'NORMAL' ? 0.021 : state === 'WATCH' ? 0.083 : 0.192
  const spread = state === 'NORMAL' ? 0.011 : state === 'WATCH' ? 0.034 : 0.072
  return +Math.max(0.001, prev * 0.88 + base * 0.12 + (Math.random() - 0.5) * spread).toFixed(4)
}

function nextAco(state: SystemState) {
  const base = state === 'NORMAL' ? 51 : state === 'WATCH' ? 69 : 85
  const spread = state === 'NORMAL' ? 7 : state === 'WATCH' ? 12 : 16
  return +(base + (Math.random() - 0.5) * spread).toFixed(1)
}

function nextPressure(prev: number) {
  return +Math.max(1007, Math.min(1023, prev + (Math.random() - 0.5) * 0.45)).toFixed(1)
}

function nextTemp(prev: number) {
  return +Math.max(17, Math.min(27, prev + (Math.random() - 0.5) * 0.11)).toFixed(1)
}

function nextStrain(state: SystemState, prev: number) {
  const base = state === 'NORMAL' ? 891 : state === 'WATCH' ? 943 : 989
  const spread = state === 'NORMAL' ? 9 : state === 'WATCH' ? 23 : 40
  return +Math.max(800, Math.min(1250, prev * 0.9 + base * 0.1 + (Math.random() - 0.5) * spread)).toFixed(1)
}

function buildVib(): DataPoint[] {
  let v = 0.021
  return Array.from({ length: MAX_PTS }, (_, i) => {
    v = nextVib('NORMAL', v)
    return { t: tsFor(new Date(Date.now() - (MAX_PTS - i) * 1000)), v }
  })
}

function buildAco(): DataPoint[] {
  return Array.from({ length: MAX_PTS }, (_, i) => ({
    t: tsFor(new Date(Date.now() - (MAX_PTS - i) * 1000)),
    v: nextAco('NORMAL'),
  }))
}

function buildEnv(): DataPoint[] {
  let p = 1013.5, tp = 21.3
  return Array.from({ length: MAX_PTS }, (_, i) => {
    p = nextPressure(p)
    tp = nextTemp(tp)
    return { t: tsFor(new Date(Date.now() - (MAX_PTS - i) * 1000)), v: p, v2: tp }
  })
}

function buildStrain(): DataPoint[] {
  let s = 891
  return Array.from({ length: MAX_PTS }, (_, i) => {
    s = nextStrain('NORMAL', s)
    return { t: tsFor(new Date(Date.now() - (MAX_PTS - i) * 1000)), v: s }
  })
}

function buildLog(): LogEntry[] {
  const now = Date.now()
  return [
    { id: 1, ts: tsFor(new Date(now - 420000)), msg: 'System initialized — Node MN-04 online', level: 'info' },
    { id: 2, ts: tsFor(new Date(now - 378000)), msg: 'All 6 sensors calibrated and reporting', level: 'info' },
    { id: 3, ts: tsFor(new Date(now - 312000)), msg: 'Vibration baseline established: 0.021G avg', level: 'info' },
    { id: 4, ts: tsFor(new Date(now - 258000)), msg: 'Pressure variance within nominal limits', level: 'info' },
    { id: 5, ts: tsFor(new Date(now - 182000)), msg: 'Self-test complete — all channels OK', level: 'info' },
    { id: 6, ts: tsFor(new Date(now - 121000)), msg: 'Acoustic AGC adjustment applied', level: 'info' },
    { id: 7, ts: tsFor(new Date(now - 63000)), msg: 'Camera capture archived — no anomaly', level: 'info' },
  ]
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { color: string; name: string; value: number }[]
  label?: string
}) {
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

interface ChartLine {
  key: 'v' | 'v2'
  color: string
  name: string
  yAxisId?: 'left' | 'right'
}

interface ChartCardProps {
  title: string
  data: DataPoint[]
  lines: ChartLine[]
  unit: string
  yDomain?: [number | 'auto', number | 'auto']
  y2Domain?: [number | 'auto', number | 'auto']
  latestValue?: string
  yAxisWidth?: number
  y2AxisWidth?: number
}

function ChartCard({ title, data, lines, unit, yDomain, y2Domain, latestValue, yAxisWidth, y2AxisWidth }: ChartCardProps) {
  const dual = !!y2Domain
  const latest = data[data.length - 1]

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '10px 12px 6px',
      display: 'flex', flexDirection: 'column', gap: 6,
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

const STATE_DESC: Record<SystemState, string> = {
  NORMAL: 'All parameters within operational thresholds. No intervention required.',
  WATCH: 'One or more sensors approaching alert threshold. Heightened monitoring active.',
  CRITICAL: 'Threshold exceeded. Immediate inspection and escalation required.',
}

const SENSOR_ROWS: { label: string; ok: (s: SystemState) => boolean }[] = [
  { label: 'ACCELEROMETER', ok: (s) => s === 'NORMAL' },
  { label: 'ACOUSTIC MIC', ok: (s) => s === 'NORMAL' },
  { label: 'BAROMETRIC', ok: (s) => s !== 'CRITICAL' },
  { label: 'THERMISTOR', ok: () => true },
  { label: 'LOAD CELL', ok: (s) => s === 'NORMAL' },
  { label: 'CAMERA LINK', ok: () => true },
]

interface StatusCardProps {
  state: SystemState
  onStateChange: (s: SystemState) => void
}

function StatusCard({ state, onStateChange }: StatusCardProps) {
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

      {/* Demo state override — narrate "forcing test state" when used on stage */}
      <div style={{ width: '100%', paddingLeft: 10, paddingRight: 4 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          marginBottom: 5,
        }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#3A5270" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M12 9v4m0 4h.01" stroke="#3A5270" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontSize: 8, fontWeight: 600,
            letterSpacing: '0.16em', textTransform: 'uppercase', color: '#3A5270',
          }}>
            Force Test State
          </span>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {(['NORMAL', 'WATCH', 'CRITICAL'] as SystemState[]).map((s) => (
            <button
              key={s}
              onClick={() => onStateChange(s)}
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
      </div>
    </div>
  )
}

// ─── Event log ────────────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<LogEntry['level'], string> = {
  info: C.dim,
  warn: '#F1C40F',
  critical: '#E74C3C',
}

interface EventLogProps {
  entries: LogEntry[]
}

function EventLog({ entries }: EventLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

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
        {entries.map((e) => (
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

interface TopBarProps {
  state: SystemState
  nodeId: string
  connected: boolean
}

function TopBar({ state, nodeId, connected }: TopBarProps) {
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
          <path d="M2 12l10 5 10-5" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
        </svg>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 19, fontWeight: 700,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: C.ink,
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

      {/* Connection dot */}
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
          {connected ? 'Online' : 'Offline'}
        </span>
      </div>

      <div style={{ width: 1, height: 22, background: C.border }} />

      {/* Clock */}
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#8AA4BE',
        letterSpacing: '0.04em',
      }}>
        {clock} UTC
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

// ─── Bottom bar ───────────────────────────────────────────────────────────────

interface BottomBarProps {
  camTimestamp: string
  onSendAlert: () => void
}

function BottomBar({ camTimestamp, onSendAlert }: BottomBarProps) {
  const [alertSent, setAlertSent] = useState(false)

  const handleAlert = () => {
    onSendAlert()
    setAlertSent(true)
    setTimeout(() => setAlertSent(false), 3000)
  }

  const META = [
    { label: 'SITE', value: 'Alpha-3' },
    { label: 'DEPTH', value: '312 m' },
    { label: 'ZONE', value: 'Level-7B' },
    { label: 'OPERATOR', value: 'R. Kowalski' },
    { label: 'UPTIME', value: '7d 14h' },
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

      {/* Camera thumbnail */}
      <div style={{
        position: 'relative', borderRadius: 5, overflow: 'hidden',
        border: `1px solid ${C.borderBright}`, height: 60, width: 107, flexShrink: 0,
        background: '#040A14',
      }}>
        <img
          src="https://images.unsplash.com/photo-1766934697091-9c2c803b05d6?w=214&h=120&fit=crop&auto=format"
          alt="Mine tunnel camera feed — Level 7B"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '2px 5px',
          background: 'rgba(6, 13, 27, 0.88)',
          fontFamily: "'JetBrains Mono', monospace", fontSize: 7, color: C.dim,
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>{camTimestamp}</span>
          <span style={{ color: '#2ECC71' }}>● CAM-04</span>
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

      {/* Subsidence risk meter */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <span style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 8, fontWeight: 600,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: C.ghost,
        }}>
          Risk Index
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <div key={n} style={{
              width: 6, height: 16, borderRadius: 2,
              background: n <= 2 ? '#2ECC71' : n <= 6 ? '#1A3A26' : n <= 8 ? '#3A2E0A' : '#3A1010',
              border: `1px solid ${n <= 2 ? '#2ECC7140' : C.border}`,
            }} />
          ))}
        </div>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: '#2ECC71' }}>
          LOW — 0.12
        </span>
      </div>

      <div style={{ width: 1, height: 40, background: C.border, flexShrink: 0 }} />

      {/* GSM alert button */}
      <button
        onClick={handleAlert}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '8px 18px',
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, fontWeight: 700,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          border: alertSent ? '1px solid #2ECC71' : '1px solid #E74C3C',
          borderRadius: 6, cursor: 'pointer',
          background: alertSent ? '#2ECC7118' : 'transparent',
          color: alertSent ? '#2ECC71' : '#E74C3C',
          transition: 'all 0.25s',
          flexShrink: 0,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.52 12 19.79 19.79 0 011.2 3.37 2 2 0 013.18 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {alertSent ? 'Alert Sent' : 'Send Test Alert (GSM)'}
      </button>
    </div>
  )
}

// ─── App ─────────────────────────────────────────────────────────────────────

const EVENT_POOL: Record<SystemState, { msg: string; level: LogEntry['level'] }[]> = {
  NORMAL: [
    { msg: 'Vibration reading nominal — 0.021G avg', level: 'info' },
    { msg: 'Pressure stable at 1013.5 mbar', level: 'info' },
    { msg: 'Temperature consistent — 21.3°C', level: 'info' },
    { msg: 'Acoustic baseline confirmed — 51 dB', level: 'info' },
    { msg: 'Strain gauge within tolerance (891 kgF)', level: 'info' },
    { msg: 'Camera capture archived — no anomaly detected', level: 'info' },
    { msg: 'GSM link heartbeat acknowledged', level: 'info' },
  ],
  WATCH: [
    { msg: 'Vibration anomaly detected — threshold approaching', level: 'warn' },
    { msg: 'Acoustic spike: 72 dB — monitoring closely', level: 'warn' },
    { msg: 'Strain trending upward — supervisor notified', level: 'warn' },
    { msg: 'Escalating to WATCH state', level: 'warn' },
    { msg: 'Secondary sensor confirming elevated readings', level: 'warn' },
    { msg: 'Alert notification dispatched to site supervisor', level: 'warn' },
  ],
  CRITICAL: [
    { msg: 'CRITICAL: Vibration at 0.195G — advisory issued', level: 'critical' },
    { msg: 'Structural strain at 988 kgF — fault suspected', level: 'critical' },
    { msg: 'GSM alert dispatched to on-call response team', level: 'critical' },
    { msg: 'Emergency protocol activated — Level 7B', level: 'critical' },
    { msg: 'Camera repositioned for zone surveillance', level: 'critical' },
    { msg: 'Awaiting acknowledgement from surface control', level: 'critical' },
  ],
}

function createLogFromTelemetry(data: Telemetry, id: number): LogEntry {
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

export default function App() {
 const [systemState, setSystemState] = useState<SystemState>('NORMAL')
const [connected, setConnected] = useState(false)
const [vibData, setVibData] = useState<DataPoint[]>([])
const [acoData, setAcoData] = useState<DataPoint[]>([])
const [envData, setEnvData] = useState<DataPoint[]>([])
const [strData, setStrData] = useState<DataPoint[]>([])
const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [camTs, setCamTs] = useState(nowStr)

  const stateRef = useRef<SystemState>('NORMAL')
  useEffect(() => { stateRef.current = systemState }, [systemState])

  const addLog = useCallback((msg: string, level: LogEntry['level']) => {
    setLogEntries((prev) => [...prev.slice(-149), { id: ++_logId, ts: nowStr(), msg, level }])
  }, [])

  // Fetch live telemetry from backend
useEffect(() => {
  const fetchTelemetry = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/telemetry')

      if (!response.ok) {
        throw new Error('Failed to fetch telemetry')
      }

      const data: Telemetry = await response.json()

      const t = tsFor(new Date(data.timestamp))

      setConnected(true)
      setSystemState(data.status)

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

      setStrData((prev) => [
        ...prev.slice(-(MAX_PTS - 1)),
        { t, v: Number(data.strain) },
      ])
    } catch (error) {
      console.error('Telemetry fetch failed:', error)
      setConnected(false)
    }
  }

  fetchTelemetry()

  const interval = setInterval(fetchTelemetry, 2000)

  return () => clearInterval(interval)
}, [])

  // Camera timestamp — every 30 s
  useEffect(() => {
    const t = setInterval(() => setCamTs(nowStr()), 30000)
    return () => clearInterval(t)
  }, [])

  

  // Log state transitions
  const prevStateRef = useRef<SystemState>(systemState)
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

      const data: Telemetry[] = await response.json()

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
    const response = await fetch(
      'http://localhost:5000/api/test-alert',
      {
        method: 'POST',
      }
    );

    const result = await response.json();

    addLog(result.message, 'warn');
  } catch (error) {
    addLog('Alert dispatch failed', 'critical');
  }
}, [addLog]);

  // Latest values for chart headers
  const lastVib = vibData[vibData.length - 1]?.v
  const lastAco = acoData[acoData.length - 1]?.v
  const lastEnv = envData[envData.length - 1]
  const lastStr = strData[strData.length - 1]?.v

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: C.bg, overflow: 'hidden',
    }}>
      <TopBar state={systemState} nodeId="MN-04" connected={connected} />

      <main style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: '244px 1fr 260px',
        gap: 9, padding: 9, overflow: 'hidden',
        minHeight: 0,
      }}>
        {/* Left — Status card */}
        <StatusCard state={systemState} onStateChange={setSystemState} />

        {/* Center — 2×2 chart grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: 9, minHeight: 0,
        }}>
          <ChartCard
            title="Ground Vibration"
            data={vibData}
            lines={[{ key: 'v', color: '#3A85D0', name: 'G-force', yAxisId: 'left' }]}
            unit="Accelerometer (G)"
            yDomain={[0, 0.30]}
            latestValue={lastVib !== undefined ? `${lastVib.toFixed(4)} G` : '—'}
          />
          <ChartCard
            title="Acoustic Signature"
            data={acoData}
            lines={[{ key: 'v', color: '#9B59B6', name: 'dB SPL', yAxisId: 'left' }]}
            unit="Microphone (dB SPL)"
            yDomain={[35, 100]}
            latestValue={lastAco !== undefined ? `${lastAco} dB` : '—'}
          />
          <ChartCard
            title="Environmental Trend"
            data={envData}
            lines={[
              { key: 'v', color: '#2ECC71', name: 'mbar', yAxisId: 'left' },
              { key: 'v2', color: '#F1C40F', name: '°C', yAxisId: 'right' },
            ]}
            unit="Pressure (mbar) · Temperature (°C)"
            yDomain={[1007, 1023]}
            y2Domain={[15, 30]}
            latestValue={lastEnv ? `${lastEnv.v} mbar · ${lastEnv.v2}°C` : '—'}
            yAxisWidth={50}
            y2AxisWidth={26}
          />
          <ChartCard
            title="Structural Strain"
            data={strData}
            lines={[{ key: 'v', color: '#D35400', name: 'kgF', yAxisId: 'left' }]}
            unit="Load Cell (kgF)"
            yDomain={[820, 1080]}
            latestValue={lastStr !== undefined ? `${lastStr} kgF` : '—'}
          />
        </div>

        {/* Right — Event log */}
        <EventLog entries={logEntries} />
      </main>

      <BottomBar camTimestamp={camTs} onSendAlert={handleSendAlert} />
    </div>
  )
}
