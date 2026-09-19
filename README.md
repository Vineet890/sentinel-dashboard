# Sentinel

Real-time mine subsidence early-warning system — a multi-sensor monitoring dashboard built for underground coal and mineral mines. Designed to detect precursors to ground collapse through continuous analysis of vibration, acoustic, pressure, and temperature data, and to automatically trigger SMS emergency alerts when thresholds are breached.

Built for Smart India Hackathon 2026 under the problem statement for intelligent mine safety infrastructure.

## The Problem
Mine subsidence — the gradual or sudden sinking of ground above an underground excavation — is one of the leading causes of catastrophic mining disasters globally. In India, where a significant portion of mining activity involves aging underground infrastructure, real-time anomaly detection is largely absent at the site level. Operators rely on periodic manual inspections, which create dangerous blind spots between readings.

Sentinel addresses this by deploying a low-cost sensor node directly at the mining site that continuously monitors geological precursors and surfaces the data to operators in a readable, actionable dashboard — with an **AI/ML anomaly detection engine** that learns normal sensor baselines and automatically detects and classifies anomalies in real-time.

## System Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        SITE NODE (MN-04)                        │
│                                                                 │
│  ┌─────────────────┐       ┌───────────────────────────────┐    │
│  │  Sensor Array   │       │   Backend / Edge Compute      │    │
│  │ ────────────────│       │ ──────────────────────────────│    │
│  │ • MPU-6050      │──I²C─▶│ • WebSocket Stream (Primary)  │    │
│  │ • Sound sensor  │       │ • REST API (Fallback)         │    │
│  │ • BMP180        │       │ • Automatic State Monitor     │──┐ │
│  │ • Load cell     │       └────────┬──────────────────────┘  │ │
│  └─────────────────┘                │                         │ │
│                                     │ CSV (sensor_log.csv)    │ │
│                          ┌──────────▼──────────┐              │ │
│                          │  ML Pipeline        │              │ │
│                          │ ─────────────────── │              │ │
│                          │ • Feature Engine    │              │ │
│                          │ • Isolation Forest  │              │ │
│                          │ • Z-score Detector  │              │ │
│                          │ • Anomaly Scoring   │              │ │
│                          │ • FastAPI (port 8001)│             │ │
│                          └──────────┬──────────┘              │ │
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

## ML Anomaly Detection Pipeline

The core intelligence of Sentinel is an **unsupervised anomaly detection engine** powered by:

### Isolation Forest (scikit-learn)
- Trained on historical "normal" sensor data to learn baseline patterns
- Detects anomalies without requiring labeled failure examples
- Auto-retrains periodically as new normal data accumulates

### Composite Scoring System
The ML engine computes a composite anomaly score (0.0–1.0) from three components:

| Component | Weight | Method |
| :--- | :--- | :--- |
| **Isolation Forest** | 60% | Unsupervised outlier detection on engineered features |
| **Z-Score Analysis** | 25% | Statistical deviation from rolling baseline per channel |
| **Rate-of-Change** | 15% | Spike detection relative to rolling standard deviation |

### Feature Engineering
Raw sensor values are transformed into a rich feature vector:
- **Rolling statistics**: Mean and standard deviation over windows of 5, 10, 20 readings
- **Z-scores**: Per-channel statistical deviation from the learned baseline
- **Rate-of-change**: Delta from previous reading and spike ratio
- **Inter-sensor ratios**: Vibration-pressure ratio, pressure-temperature ratio

### Status Classification
| Score Range | Status | Action |
| :--- | :--- | :--- |
| 0.00 – 0.29 | `NORMAL` | No action |
| 0.30 – 0.59 | `WATCH` | Monitoring alert in dashboard |
| 0.60 – 1.00 | `CRITICAL` | Automatic SMS dispatch + visual alarm |

## Features

* **Live Sensor Charts**: 3 real-time scrolling charts (ground vibration, acoustic signature, environmental trend) updated instantly.
* **ML-Driven Anomaly Detection**: Isolation Forest model classifies sensor readings in real-time with a composite anomaly score.
* **3-State Alert System**: `NORMAL` / `WATCH` / `CRITICAL` state machine driven by the ML anomaly model, with distinct visual and glow indicators.
* **ML Engine Status**: Real-time indicator showing whether the Isolation Forest engine is online and actively scoring.
* **Automatic & Manual SMS Alerts**: Edge-triggered automatic SMS dispatch upon entering the `CRITICAL` state, preventing duplicate spam. Includes a manual "Test Alert" dashboard override for drills.
* **GIS Map Panel**: Integrated Leaflet + OpenStreetMap panel styled to match the dark dashboard theme for precise site geolocation.
* **Dual-Transport Telemetry**: Primary low-latency WebSocket connection with an automatic, seamless fallback to REST polling if the socket connection drops.
* **Connection Loss Detection**: Automatically detects stale data and displays an "Offline" indicator.
* **Event Log**: Scrolling timestamped log of sensor state transitions, ML detections, and SMS dispatch events.

## Quick Start
*Prerequisites: Node.js ≥ 18, Python ≥ 3.10, pnpm (or npm)*

**1 — Configure Environment**
Create a `.env` file in the `backend/` directory:
```env
SMS_API_KEY=your_gateway_api_key
ALERT_PHONE=+1234567890
```

**2 — Install ML dependencies**
```bash
cd ml
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Windows
# or: .venv/bin/pip install -r requirements.txt  # Linux/Mac
```

**3 — Start the data ingestion pipeline**
If you have the physical Jetson Nano connected:
```bash
ml/.venv/Scripts/python ml/jetson_bridge.py      # Windows
# or: ml/.venv/bin/python ml/jetson_bridge.py     # Linux/Mac
```
*Note: Ensure `VITE_DISABLE_WS=true` in `frontend/.env` to route data through the ML model.*

If testing without hardware:
```bash
cd backend
node mock_data/generate_mock.js
```

**4 — Train the ML model** (first time only)
```bash
# Wait for ~60+ rows in sensor_log.csv, then:
ml/.venv/Scripts/python ml/train.py              # Windows
# or: ml/.venv/bin/python ml/train.py             # Linux/Mac
```

**5 — Start the ML engine**
```bash
ml/.venv/Scripts/python ml/main.py                # Windows
# or: ml/.venv/bin/python ml/main.py               # Linux/Mac
```
*ML API running on http://localhost:8001*

**6 — Start the backend API & Alert Monitor**
```bash
cd backend
node server.js
```
*Backend running on http://localhost:5000*

**7 — Start the dashboard**
```bash
cd frontend
pnpm install
pnpm dev
```
*Dashboard running on http://localhost:8443*

## Repository Structure
```text
sentinel-dashboard/
├── ml/                            # AI/ML Anomaly Detection Pipeline
│   ├── main.py                    # Entry point (detector + API server)
│   ├── model.py                   # Isolation Forest model (train/predict)
│   ├── feature_engine.py          # Feature engineering (rolling stats, Z-scores)
│   ├── detector.py                # Real-time CSV watcher + inference loop
│   ├── api.py                     # FastAPI REST API for ML status/predictions
│   ├── train.py                   # Standalone training script
│   ├── config.py                  # Hyperparameters, thresholds, paths
│   ├── requirements.txt           # Python dependencies
│   └── models/                    # Trained model artifacts (gitignored)
├── backend/
│   ├── server.js                  # Express API, ML proxy, SMS trigger
│   ├── .env                       # Secrets (API Key, Phone Number)
│   └── mock_data/
│       ├── generate_mock.js       # Simulated sensor data with anomaly injection
│       └── sensor_log.csv         # Live data store (shared with ML pipeline)
├── frontend/
│   ├── src/
│   │   ├── hooks/
│   │   │   └── useSentinelSocket.js # WebSocket & REST fallback logic
│   │   ├── App.jsx                # Full dashboard UI (React)
│   │   ├── main.jsx               # Entry point
│   │   └── index.css              # Global styles + animations
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── README.md
```

## API Reference

| Method | Endpoint | Response |
| :--- | :--- | :--- |
| `GET` | `/api/telemetry` | Latest sensor reading + ML anomaly score as JSON |
| `GET` | `/api/events` | Last 20 combined sensor/SMS events as JSON array |
| `GET` | `/api/camera` | Latest captured JPEG frame from the edge camera |
| `GET` | `/api/ml-status` | ML engine health, model info, detector state |
| `POST` | `/api/test-alert`| Triggers manual SMS alert; returns `{ success, message, smsId }` |

### ML Engine API (port 8001)

| Method | Endpoint | Response |
| :--- | :--- | :--- |
| `GET` | `/api/ml/health` | Health check |
| `GET` | `/api/ml/status` | Model info + detector state |
| `GET` | `/api/ml/predict` | Latest anomaly score + status + feature breakdown |
| `GET` | `/api/ml/history?n=50` | Recent N predictions with scores |
| `POST` | `/api/ml/retrain` | Manually trigger model retraining |

## Sensor Data Schema
The canonical data contract between the sensor firmware and the dashboard via `sensor_log.csv`.

| Field | Type | Unit | Notes |
| :--- | :--- | :--- | :--- |
| `timestamp` | ISO 8601 string | — | UTC, millisecond precision |
| `vibration` | float | G-force | Peak ground acceleration |
| `acoustic` | float | dB SPL | Ambient acoustic level |
| `pressure` | float | mbar | Barometric pressure |
| `temperature` | float | °C | Ambient temperature |
| `status` | string | — | `NORMAL` · `WATCH` · `CRITICAL` — output of the ML anomaly model |

## Hardware Integration (Jetson Nano)
When deploying the physical sensor pipeline:
1. The sensor acquisition script writes rows directly to `backend/mock_data/sensor_log.csv`.
2. To use a different file path, update `csvPath` in `backend/server.js` and `CSV_PATH` in `ml/config.py`.
3. Stop `generate_mock.js` — it is no longer needed.
4. The ML engine, API server, dashboard, and automatic SMS monitor will continue operating seamlessly.

## Tech Stack
* **Frontend:** React 19 · Vite 8 · Recharts 3 · Leaflet (OSM)
* **Backend:** Node.js · Express 5
* **ML Pipeline:** Python 3.13 · scikit-learn · pandas · NumPy · FastAPI · Uvicorn
* **ML Model:** Isolation Forest (unsupervised anomaly detection)
* **Data Transport:** WebSockets (Primary) · REST (Fallback)
* **Alerting:** Cloud Functions SMS Gateway Master
* **Edge Hardware:** NVIDIA Jetson Nano
