"""
Sentinel ML Pipeline — Main Entry Point

Starts:
  1. The Isolation Forest anomaly detection model (load or train)
  2. The real-time CSV watcher / detector loop
  3. The FastAPI REST API server

Usage:
    py ml/main.py
"""

import sys
import logging
import threading
from pathlib import Path

import uvicorn

# Ensure ml/ is on sys.path when running as `py ml/main.py` from project root
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import CSV_PATH, API_HOST, API_PORT, MIN_TRAIN_ROWS
from model import AnomalyModel
from detector import SentinelDetector
import api as api_module

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("sentinel.main")


def main():
    print()
    print("=" * 60)
    print("  SENTINEL ML ENGINE")
    print("  Mine Subsidence Anomaly Detection")
    print("=" * 60)
    print()

    # ── 1. Initialise model ─────────────────────────────────────────────────────

    model = AnomalyModel()

    # Try loading a saved model first
    if model.load():
        log.info("Loaded pre-trained model")
    else:
        # No saved model — try training on existing CSV
        if CSV_PATH.exists():
            import pandas as pd
            df = pd.read_csv(CSV_PATH)
            if len(df) >= MIN_TRAIN_ROWS:
                log.info("No saved model found — training on existing CSV data")
                try:
                    report = model.train()
                    log.info("Initial training complete: %d samples, %d features",
                             report["samples"], report["features"])
                except Exception as e:
                    log.error("Initial training failed: %s", e)
                    log.info("Starting with untrained model — will train once enough data arrives")
            else:
                log.info(
                    "CSV has only %d rows (need %d) — starting untrained, will train later",
                    len(df), MIN_TRAIN_ROWS,
                )
        else:
            log.info("No CSV found at %s — waiting for sensor data", CSV_PATH)

    # ── 2. Start detector ───────────────────────────────────────────────────────

    detector = SentinelDetector(model)
    detector.start()

    # ── 3. Start API server ─────────────────────────────────────────────────────

    api_module.init(model, detector)

    print()
    print(f"  ML API:     http://localhost:{API_PORT}/api/ml/status")
    print(f"  Health:     http://localhost:{API_PORT}/api/ml/health")
    print(f"  Predict:    http://localhost:{API_PORT}/api/ml/predict")
    print(f"  CSV Watch:  {CSV_PATH}")
    print()
    print("  Press Ctrl+C to stop")
    print("=" * 60)
    print()

    try:
        uvicorn.run(
            api_module.app,
            host=API_HOST,
            port=API_PORT,
            log_level="info",
        )
    except KeyboardInterrupt:
        pass
    finally:
        detector.stop()
        log.info("Sentinel ML Engine shut down")


if __name__ == "__main__":
    main()
