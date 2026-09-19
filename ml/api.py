"""
Sentinel ML Pipeline — FastAPI REST API

Exposes ML engine status, predictions, and control endpoints.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from config import API_HOST, API_PORT
from model import AnomalyModel
from detector import SentinelDetector

log = logging.getLogger("sentinel.api")

# ── Shared state (set by main.py before starting the server) ────────────────

_model: AnomalyModel | None = None
_detector: SentinelDetector | None = None


def init(model: AnomalyModel, detector: SentinelDetector):
    """Inject model and detector references (called by main.py)."""
    global _model, _detector
    _model = model
    _detector = detector


# ── App ─────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Sentinel ML API",
    description="Anomaly detection engine for mine subsidence monitoring",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Endpoints ───────────────────────────────────────────────────────────────────

@app.get("/api/ml/health")
def health():
    """Basic health check."""
    return {"status": "ok", "service": "sentinel-ml"}


@app.get("/api/ml/status")
def status():
    """Full ML engine status: model info + detector state."""
    if _model is None or _detector is None:
        raise HTTPException(503, "ML engine not initialised")

    return {
        "model": _model.get_info(),
        "detector": _detector.get_status(),
    }


@app.get("/api/ml/predict")
def predict():
    """Latest anomaly prediction from the detector."""
    if _detector is None:
        raise HTTPException(503, "Detector not initialised")

    if _detector.latest is None:
        return {
            "anomaly_score": 0.0,
            "status": "NORMAL",
            "message": "No predictions yet — waiting for sensor data",
        }

    return _detector.latest


@app.get("/api/ml/history")
def history(n: int = 50):
    """Recent N predictions with scores and features."""
    if _detector is None:
        raise HTTPException(503, "Detector not initialised")

    entries = list(_detector.history)
    # Return most recent N, newest first
    return entries[-n:][::-1]


@app.post("/api/ml/retrain")
def retrain():
    """Manually trigger model retraining on current CSV data."""
    if _model is None:
        raise HTTPException(503, "Model not initialised")

    try:
        report = _model.train()
        return {"success": True, "report": report}
    except Exception as e:
        log.error("Retrain failed: %s", e, exc_info=True)
        raise HTTPException(500, f"Retrain failed: {e}")
