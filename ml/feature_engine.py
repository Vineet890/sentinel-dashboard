"""
Sentinel ML Pipeline — Feature Engineering

Transforms raw sensor readings into a rich feature vector suitable for
anomaly detection.  Features include rolling statistics, Z-scores,
rate-of-change, and inter-sensor ratios.
"""

import numpy as np
import pandas as pd

from config import (
    RAW_COLUMNS,
    ROLLING_WINDOWS,
    BUFFER_SIZE,
    ZSCORE_ALERT,
    ROC_SPIKE_MULT,
)


class FeatureEngine:
    """Stateful feature extractor that maintains a sliding window buffer."""

    def __init__(self):
        # Circular buffer of recent raw readings
        self._buffer = pd.DataFrame(columns=RAW_COLUMNS)
        # Running baseline stats (populated from training data or first N rows)
        self._baseline_mean = None
        self._baseline_std = None

    # ── Public API ──────────────────────────────────────────────────────────────

    def set_baseline(self, mean: dict, std: dict):
        """Set baseline statistics from training data."""
        self._baseline_mean = pd.Series(mean)
        self._baseline_std = pd.Series(std)

    def get_baseline(self):
        """Return current baseline stats as serialisable dicts."""
        if self._baseline_mean is None:
            return None, None
        return self._baseline_mean.to_dict(), self._baseline_std.to_dict()

    def push(self, row: dict) -> dict:
        """
        Accept a new raw sensor reading and return the engineered feature
        vector as a flat dictionary.

        Parameters
        ----------
        row : dict
            Must contain keys from RAW_COLUMNS with numeric values.

        Returns
        -------
        dict
            Feature vector with descriptive keys.
        """
        # Parse raw values
        raw = {col: float(row.get(col, 0) or 0) for col in RAW_COLUMNS}
        raw_series = pd.Series(raw)

        # Append to buffer (keep last BUFFER_SIZE rows)
        new_row = pd.DataFrame([raw])
        self._buffer = pd.concat([self._buffer, new_row], ignore_index=True).tail(BUFFER_SIZE)

        # Auto-bootstrap baseline from buffer if not set yet
        if self._baseline_mean is None and len(self._buffer) >= 20:
            self._baseline_mean = self._buffer.mean()
            self._baseline_std = self._buffer.std().replace(0, 1e-6)

        features = {}

        # 1) Raw values (normalised to reasonable ranges)
        features["vibration"] = raw["vibration"]
        features["acoustic"] = raw["acoustic"]
        features["pressure"] = raw["pressure"]
        features["temperature"] = raw["temperature"]

        # 2) Rolling statistics
        for w in ROLLING_WINDOWS:
            if len(self._buffer) >= w:
                window = self._buffer.tail(w)
                for col in RAW_COLUMNS:
                    features[f"{col}_mean_{w}"] = float(window[col].mean())
                    features[f"{col}_std_{w}"] = float(window[col].std())
            else:
                for col in RAW_COLUMNS:
                    features[f"{col}_mean_{w}"] = raw[col]
                    features[f"{col}_std_{w}"] = 0.0

        # 3) Z-scores (relative to baseline)
        zscore_values = []
        if self._baseline_mean is not None:
            for col in RAW_COLUMNS:
                std_val = self._baseline_std[col] if self._baseline_std[col] > 1e-8 else 1e-6
                z = abs(raw[col] - self._baseline_mean[col]) / std_val
                features[f"{col}_zscore"] = float(z)
                zscore_values.append(z)
        else:
            for col in RAW_COLUMNS:
                features[f"{col}_zscore"] = 0.0
                zscore_values.append(0.0)

        # Composite Z-score magnitude (L2 norm across channels)
        features["zscore_magnitude"] = float(np.linalg.norm(zscore_values))

        # Number of channels exceeding Z-score alert threshold
        features["zscore_alerts"] = sum(1 for z in zscore_values if z > ZSCORE_ALERT)

        # 4) Rate of change (delta from previous reading)
        if len(self._buffer) >= 2:
            prev = self._buffer.iloc[-2]
            for col in RAW_COLUMNS:
                delta = abs(raw[col] - float(prev[col]))
                features[f"{col}_delta"] = float(delta)

                # Check if delta is a spike relative to rolling std
                std_key = f"{col}_std_5"
                rolling_std = features.get(std_key, 1e-6)
                if rolling_std > 1e-8:
                    features[f"{col}_roc_ratio"] = float(delta / rolling_std)
                else:
                    features[f"{col}_roc_ratio"] = 0.0
        else:
            for col in RAW_COLUMNS:
                features[f"{col}_delta"] = 0.0
                features[f"{col}_roc_ratio"] = 0.0

        # Composite rate-of-change spike score
        roc_ratios = [features[f"{col}_roc_ratio"] for col in RAW_COLUMNS]
        max_roc = max(roc_ratios) if roc_ratios else 0.0
        features["roc_spike_score"] = float(
            min(max_roc / ROC_SPIKE_MULT, 1.0)
        )

        # 5) Inter-sensor ratios
        if raw["pressure"] > 0:
            features["vib_pressure_ratio"] = raw["vibration"] / raw["pressure"]
        else:
            features["vib_pressure_ratio"] = 0.0

        if raw["temperature"] > 0:
            features["pressure_temp_ratio"] = raw["pressure"] / raw["temperature"]
        else:
            features["pressure_temp_ratio"] = 0.0

        return features

    def extract_batch(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Process an entire DataFrame of raw readings and return engineered
        features.  Used for training.

        Resets the internal buffer before processing.
        """
        self.reset()

        rows = []
        for _, row in df.iterrows():
            feat = self.push(row.to_dict())
            rows.append(feat)

        return pd.DataFrame(rows)

    def reset(self):
        """Clear the sliding buffer and baseline."""
        self._buffer = pd.DataFrame(columns=RAW_COLUMNS)
        self._baseline_mean = None
        self._baseline_std = None

    def get_feature_names(self) -> list:
        """Return the list of feature names produced by push()."""
        # Generate a dummy to discover keys
        dummy = {col: 0.0 for col in RAW_COLUMNS}
        # Temporarily push two rows to get full feature set
        old_buffer = self._buffer.copy()
        old_mean = self._baseline_mean
        old_std = self._baseline_std
        self._baseline_mean = pd.Series({col: 0.0 for col in RAW_COLUMNS})
        self._baseline_std = pd.Series({col: 1.0 for col in RAW_COLUMNS})

        self.push(dummy)
        features = self.push(dummy)

        # Restore
        self._buffer = old_buffer
        self._baseline_mean = old_mean
        self._baseline_std = old_std

        return list(features.keys())
