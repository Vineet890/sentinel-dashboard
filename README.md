# Sentinel

Real-time mine subsidence early-warning system — a multi-sensor monitoring dashboard built for underground coal and mineral mines. Designed to detect precursors to ground collapse through continuous analysis of vibration, acoustic, pressure, temperature, and structural strain data, and to automatically trigger SMS emergency alerts when thresholds are breached.

Built for Smart India Hackathon 2026 under the problem statement for intelligent mine safety infrastructure.

## The Problem
Mine subsidence — the gradual or sudden sinking of ground above an underground excavation — is one of the leading causes of catastrophic mining disasters globally. In India, where a significant portion of mining activity involves aging underground infrastructure, real-time anomaly detection is largely absent at the site level. Operators rely on periodic manual inspections, which create dangerous blind spots between readings.

Sentinel addresses this by deploying a low-cost sensor node directly at the mining site that continuously monitors geological precursors and surfaces the data to operators in a readable, actionable dashboard.

## System Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        SITE NODE (MN-04)                        │
│                                                                 │
│  ┌─────────────────┐       ┌───────────────────────────────┐    │
│  │  Sensor Array   │       │   Backend / Edge Compute      │    │
│  │ ────────────────│       │ ──────────────────────────────│    │
│  │ • MPU-6050      │──I²C─▶│ • ML Anomaly Detection        │    │
│  │ • Sound sensor  │       │ • WebSocket Stream (Primary)  │    │
│  │ • BMP180        │       │ • REST API (Fallback)         │    │
│  │ • Load cell     │       │ • Automatic State Monitor     │──┐ │
│  └─────────────────┘       └────────┬──────────────────────┘  │ │
└─────────────────────────────────────┼─────────────────────────┼─┘
                                      │                         │
                    WebSocket / REST  │                         │ HTTP POST
                                      ▼                         ▼
                          ┌───────────────────┐      ┌──────────────────────────┐
                          │  React Dashboard  │      │    SMS Gateway Master    │
                          │  (Sentinel UI)    │      │ (Cloud Function API)     │
                          └───────────────────┘      └──────────┬───────────────┘
                                                                │
                                                                ▼
                                                          Emergency SMS
```

The core telemetry stack runs locally on the edge hardware (Jetson Nano) to ensure dashboard operationality even in disrupted network environments. Emergency alerts securely interface with a Cloud Function SMS Gateway.

## Features

* **Live Sensor Charts**: 4 real-time scrolling charts (ground vibration, acoustic signature, environmental trend, structural strain) updated instantly.
* **3-State Alert System**: `NORMAL` / `WATCH` / `CRITICAL` state machine driven by the sensor anomaly model, with distinct visual and glow indicators.
* **Automatic & Manual SMS Alerts**: Edge-triggered automatic SMS dispatch upon entering the `CRITICAL` state, preventing duplicate spam. Includes a manual "Test Alert" dashboard override for drills.
* **GIS Map Panel**: Integrated Leaflet + OpenStreetMap panel styled to match the dark dashboard theme for precise site geolocation (fully open-source, no billing APIs required).
* **Dual-Transport Telemetry**: Primary low-latency WebSocket connection with an automatic, seamless fallback to REST polling if the socket connection drops.
* **Connection Loss Detection**: Automatically detects stale data and displays an "Offline" indicator.
* **Event Log**: Scrolling timestamped log of sensor state transitions and SMS dispatch events natively synchronized between the backend and frontend.

## Quick Start
*Prerequisites: Node.js ≥ 18, pnpm (or npm)*

**1 — Configure Environment**
Create a `.env` file in the `backend/` directory:
```env
SMS_API_KEY=your_gateway_api_key
ALERT_PHONE=+1234567890
```

**2 — Start the mock sensor pipeline**
```bash
cd backend
node mock_data/generate_mock.js
```
*Writes a new sensor row to `sensor_log.csv` every 2 seconds, simulating the physical hardware.*

**3 — Start the backend API & Alert Monitor**
```bash
cd backend
node server.js
```
*Backend running on http://localhost:5000*

**4 — Start the dashboard**
```bash
cd frontend
pnpm install
pnpm dev
```
*Dashboard running on http://localhost:8443*

## Repository Structure
```text
sentinel-dashboard/
├── backend/
│   ├── server.js              # Express API, SMS trigger, and REST fallback
│   ├── .env                   # Secrets (API Key, Phone Number)
│   └── mock_data/
│       ├── generate_mock.js   # Simulated sensor data writer
│       └── sensor_log.csv     # Live data store
├── frontend/
│   ├── src/
│   │   ├── hooks/
│   │   │   └── useSentinelSocket.js # WebSocket & REST fallback logic
│   │   ├── App.jsx            # Full dashboard UI (React)
│   │   ├── main.jsx           # Entry point
│   │   └── index.css          # Global styles + animations
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── README.md
```

## API Reference

| Method | Endpoint | Response |
| :--- | :--- | :--- |
| `GET` | `/api/telemetry` | Latest sensor reading as a JSON object (used in fallback mode) |
| `GET` | `/api/events` | Last 20 combined sensor/SMS events as JSON array (newest first) |
| `GET` | `/api/camera` | Latest captured JPEG frame from the edge camera |
| `POST` | `/api/test-alert`| Triggers manual SMS alert; returns `{ success, message, smsId }` |

## Sensor Data Schema
The canonical data contract between the sensor firmware and the dashboard via `sensor_log.csv`.

| Field | Type | Unit | Notes |
| :--- | :--- | :--- | :--- |
| `timestamp` | ISO 8601 string | — | UTC, millisecond precision |
| `vibration` | float | G-force | Peak ground acceleration |
| `acoustic` | float | dB SPL | Ambient acoustic level |
| `pressure` | float | mbar | Barometric pressure |
| `temperature` | float | °C | Ambient temperature |
| `strain` | float | kgF | Load cell reading |
| `status` | string | — | `NORMAL` · `WATCH` · `CRITICAL` — output of the anomaly model |

*Note: The `status` field is the output of the ML anomaly detection stage running on the Jetson, not a raw threshold comparison.*

## Hardware Integration (Jetson Nano)
When deploying the physical sensor pipeline:
1. The sensor acquisition script writes rows directly to `backend/mock_data/sensor_log.csv`.
2. To use a different file path, update `csvPath` in `backend/server.js`.
3. Stop `generate_mock.js` — it is no longer needed.
4. The API server, dashboard, and automatic SMS monitor will continue operating seamlessly.

## Tech Stack
* **Frontend:** React 19 · Vite 8 · Recharts 3 · Leaflet (OSM) · Tailwind CSS 4
* **Backend:** Node.js · Express 5
* **Data Transport:** WebSockets (Primary) · REST (Fallback)
* **Alerting:** Cloud Functions SMS Gateway Master
* **Edge Hardware:** NVIDIA Jetson Nano
