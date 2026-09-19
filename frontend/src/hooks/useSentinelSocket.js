import { useState, useEffect, useRef, useCallback } from 'react'

const WS_URL =
  import.meta.env?.VITE_JETSON_WS_URL ||
  'ws://192.168.50.2:8000/ws'

const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAY_MS = 2000
const INITIAL_CONNECT_TIMEOUT_MS = 5000

/**
 * Normalizes raw Jetson FastAPI telemetry payload into the frontend dashboard format.
 * Live Jetson sensors:
 * - LIS3DH 3-axis accelerometer (x_g, y_g, z_g, magnitude_g)
 * - ADXL345 3-axis accelerometer (x_g, y_g, z_g, magnitude_g)
 * - BMP280 temperature and pressure (temperature_c, pressure_hpa)
 * - Risk engine (anomaly_score, status, lis3dh_z_score, adxl345_z_score, abnormal_samples)
 */
export function normalizeTelemetry(raw) {
  if (!raw) return null

  const sensors = raw.sensors || {}
  const lis3dh = sensors.lis3dh || {}
  const adxl345 = sensors.adxl345 || {}
  const bmp280 = sensors.bmp280 || {}
  const risk = raw.risk || {}

  const status = raw.status || risk.status || 'NORMAL'
  const anomalyScore =
    typeof risk.anomaly_score === 'number'
      ? risk.anomaly_score
      : Number(risk.anomaly_score ?? 0)

  const lis3dhMag = Number(lis3dh.magnitude_g ?? 0)
  const adxl345Mag = Number(adxl345.magnitude_g ?? 0)
  const bmpPressure = Number(bmp280.pressure_hpa ?? 0)
  const bmpTemp = Number(bmp280.temperature_c ?? 0)

  return {
    timestamp: raw.timestamp || new Date().toISOString(),

    // Real Jetson LIS3DH magnitude (authoritative, no client-side recalculation)
    vibration: lis3dhMag,

    // Acoustic / microphone not currently streamed by Jetson API
    acoustic: null,

    // Real BMP280 atmospheric data
    pressure: bmpPressure,
    temperature: bmpTemp,

    // Strain / load cell not currently connected
    strain: null,

    // Status from Jetson risk engine (NORMAL / WATCH / CRITICAL)
    status: status,

    // Prototype anomaly score from Jetson risk engine
    risk_score: anomalyScore,
    risk_label: status,

    // Raw sensor structures preserved for multi-series inspection
    lis3dh: {
      x_g: Number(lis3dh.x_g ?? 0),
      y_g: Number(lis3dh.y_g ?? 0),
      z_g: Number(lis3dh.z_g ?? 0),
      magnitude_g: lis3dhMag,
    },

    adxl345: {
      x_g: Number(adxl345.x_g ?? 0),
      y_g: Number(adxl345.y_g ?? 0),
      z_g: Number(adxl345.z_g ?? 0),
      magnitude_g: adxl345Mag,
    },

    risk: risk,
  }
}

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

          console.log('[Sentinel WS] Live telemetry:', normalized)

          setLatestData(normalized)
        } catch (err) {
          console.error('[Sentinel WS] Invalid telemetry JSON:', err)
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
            `[Sentinel WS] Reconnecting ${reconnectCount.current}/${MAX_RECONNECT_ATTEMPTS}...`
          )

          reconnectTimer.current = setTimeout(
            connect,
            RECONNECT_DELAY_MS
          )
        } else {
          console.warn('[Sentinel WS] Connection failed, switching to fallback')
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

  const dataSource = wsConnected
    ? 'ws'
    : wsFailed
      ? 'poll'
      : 'connecting'

  return {
    wsConnected,
    wsFailed,
    latestData,
    dataSource,
    reconnect: connect,
  }
}
