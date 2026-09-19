import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Data normalizer ──────────────────────────────────────────────────────────
// Converts whatever the Jetson FastAPI sends into the flat shape the dashboard
// already expects: { timestamp, vibration, acoustic, pressure, temperature, strain, status }
//
// Handles two formats:
//   1. Flat: { vibration: 0.12, acoustic: 54, ... }  (same as REST/CSV)
//   2. Nested: { sensors: { lis3dh: { x, y, z }, mic: { db }, bmp180: { pressure, temp }, ... } }

function normalizeTelemetry(raw) {
  // If the payload already has a flat 'vibration' field, it matches REST format
  if (raw.vibration !== undefined) {
    return {
      timestamp: raw.timestamp || new Date().toISOString(),
      vibration: parseFloat(raw.vibration),
      acoustic: parseFloat(raw.acoustic),
      pressure: parseFloat(raw.pressure),
      temperature: parseFloat(raw.temperature),
      status: raw.status || 'NORMAL',
      risk_score: raw.risk_score,
      risk_label: raw.risk_label,
      uptime: raw.uptime,
      server_start: raw.server_start,
    }
  }

  // Nested sensor format from Jetson FastAPI
  const sensors = raw.sensors || raw
  const lis3dh = sensors.lis3dh || sensors.accelerometer || {}
  const mic = sensors.mic || sensors.microphone || sensors.acoustic || {}
  const bmp = sensors.bmp180 || sensors.bmp280 || sensors.barometer || {}
  const load = sensors.load_cell || sensors.strain || {}

  // Compute vibration magnitude from 3-axis accelerometer
  const vx = parseFloat(lis3dh.x) || 0
  const vy = parseFloat(lis3dh.y) || 0
  const vz = parseFloat(lis3dh.z) || 0
  const vibMagnitude = Math.sqrt(vx * vx + vy * vy + vz * vz)

  return {
    timestamp: raw.timestamp || new Date().toISOString(),
    vibration: vibMagnitude,
    acoustic: parseFloat(mic.db || mic.spl || mic.value) || 0,
    pressure: parseFloat(bmp.pressure || bmp.press) || 0,
    temperature: parseFloat(bmp.temperature || bmp.temp) || 0,
    status: raw.status || raw.alert_level || 'NORMAL',
    risk_score: raw.risk_score,
    risk_label: raw.risk_label,
    uptime: raw.uptime,
    server_start: raw.server_start || raw.serverStart,
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const WS_URL = typeof import.meta !== 'undefined'
  ? (import.meta.env?.VITE_JETSON_WS_URL || 'ws://192.168.50.2:8000/ws')
  : 'ws://192.168.50.2:8000/ws'

// Check if WebSocket should be skipped entirely (e.g. for demos without Jetson)
const DISABLE_WS = typeof import.meta !== 'undefined' 
  && import.meta.env?.VITE_DISABLE_WS === 'true'

// Tightened timeouts for faster fallback during live demo
const MAX_RECONNECT_ATTEMPTS = 1
const RECONNECT_DELAY_MS = 1000
const INITIAL_CONNECT_TIMEOUT_MS = 2000

export function useSentinelSocket() {
  const [wsConnected, setWsConnected] = useState(false)
  const [wsFailed, setWsFailed] = useState(false)
  const [latestData, setLatestData] = useState(null)

  const wsRef = useRef(null)
  const reconnectCount = useRef(0)
  const reconnectTimer = useRef(null)
  const connectTimeout = useRef(null)
  const unmounted = useRef(false)

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
    if (connectTimeout.current) {
      clearTimeout(connectTimeout.current)
      connectTimeout.current = null
    }
    if (wsRef.current) {
      // Remove handlers before closing to avoid triggering reconnect
      wsRef.current.onopen = null
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.onmessage = null
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close()
      }
      wsRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    if (unmounted.current) return

    cleanup()

    if (DISABLE_WS) {
      console.log('[Sentinel WS] WebSocket disabled via env flag — forcing immediate REST fallback')
      setWsFailed(true)
      return
    }

    try {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      // If we don't get an open event within 5s, give up on this attempt
      connectTimeout.current = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.warn('[Sentinel WS] Connection timeout, closing attempt')
          ws.close()
        }
      }, INITIAL_CONNECT_TIMEOUT_MS)

      ws.onopen = () => {
        if (unmounted.current) return
        console.log('[Sentinel WS] Connected to Jetson')
        clearTimeout(connectTimeout.current)
        reconnectCount.current = 0
        setWsConnected(true)
        setWsFailed(false)
      }

      ws.onmessage = (event) => {
        if (unmounted.current) return
        try {
          const raw = JSON.parse(event.data)
          const normalized = normalizeTelemetry(raw)
          setLatestData(normalized)
        } catch (err) {
          console.error('[Sentinel WS] Failed to parse message:', err)
        }
      }

      ws.onclose = () => {
        if (unmounted.current) return
        console.warn('[Sentinel WS] Disconnected')
        clearTimeout(connectTimeout.current)
        setWsConnected(false)

        // Attempt reconnect up to MAX_RECONNECT_ATTEMPTS
        if (reconnectCount.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectCount.current += 1
          console.log(`[Sentinel WS] Reconnect attempt ${reconnectCount.current}/${MAX_RECONNECT_ATTEMPTS} in ${RECONNECT_DELAY_MS}ms`)
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
        } else {
          console.warn('[Sentinel WS] Max reconnect attempts reached — falling back to REST polling')
          setWsFailed(true)
        }
      }

      ws.onerror = (err) => {
        // onerror is always followed by onclose, so we handle retry there
        console.error('[Sentinel WS] Error:', err)
      }
    } catch (err) {
      // WebSocket constructor itself can throw (invalid URL, etc.)
      console.error('[Sentinel WS] Failed to create WebSocket:', err)
      setWsFailed(true)
    }
  }, [cleanup])

  useEffect(() => {
    unmounted.current = false
    connect()

    return () => {
      unmounted.current = true
      cleanup()
    }
  }, [connect, cleanup])

  // dataSource: 'ws' | 'poll' | 'offline'
  const dataSource = wsConnected ? 'ws' : wsFailed ? 'poll' : 'connecting'

  return {
    wsConnected,
    wsFailed,
    latestData,
    dataSource,
  }
}
