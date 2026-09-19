"""
Sentinel ML Pipeline — Real-time Anomaly Detector

Watches sensor_log.csv for new rows, runs inference on each, and updates
the status column with the ML-determined classification.
"""

import csv
import logging
import os
import threading
import time
from collections import deque
from pathlib import Path

import pandas as pd

from config import (
    CSV_PATH,
    CSV_COLUMNS,
    RAW_COLUMNS,
    POLL_INTERVAL,
    PREDICTION_HISTORY_SIZE,
    RETRAIN_AFTER_N,
)
from model import AnomalyModel

log = logging.getLogger("sentinel.detector")


class SentinelDetector:
    """
    Real-time CSV watcher + ML inference engine.

    Polls sensor_log.csv for new rows, runs the anomaly model on each,
    and overwrites the row's status field with the ML classification.
    """

    def __init__(self, model: AnomalyModel):
        self.model = model
        self._last_line_count = 0
        self._running = False
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

        # Recent predictions (for the API to serve)
        self.history: deque = deque(maxlen=PREDICTION_HISTORY_SIZE)

        # Latest prediction (quick access)
        self.latest: dict | None = None

        # Count of normal readings since last retrain
        self._normal_since_retrain = 0

    # ── Public API ──────────────────────────────────────────────────────────────

    def start(self):
        """Start the detector loop in a background thread."""
        if self._running:
            log.warning("Detector already running")
            return

        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        log.info("Detector started (polling every %.1fs)", POLL_INTERVAL)

    def stop(self):
        """Stop the detector loop."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
        log.info("Detector stopped")

    def get_status(self) -> dict:
        """Return detector status for the API."""
        return {
            "running": self._running,
            "csv_path": str(CSV_PATH),
            "csv_exists": CSV_PATH.exists(),
            "lines_processed": self._last_line_count,
            "predictions_in_history": len(self.history),
            "normal_since_retrain": self._normal_since_retrain,
        }

    # ── Core loop ───────────────────────────────────────────────────────────────

    def _loop(self):
        """Main polling loop."""
        log.info("Detector loop started, watching %s", CSV_PATH)

        # Initialise line count from current file
        if CSV_PATH.exists():
            with open(CSV_PATH, "r") as f:
                self._last_line_count = sum(1 for _ in f)
            log.info("Initialised at line %d", self._last_line_count)

        while self._running:
            try:
                self._poll()
            except Exception as e:
                log.error("Detector poll error: %s", e, exc_info=True)

            time.sleep(POLL_INTERVAL)

    def _poll(self):
        """Check for new CSV rows and process them."""
        if not CSV_PATH.exists():
            return

        with open(CSV_PATH, "r") as f:
            lines = f.readlines()

        current_count = len(lines)

        if current_count <= self._last_line_count:
            return  # No new rows

        # Process only new rows
        new_lines = lines[self._last_line_count:]
        header = lines[0].strip().split(",") if lines else CSV_COLUMNS

        for line in new_lines:
            line = line.strip()
            if not line:
                continue

            values = line.split(",")
            if len(values) < len(RAW_COLUMNS) + 1:  # +1 for timestamp at minimum
                continue

            row = {}
            for i, col in enumerate(header):
                if i < len(values):
                    row[col] = values[i]

            self._process_row(row)

        # Update the CSV with ML-determined statuses
        self._update_csv(lines, header)

        self._last_line_count = current_count

    def _process_row(self, row: dict):
        """Run inference on a single sensor row."""
        prediction = self.model.predict(row)

        # Attach raw sensor values and timestamp to the prediction
        prediction["timestamp"] = row.get("timestamp", "")
        prediction["raw"] = {col: row.get(col, "") for col in RAW_COLUMNS}

        with self._lock:
            self.latest = prediction
            self.history.append(prediction)

        ml_status = prediction["status"]
        score = prediction["anomaly_score"]

        if ml_status == "NORMAL":
            self._normal_since_retrain += 1
        else:
            log.warning(
                "ANOMALY DETECTED: %s (score=%.4f) — %s",
                ml_status,
                score,
                {k: row.get(k) for k in RAW_COLUMNS},
            )

        # Check if auto-retrain is due
        if self._normal_since_retrain >= RETRAIN_AFTER_N:
            log.info("Auto-retrain triggered after %d normal readings", self._normal_since_retrain)
            try:
                self.model.train()
                self._normal_since_retrain = 0
                log.info("Auto-retrain complete")
            except Exception as e:
                log.error("Auto-retrain failed: %s", e)

    def _update_csv(self, lines: list, header: list):
        """Rewrite the CSV with ML-determined status for new rows."""
        try:
            status_idx = header.index("status") if "status" in header else None
        except ValueError:
            status_idx = None

        if status_idx is None:
            return  # Can't update without a status column

        # We only update rows that we just processed
        start = self._last_line_count
        history_list = list(self.history)

        # Number of new rows we processed
        new_count = len(lines) - start
        if new_count <= 0:
            return

        # Get the predictions for these new rows (they're the last N in history)
        recent_predictions = history_list[-new_count:]

        updated = False
        for i, pred in enumerate(recent_predictions):
            line_idx = start + i
            if line_idx >= len(lines) or line_idx == 0:  # Skip header
                continue

            line = lines[line_idx].strip()
            if not line:
                continue

            values = line.split(",")
            if status_idx < len(values):
                old_status = values[status_idx]
                new_status = pred["status"]
                if old_status != new_status:
                    values[status_idx] = new_status
                    lines[line_idx] = ",".join(values) + "\n"
                    updated = True

        if updated:
            try:
                with open(CSV_PATH, "w", newline="") as f:
                    f.writelines(lines)
            except Exception as e:
                log.error("Failed to update CSV: %s", e)
