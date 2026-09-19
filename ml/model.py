"""
Sentinel ML Pipeline — Anomaly Detection Model

Isolation Forest-based anomaly detector with composite scoring.
Handles training, persistence, inference, and status classification.
"""

import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from config import (
    CSV_PATH,
    MODEL_DIR,
    MODEL_PATH,
    SCALER_PATH,
    BASELINE_PATH,
    RAW_COLUMNS,
    IF_N_ESTIMATORS,
    IF_CONTAMINATION,
    IF_RANDOM_STATE,
    IF_MAX_SAMPLES,
    WEIGHT_IF,
    WEIGHT_ZSCORE,
    WEIGHT_ROC,
    THRESHOLD_WATCH,
    THRESHOLD_CRITICAL,
    MIN_TRAIN_ROWS,
)
from feature_engine import FeatureEngine

log = logging.getLogger("sentinel.model")


class AnomalyModel:
    """Wraps Isolation Forest + feature scaling + composite scoring."""

    def __init__(self):
        self.model: IsolationForest | None = None
        self.scaler: StandardScaler | None = None
        self.feature_engine = FeatureEngine()
        self.feature_names: list[str] = []
        self.is_trained = False
        self.train_samples = 0
        self.train_timestamp = None

    # ── Training ────────────────────────────────────────────────────────────────

    def train(self, csv_path: Path | None = None) -> dict:
        """
        Train the Isolation Forest on historical CSV data.

        Parameters
        ----------
        csv_path : Path, optional
            Path to the sensor CSV.  Defaults to config.CSV_PATH.

        Returns
        -------
        dict
            Training report with sample count, feature count, score stats.
        """
        csv_path = csv_path or CSV_PATH

        if not csv_path.exists():
            raise FileNotFoundError(f"Training CSV not found: {csv_path}")

        log.info("Loading training data from %s", csv_path)
        df = pd.read_csv(csv_path)

        if len(df) < MIN_TRAIN_ROWS:
            raise ValueError(
                f"Need at least {MIN_TRAIN_ROWS} rows to train, got {len(df)}"
            )

        # Clean: drop rows with NaN in sensor columns, keep only numeric
        for col in RAW_COLUMNS:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=[c for c in RAW_COLUMNS if c in df.columns])

        log.info("Training on %d rows", len(df))

        # Compute baseline stats from training data
        baseline_mean = df[RAW_COLUMNS].mean().to_dict()
        baseline_std = df[RAW_COLUMNS].std().to_dict()
        # Prevent zero std
        for k in baseline_std:
            if baseline_std[k] < 1e-8:
                baseline_std[k] = 1e-6

        # Engineer features
        self.feature_engine.reset()
        self.feature_engine.set_baseline(baseline_mean, baseline_std)
        features_df = self.feature_engine.extract_batch(df)

        # Drop any remaining NaN/inf
        features_df = features_df.replace([np.inf, -np.inf], np.nan).fillna(0)

        self.feature_names = list(features_df.columns)

        # Scale features
        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(features_df)

        # Train Isolation Forest
        self.model = IsolationForest(
            n_estimators=IF_N_ESTIMATORS,
            contamination=IF_CONTAMINATION,
            random_state=IF_RANDOM_STATE,
            max_samples=IF_MAX_SAMPLES,
        )
        self.model.fit(X_scaled)

        self.is_trained = True
        self.train_samples = len(df)
        self.train_timestamp = pd.Timestamp.now().isoformat()

        # Save model artifacts
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.model, MODEL_PATH)
        joblib.dump(self.scaler, SCALER_PATH)
        joblib.dump(
            {"mean": baseline_mean, "std": baseline_std, "feature_names": self.feature_names},
            BASELINE_PATH,
        )
        log.info("Model saved to %s", MODEL_PATH)

        # Compute training score distribution for the report
        train_scores = self.model.decision_function(X_scaled)
        raw_scores = self._normalise_if_scores(train_scores)

        report = {
            "samples": len(df),
            "features": len(self.feature_names),
            "score_mean": float(np.mean(raw_scores)),
            "score_std": float(np.std(raw_scores)),
            "score_min": float(np.min(raw_scores)),
            "score_max": float(np.max(raw_scores)),
            "timestamp": self.train_timestamp,
        }
        log.info("Training complete: %s", report)
        return report

    # ── Loading ─────────────────────────────────────────────────────────────────

    def load(self) -> bool:
        """Load a previously trained model from disk."""
        if not MODEL_PATH.exists():
            log.warning("No saved model found at %s", MODEL_PATH)
            return False

        try:
            self.model = joblib.load(MODEL_PATH)
            self.scaler = joblib.load(SCALER_PATH)
            baseline = joblib.load(BASELINE_PATH)
            self.feature_engine.set_baseline(baseline["mean"], baseline["std"])
            self.feature_names = baseline.get("feature_names", self.feature_engine.get_feature_names())
            self.is_trained = True
            log.info("Model loaded from %s", MODEL_PATH)
            return True
        except Exception as e:
            log.error("Failed to load model: %s", e)
            return False

    # ── Inference ───────────────────────────────────────────────────────────────

    def predict(self, raw_row: dict) -> dict:
        """
        Run anomaly detection on a single raw sensor reading.

        Parameters
        ----------
        raw_row : dict
            Raw sensor values (vibration, acoustic, pressure, temperature).

        Returns
        -------
        dict
            {
                "anomaly_score": float (0.0-1.0),
                "if_score": float,
                "zscore_score": float,
                "roc_score": float,
                "status": str (NORMAL/WATCH/CRITICAL),
                "features": dict,
            }
        """
        if not self.is_trained:
            return {
                "anomaly_score": 0.0,
                "if_score": 0.0,
                "zscore_score": 0.0,
                "roc_score": 0.0,
                "status": "NORMAL",
                "features": {},
                "error": "Model not trained",
            }

        # Engineer features
        features = self.feature_engine.push(raw_row)

        # Prepare feature vector in correct order
        feat_values = [features.get(name, 0.0) for name in self.feature_names]
        feat_array = np.array([feat_values])
        feat_array = np.nan_to_num(feat_array, nan=0.0, posinf=0.0, neginf=0.0)

        # Scale
        feat_scaled = self.scaler.transform(feat_array)

        # Isolation Forest score
        raw_if_score = self.model.decision_function(feat_scaled)[0]
        if_score = self._normalise_if_scores(np.array([raw_if_score]))[0]

        # Z-score component (from feature engine)
        zscore_mag = features.get("zscore_magnitude", 0.0)
        # Normalise: Z-score magnitude of 5+ maps to 1.0
        zscore_score = min(zscore_mag / 5.0, 1.0)

        # Rate-of-change component
        roc_score = features.get("roc_spike_score", 0.0)

        # Composite anomaly score
        composite = (
            WEIGHT_IF * if_score
            + WEIGHT_ZSCORE * zscore_score
            + WEIGHT_ROC * roc_score
        )
        composite = float(np.clip(composite, 0.0, 1.0))

        # Classify
        status = self.classify(composite)

        return {
            "anomaly_score": round(composite, 4),
            "if_score": round(float(if_score), 4),
            "zscore_score": round(float(zscore_score), 4),
            "roc_score": round(float(roc_score), 4),
            "status": status,
            "features": {
                "zscore_magnitude": round(zscore_mag, 4),
                "zscore_alerts": int(features.get("zscore_alerts", 0)),
                "roc_spike_score": round(roc_score, 4),
                "vibration": features.get("vibration", 0),
                "acoustic": features.get("acoustic", 0),
                "pressure": features.get("pressure", 0),
                "temperature": features.get("temperature", 0),
            },
        }

    # ── Classification ──────────────────────────────────────────────────────────

    @staticmethod
    def classify(score: float) -> str:
        """Map composite anomaly score to status label."""
        if score >= THRESHOLD_CRITICAL:
            return "CRITICAL"
        elif score >= THRESHOLD_WATCH:
            return "WATCH"
        else:
            return "NORMAL"

    # ── Helpers ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _normalise_if_scores(scores: np.ndarray) -> np.ndarray:
        """
        Convert Isolation Forest decision_function output to 0–1 range.

        IF decision_function returns negative values for anomalies and
        positive for normal points.  We invert and scale so that:
          - 0.0 = very normal
          - 1.0 = very anomalous
        """
        # Invert: more negative → more anomalous → higher score
        inverted = -scores
        # Shift so minimum is 0
        shifted = inverted - inverted.min()
        # Scale to 0–1
        max_val = shifted.max()
        if max_val > 1e-8:
            normalised = shifted / max_val
        else:
            normalised = np.zeros_like(shifted)
        return normalised

    def get_info(self) -> dict:
        """Return model metadata."""
        return {
            "is_trained": self.is_trained,
            "train_samples": self.train_samples,
            "train_timestamp": self.train_timestamp,
            "n_features": len(self.feature_names),
            "model_path": str(MODEL_PATH),
            "thresholds": {
                "watch": THRESHOLD_WATCH,
                "critical": THRESHOLD_CRITICAL,
            },
            "weights": {
                "isolation_forest": WEIGHT_IF,
                "zscore": WEIGHT_ZSCORE,
                "rate_of_change": WEIGHT_ROC,
            },
        }
