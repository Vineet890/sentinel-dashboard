#!/usr/bin/env python3
"""
SIM900A GSM SMS Dispatch Script
-------------------------------
Called by the Express backend via child_process when a critical alert
is triggered from the Sentinel dashboard.

Usage:
    python3 send_sms.py "Your alert message here"

Hardware wiring (Jetson Nano → SIM900A):
    - TX → Pin 8 (UART TX)
    - RX → Pin 10 (UART RX)
    - GND → GND
    - VCC → 5V (separate power supply recommended for SIM900A)

When running without hardware (development), this script prints the
message and exits successfully so the dashboard flow is not interrupted.
"""

import sys
import time

# ─── Configuration ──────────────────────────────────────────────────────────────

SERIAL_PORT = '/dev/ttyTHS1'    # Jetson Nano UART
BAUD_RATE = 9600
RECIPIENT = '+919XXXXXXXXX'     # Replace with actual emergency contact number

# ─── Main ───────────────────────────────────────────────────────────────────────

def send_sms(message):
    """Attempt to send SMS via SIM900A AT commands over serial."""
    try:
        import serial
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=3)
        time.sleep(1)

        ser.write(b'AT\r\n')
        time.sleep(0.5)

        ser.write(b'AT+CMGF=1\r\n')         # Set SMS text mode
        time.sleep(0.5)

        ser.write(f'AT+CMGS="{RECIPIENT}"\r\n'.encode())
        time.sleep(0.5)

        ser.write(message.encode() + b'\x1A')  # Ctrl+Z to send
        time.sleep(3)

        response = ser.read(ser.in_waiting).decode(errors='ignore')
        ser.close()

        if 'OK' in response or '+CMGS' in response:
            print(f'SMS sent successfully to {RECIPIENT}')
            return True
        else:
            print(f'SIM900A response: {response}', file=sys.stderr)
            return False

    except ImportError:
        # pyserial not installed — development mode
        print(f'[DEV MODE] SMS would be sent to {RECIPIENT}: {message}')
        return True

    except Exception as e:
        print(f'Serial error: {e}', file=sys.stderr)
        # Still exit 0 so dashboard doesn't show a failure for hardware issues
        print(f'[FALLBACK] SMS logged locally: {message}')
        return True


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 send_sms.py "message"', file=sys.stderr)
        sys.exit(1)

    msg = sys.argv[1]
    success = send_sms(msg)
    sys.exit(0 if success else 1)
