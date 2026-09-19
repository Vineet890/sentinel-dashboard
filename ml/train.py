"""
Sentinel ML Pipeline — Standalone Training Script

Usage:
    py ml/train.py              # Train on the default sensor_log.csv
    py ml/train.py path/to.csv  # Train on a specific CSV
"""

import sys
import logging
from pathlib import Path

# Ensure ml/ is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import CSV_PATH, MODEL_PATH
from model import AnomalyModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("sentinel.train")


def main():
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else CSV_PATH

    print("=" * 60)
    print("  SENTINEL ML — Model Training")
    print("=" * 60)
    print(f"  CSV source:  {csv_path}")
    print(f"  Model dest:  {MODEL_PATH}")
    print()

    if not csv_path.exists():
        print(f"ERROR: CSV file not found: {csv_path}")
        print("  Run 'node backend/mock_data/generate_mock.js' first to")
        print("  generate training data, then try again.")
        sys.exit(1)

    model = AnomalyModel()

    try:
        report = model.train(csv_path)
    except ValueError as e:
        print(f"ERROR: {e}")
        print("  Generate more sensor data and try again.")
        sys.exit(1)

    print()
    print("  Training Report")
    print("  " + "-" * 40)
    print(f"  Samples used:    {report['samples']}")
    print(f"  Features:        {report['features']}")
    print(f"  Score mean:      {report['score_mean']:.4f}")
    print(f"  Score std:       {report['score_std']:.4f}")
    print(f"  Score range:     [{report['score_min']:.4f}, {report['score_max']:.4f}]")
    print(f"  Trained at:      {report['timestamp']}")
    print()
    print(f"  Model saved to: {MODEL_PATH}")
    print("=" * 60)


if __name__ == "__main__":
    main()
