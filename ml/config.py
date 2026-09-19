"""
Sentinel ML Pipeline — Central Configuration
"""

import os
from pathlib import Path

# ─── Paths ──────────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent

# Shared CSV data store (same file the hardware / mock generator writes to)
CSV_PATH = PROJECT_ROOT / "backend" / "mock_data" / "sensor_log.csv"

# Trained model storage
MODEL_DIR = BASE_DIR / "models"
MODEL_PATH = MODEL_DIR / "isolation_forest.joblib"
SCALER_PATH = MODEL_DIR / "scaler.joblib"
BASELINE_PATH = MODEL_DIR / "baseline_stats.joblib"

# ─── Sensor columns ────────────────────────────────────────────────────────────

RAW_COLUMNS = ["vibration", "acoustic", "pressure", "temperature"]

# CSV schema (must match generate_mock.js output)
CSV_COLUMNS = ["timestamp", "vibration", "acoustic", "pressure", "temperature", "status"]

# ─── Feature engineering ────────────────────────────────────────────────────────

# Rolling window sizes for statistical features
ROLLING_WINDOWS = [5, 10, 20]

# Number of recent readings to keep in the sliding buffer
BUFFER_SIZE = 100

# ─── Model hyperparameters ──────────────────────────────────────────────────────

# Isolation Forest
IF_N_ESTIMATORS = 150
IF_CONTAMINATION = 0.05  # Expected fraction of anomalies in training data
IF_RANDOM_STATE = 42
IF_MAX_SAMPLES = "auto"

# ─── Scoring thresholds ────────────────────────────────────────────────────────

# Composite score weights
WEIGHT_IF = 0.60       # Isolation Forest anomaly score
WEIGHT_ZSCORE = 0.25   # Multi-channel Z-score magnitude
WEIGHT_ROC = 0.15      # Rate-of-change spike magnitude

# Status classification boundaries (on composite score 0.0 – 1.0)
THRESHOLD_WATCH = 0.30
THRESHOLD_CRITICAL = 0.60

# Z-score threshold for individual channel flagging
ZSCORE_ALERT = 2.5

# Rate-of-change spike multiplier (relative to rolling std)
ROC_SPIKE_MULT = 3.0

# ─── Auto-retrain ──────────────────────────────────────────────────────────────

# Retrain after accumulating this many new normal readings since last train
RETRAIN_AFTER_N = 500

# Minimum rows required to train a model
MIN_TRAIN_ROWS = 50

# ─── API server ─────────────────────────────────────────────────────────────────

API_HOST = "0.0.0.0"
API_PORT = int(os.environ.get("ML_API_PORT", 8001))

# ─── Detector loop ──────────────────────────────────────────────────────────────

# How often (seconds) to poll the CSV for new rows
POLL_INTERVAL = 1.5

# How many recent predictions to keep in history
PREDICTION_HISTORY_SIZE = 200
