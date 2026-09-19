import asyncio
import json
import logging
import csv
from datetime import datetime
from pathlib import Path
import websockets

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("sentinel.bridge")

JETSON_WS_URL = "ws://192.168.50.2:8000/ws"
CSV_PATH = Path(__file__).parent.parent / "backend" / "mock_data" / "sensor_log.csv"

# Make sure CSV exists and has header
if not CSV_PATH.exists():
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CSV_PATH, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp", "vibration", "acoustic", "pressure", "temperature", "status"])

async def connect_and_listen():
    log.info(f"Connecting to Jetson Nano at {JETSON_WS_URL}...")
    
    reconnect_delay = 1
    
    while True:
        try:
            async with websockets.connect(JETSON_WS_URL) as websocket:
                log.info("Connected to Jetson Nano!")
                reconnect_delay = 1  # Reset delay on successful connection
                
                async for message in websocket:
                    try:
                        data = json.loads(message)
                        sensors = data.get("sensors", {})
                        
                        # Extract data exactly as frontend normalizer does
                        timestamp = data.get("timestamp", datetime.utcnow().isoformat() + "Z")
                        
                        vibration = sensors.get("lis3dh", {}).get("magnitude_g", 0.0)
                        acoustic = sensors.get("mic", {}).get("db", 0.0)
                        pressure = sensors.get("bmp280", {}).get("pressure_hpa", 0.0)
                        temperature = sensors.get("bmp280", {}).get("temperature_c", 0.0)
                        
                        # Write to CSV with PENDING status for ML to pick up
                        row = [
                            timestamp,
                            f"{vibration:.4f}",
                            f"{acoustic:.1f}",
                            f"{pressure:.1f}",
                            f"{temperature:.1f}",
                            "PENDING"
                        ]
                        
                        with open(CSV_PATH, "a", newline="") as f:
                            writer = csv.writer(f)
                            writer.writerow(row)
                            
                        log.debug(f"Wrote frame to CSV: {row}")
                        
                    except json.JSONDecodeError:
                        log.warning("Received invalid JSON from Jetson.")
                    except Exception as e:
                        log.error(f"Error processing message: {e}")
                        
        except websockets.exceptions.ConnectionClosed:
            log.warning("Connection to Jetson closed. Reconnecting...")
        except Exception as e:
            log.error(f"WebSocket error: {e}. Retrying in {reconnect_delay}s...")
            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, 10)  # Exponential backoff max 10s

if __name__ == "__main__":
    try:
        asyncio.run(connect_and_listen())
    except KeyboardInterrupt:
        log.info("Shutting down Jetson bridge.")
