import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Normalizes raw Jetson FastAPI telemetry or backend mock payloads into
 * the flat shape expected by dashboard components.
 *
 * Supports:
 * 1. Flat format: { vibration, acoustic, pressure, temperature, status, risk_score, ... }
 * 2. Nested Jetson sensor format:
 *    - LIS3DH 3-axis accelerometer (x_g/x, y_g/y, z_g/z, magnitude_g)
 *    - ADXL345 3-axis accelerometer (x_g/x, y_g/y, z_g/z, magnitude_g)
 *    - BMP280/BMP180 barometer & thermometer (pressure_hpa/pressure/press, temperature_c/temperature/temp)
 *    - INMP441 microphone (db/spl/value)
 *    - Risk engine (anomaly_score, status, lis3dh_z_score, adxl345_z_score, abnormal_samples)
 */
export function normalizeTelemetry(raw) {
  if (!raw) return null

  // If payload already has a flat 'vibration' field
  if (raw.vibration !== undefined && typeof raw.sensors === 'undefined') {
    return {
      timestamp: raw.timestamp || new Date().toISOString(),
      vibration: parseFloat(raw.vibration) || 0,
      acoustic: raw.acoustic != null ? parseFloat(raw.acoustic) : null,
      pressure: parseFloat(raw.pressure) || 0,
      temperature: parseFloat(raw.temperature) || 0,
      status: raw.status || 'NORMAL',
      risk_score: raw.risk_score != null ? raw.risk_score : '0.00',
      risk_label: raw.risk_label || raw.status || 'NORMAL',
      uptime: raw.uptime,
      server_start: raw.server_start || raw.serverStart,
      lis3dh: raw.lis3dh,
      adxl345: raw.adxl345,
      risk: raw.risk,
    }
  }

  // Nested sensor format
  const sensors = raw.sensors || raw || {}
  const lis3dh = sensors.lis3dh || sensors.accelerometer || {}
  const adxl345 = sensors.adxl345 || {}
  const bmp = sensors.bmp280 || sensors.bmp180 || sensors.barometer || {}
  const mic = sensors.mic || sensors.microphone || sensors.acoustic || {}
  const risk = raw.risk || {}

  const status = raw.status || risk.status || raw.alert_level || 'NORMAL'
  const anomalyScore =
    typeof risk.anomaly_score === 'number'
      ? risk.anomaly_score
      : raw.risk_score != null
        ? Number(raw.risk_score)
        : Number(risk.anomaly_score ?? 0)

  // Compute LIS3DH magnitude if not provided directly
  const lx = Number(lis3dh.x_g ?? lis3dh.x ?? 0)
  const ly = Number(lis3dh.y_g ?? lis3dh.y ?? 0)
  const lz = Number(lis3dh.z_g ?? lis3dh.z ?? 0)
  const lis3dhMag =
    lis3dh.magnitude_g != null
      ? Number(lis3dh.magnitude_g)
      : (lx !== 0 || ly !== 0 || lz !== 0)
        ? Math.sqrt(lx * lx + ly * ly + lz * lz)
        : parseFloat(raw.vibration) || 0

  // Compute ADXL345 magnitude if available
  const ax = Number(adxl345.x_g ?? adxl345.x ?? 0)
  const ay = Number(adxl345.y_g ?? adxl345.y ?? 0)
  const az = Number(adxl345.z_g ?? adxl345.z ?? 0)
  const adxl345Mag =
    adxl345.magnitude_g != null
      ? Number(adxl345.magnitude_g)
      : (ax !== 0 || ay !== 0 || az !== 0)
        ? Math.sqrt(ax * ax + ay * ay + az * az)
        : 0

  const bmpPressure = Number(bmp.pressure_hpa ?? bmp.pressure ?? bmp.press ?? 0)
  const bmpTemp = Number(bmp.temperature_c ?? bmp.temperature ?? bmp.temp ?? 0)
  const acousticVal =
    mic.db != null || mic.spl != null || mic.value != null
      ? parseFloat(mic.db || mic.spl || mic.value)
      : raw.acoustic != null
        ? parseFloat(raw.acoustic)
        : null

  return {
    timestamp: raw.timestamp || new Date().toISOString(),
    vibration: lis3dhMag,
    acoustic: acousticVal,
    pressure: bmpPressure,
    temperature: bmpTemp,
    status,
    risk_score: anomalyScore,
    risk_label: raw.risk_label || status,
    uptime: raw.uptime,
    server_start: raw.server_start || raw.serverStart,
    lis3dh: {
      x_g: lx,
      y_g: ly,
      z_g: lz,
      magnitude_g: lis3dhMag,
    },
    adxl345: {
      x_g: ax,
      y_g: ay,
      z_g: az,
      magnitude_g: adxl345Mag,
    },
    risk,
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const WS_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_JETSON_WS_URL) ||
  'ws://192.168.50.2:8000/ws'

const DISABLE_WS =
  typeof import.meta !== 'undefined' &&
  import.meta.env?.VITE_DISABLE_WS === 'true'

const MAX_RECONNECT_ATTEMPTS = 2
const RECONNECT_DELAY_MS = 1500
const INITIAL_CONNECT_TIMEOUT_MS = 3000

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
      wsRef.current.onopen = null
      wsRef.current.onclose = null
      wsRef.current.onerror = null
      wsRef.current.onmessage = null
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
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
      console.log(`[Sentinel WS] Connecting to ${WS_URL}`)
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      connectTimeout.current = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.warn('[Sentinel WS] Connection timeout')
          ws.close()
        }
      }, INITIAL_CONNECT_TIMEOUT_MS)

      ws.onopen = () => {
        if (unmounted.current) return
        clearTimeout(connectTimeout.current)
        connectTimeout.current = null
        console.log('[Sentinel WS] Connected to Jetson')
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

      ws.onerror = (err) => {
        if (unmounted.current) return
        console.error('[Sentinel WS] WebSocket error:', err)
      }

      ws.onclose = () => {
        if (unmounted.current) return
        clearTimeout(connectTimeout.current)
        connectTimeout.current = null
        console.warn('[Sentinel WS] Disconnected')
        setWsConnected(false)

        if (reconnectCount.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectCount.current += 1
          console.log(
            `[Sentinel WS] Reconnect attempt ${reconnectCount.current}/${MAX_RECONNECT_ATTEMPTS} in ${RECONNECT_DELAY_MS}ms`
          )
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
        } else {
          console.warn('[Sentinel WS] Max reconnect attempts reached — falling back to REST polling')
          setWsFailed(true)
        }
      }
    } catch (err) {
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

  const dataSource = wsConnected ? 'ws' : wsFailed ? 'poll' : 'connecting'

  return {
    wsConnected,
    wsFailed,
    latestData,
    dataSource,
    reconnect: connect,
  }
}
