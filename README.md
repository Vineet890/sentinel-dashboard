# Sentinel

**Real-time mine subsidence early-warning system** — a multi-sensor monitoring dashboard built for underground coal and mineral mines. Designed to detect precursors to ground collapse through continuous analysis of vibration, acoustic, pressure, temperature, and structural strain data, and to trigger GSM-based emergency alerts when thresholds are breached.

Built for **Smart India Hackathon 2026** under the problem statement for intelligent mine safety infrastructure.

---

## The Problem

Mine subsidence — the gradual or sudden sinking of ground above an underground excavation — is one of the leading causes of catastrophic mining disasters globally. In India, where a significant portion of mining activity involves aging underground infrastructure, real-time anomaly detection is largely absent at the site level. Operators rely on periodic manual inspections, which create dangerous blind spots between readings.

**Sentinel** addresses this by deploying a low-cost, offline-capable sensor node directly at the mining site that continuously monitors geological precursors and surfaces the data to operators in a readable, actionable dashboard — with no dependence on cloud connectivity.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        SITE NODE (MN-04)                         │
│                                                                  │
│   ┌─────────────────┐      ┌──────────────────┐                 │
│   │  Sensor Array   │      │  Jetson Nano      │                 │
│   │                 │─────▶│  (Edge Compute)   │                 │
│   │  · MPU-6050     │ I²C  │                   │                 │
│   │  · Sound sensor │      │  · Reads sensors  │                 │
│   │  · BMP180       │      │  · Runs anomaly   │                 │
│   │  · Thermistor   │      │    detection      │                 │
│   │  · Load cell    │      │  · Writes CSV     │                 │
│   └─────────────────┘      └────────┬─────────┘                 │
│                                      │ sensor_log.csv             │
│                             ┌────────▼─────────┐                 │
│                             │  Express API     │                 │
│                             │  :5000           │                 │
│                             │                  │                 │
│                             │  /api/telemetry  │                 │
│                             │  /api/events     │                 │
│                             │  /api/test-alert │                 │
│                             └────────┬─────────┘                 │
│                                      │ REST (localhost)           │
│                             ┌────────▼─────────┐                 │
│                             │  React Dashboard │                 │
│                             │  :8443           │                 │
│                             └──────────────────┘                 │
│                                                                  │
│                    ┌──────────────────┐                          │
│                    │  SIM900A Module  │ ◀── triggered on CRITICAL │
│                    │  (GSM Alert)     │                          │
│                    └──────────────────┘                          │
└──────────────────────────────────────────────────────────────────┘
```

The entire stack runs **locally on the Jetson Nano** — there is no cloud dependency, no internet requirement, and no external API calls. The system is designed to remain operational in environments with zero connectivity.

---

## Features

| Feature | Description |
|---|---|
| **Live Sensor Charts** | 4 real-time scrolling charts — ground vibration (G), acoustic signature (dB), environmental trend (mbar · °C), structural strain (kgF) — updated every 2 seconds |
| **3-State Alert System** | NORMAL / WATCH / CRITICAL state machine driven by the sensor anomaly model, with distinct visual and glow indicators per state |
| **Connection Loss Detection** | Automatically detects stale data (>5s without update) and shows an "Offline · Xs ago" indicator in the top bar |
| **Manual Override Mode** | Operators can force-lock the dashboard to a specific state for demo or inspection purposes; API updates are suppressed until "Resume Live" is clicked |
| **Event Log** | Scrolling timestamped log of sensor state transitions, sourced from the backend CSV history |
| **GSM Test Alert** | One-click button to trigger an SMS dispatch to the on-call response team (mock in current build; wired to SIM900A AT commands in hardware deployment) |
| **Fully Offline** | No external CDN, no cloud API, no Unsplash or remote image dependencies — runs air-gapped |

---

## Quick Start

> **Prerequisites:** Node.js ≥ 18, pnpm (or npm)

### 1 — Start the mock sensor pipeline
```bash
cd backend
node mock_data/generate_mock.js
```
Writes a new sensor row to `sensor_log.csv` every 2 seconds, simulating the Jetson Nano data pipeline.

### 2 — Start the backend API
```bash
cd backend
node server.js
# → Backend running on http://localhost:5000
```

### 3 — Start the dashboard
```bash
cd frontend
pnpm install
pnpm dev
# → Dashboard at http://localhost:8443
```

---

## Repository Structure

```
sentinel-dashboard/
├── backend/
│   ├── server.js               # Express API server
│   └── mock_data/
│       ├── generate_mock.js    # Simulated sensor data writer
│       └── sensor_log.csv      # Live data store (gitignored)
├── frontend/
│   ├── src/
│   │   ├── App.jsx             # Full dashboard UI (React)
│   │   ├── main.jsx            # Entry point
│   │   └── index.css           # Global styles + animations
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── README.md
```

---

## API Reference

| Method | Endpoint | Response |
|---|---|---|
| `GET` | `/api/telemetry` | Latest sensor reading as JSON object |
| `GET` | `/api/events` | Last 20 sensor readings as JSON array (newest first) |
| `GET` | `/api/camera` | Latest captured JPEG frame from the Jetson camera |
| `POST` | `/api/test-alert` | Triggers GSM alert; returns `{ success: true, message: "..." }` |

### Sensor Data Schema

The backend reads from a single CSV file. This is the canonical data contract between the sensor firmware and the dashboard — both sides must conform to this format exactly.

```
timestamp,vibration,acoustic,pressure,temperature,strain,status
```

| Field | Type | Unit | Notes |
|---|---|---|---|
| `timestamp` | ISO 8601 string | — | UTC, millisecond precision |
| `vibration` | float | G-force | Peak ground acceleration |
| `acoustic` | float | dB SPL | Ambient acoustic level |
| `pressure` | float | mbar | Barometric pressure |
| `temperature` | float | °C | Ambient temperature |
| `strain` | float | kgF | Load cell reading |
| `status` | string | — | `NORMAL` · `WATCH` · `CRITICAL` — output of the anomaly model |

The `status` field is the output of the ML anomaly detection stage running on the Jetson, **not** a raw threshold comparison. Raw sensor values trigger a WATCH or CRITICAL state only after the model confirms a multi-sensor anomaly pattern — reducing false positives from single-sensor noise.

---

## Hardware Integration (Jetson Nano)

When the physical sensor pipeline is ready, the swap is a single-line change:

1. The sensor acquisition script writes rows to `backend/mock_data/sensor_log.csv` using the schema above
2. To use a different file path, update `csvPath` in [`backend/server.js`](backend/server.js) (line 12)
3. Stop `generate_mock.js` — it is no longer needed
4. The API server, dashboard, and alert system continue working with no other changes

### Hardware Components

| Component | Purpose |
|---|---|
| NVIDIA Jetson Nano | Edge compute — sensor acquisition, anomaly detection, API server |
| MPU-6050 | 3-axis accelerometer (ground vibration) |
| MEMS microphone | Acoustic signature monitoring |
| BMP180 | Barometric pressure + temperature |
| HX711 + load cell | Structural strain measurement |
| SIM900A GSM module | SMS emergency alerts |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 · Vite 8 · Recharts 3 · Tailwind CSS 4 |
| Backend | Node.js · Express 5 |
| Data transport | REST over localhost (LAN-only, no external network) |
| Data storage | Append-only CSV log |
| Edge hardware | NVIDIA Jetson Nano |

---

## Pre-Deployment Checklist (Jetson Nano)

Before deploying to an offline Jetson Nano:

- [ ] **Self-host fonts** — download Barlow Condensed, IBM Plex Sans, and JetBrains Mono locally; update the `@import` in `frontend/src/index.css` to point to local paths
- [x] **Wire GSM alert** — connected `POST /api/test-alert` to `send_sms.py` via `child_process`
- [x] **Camera feed** — added `/api/camera` endpoint to serve the latest Jetson JPEG frame
- [x] **Dynamic risk engine** — risk and uptime are now dynamically computed from the live backend stream

---

## License

MIT
