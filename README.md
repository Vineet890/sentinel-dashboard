# Sentinel — Mine Subsidence Early-Warning Dashboard

Real-time industrial monitoring dashboard for detecting mine subsidence through multi-sensor data analysis. Built for the Smart India Hackathon (SIH).

## Architecture

```
┌─────────────────────┐
│   Sensor Pipeline   │
│  (Mock / Jetson)    │
└──────────┬──────────┘
           │ writes every 2s
           ▼
┌─────────────────────┐
│   sensor_log.csv    │
└──────────┬──────────┘
           │ reads
           ▼
┌─────────────────────┐
│   Express Server    │
│   localhost:5000     │
│                     │
│ GET  /api/telemetry │
│ GET  /api/events    │
│ POST /api/test-alert│
└──────────┬──────────┘
           │ REST API
           ▼
┌─────────────────────┐
│   React Dashboard   │
│   localhost:8443    │
│                     │
│ Charts · Status ·   │
│ Event Log · Alerts  │
└─────────────────────┘
```

## Quick Start

### 1. Start the mock sensor (Terminal 1)
```bash
cd backend
node mock_data/generate_mock.js
```

### 2. Start the backend API (Terminal 2)
```bash
cd backend
node server.js
```

### 3. Start the frontend (Terminal 3)
```bash
cd frontend
pnpm install   # or npm install
pnpm dev       # or npm run dev
```

Open **http://localhost:8443** in your browser.

## CSV Data Contract

The backend reads sensor data from a CSV file. The column format must be:

```
timestamp,vibration,acoustic,pressure,temperature,strain,status
```

| Column      | Type    | Unit    | Example                      |
|-------------|---------|---------|------------------------------|
| timestamp   | ISO8601 | —       | 2026-09-16T05:30:01.123Z     |
| vibration   | float   | G-force | 0.1234                       |
| acoustic    | float   | dB      | 54.2                         |
| pressure    | float   | mbar    | 1015.3                       |
| temperature | float   | °C      | 21.4                         |
| strain      | float   | kgF     | 867.2                        |
| status      | string  | —       | NORMAL \| WATCH \| CRITICAL  |

**Status values** must be uppercase and come from the AI/ML anomaly detection model's state machine — not raw sensor thresholds.

## Swapping to Real Sensor Data

When the Jetson Nano sensor pipeline is ready:

1. Your script writes CSV rows to `backend/mock_data/sensor_log.csv` (or a new path)
2. If using a different path, update `csvPath` in `backend/server.js` (one line)
3. Stop `generate_mock.js` — it's no longer needed
4. Everything else (backend API, frontend dashboard) works unchanged

## API Endpoints

| Method | Path              | Description                        |
|--------|-------------------|------------------------------------|
| GET    | /api/telemetry    | Latest single sensor row (JSON)    |
| GET    | /api/events       | Last 20 sensor rows (JSON array)   |
| POST   | /api/test-alert   | Trigger test GSM alert (mock)      |

## Tech Stack

| Layer    | Technology                                    |
|----------|-----------------------------------------------|
| Frontend | React 19 · TypeScript · Vite 8 · Recharts 3  |
| Backend  | Node.js · Express 5 · CORS                   |
| Data     | CSV (sensor log)                              |
| Fonts    | Barlow Condensed · IBM Plex Sans · JetBrains Mono (Google Fonts CDN) |

## Pre-Deployment Tasks (Jetson Nano)

Before deploying to an offline Jetson Nano:

- [ ] **Self-host fonts**: Download Barlow Condensed, IBM Plex Sans, and JetBrains Mono font files and serve them locally instead of from Google Fonts CDN. Update `index.css` `@import` to point to local files.
- [ ] **Wire real GSM**: Connect `POST /api/test-alert` to the SIM900A AT command script (`send_sms.py`) via `child_process`.
- [ ] **Camera feed**: Replace the camera placeholder with actual Jetson camera capture endpoint.
- [ ] **Compute uptime/risk**: Wire the static "7d 14h" uptime and "LOW — 0.12" risk index to real computed values.

## License

MIT
