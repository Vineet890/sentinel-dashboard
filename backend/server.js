const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();

app.use(cors());

const PORT = 5000;

const csvPath = path.join(
    __dirname,
    'mock_data',
    'sensor_log.csv'
);

const cameraPath = path.join(
    __dirname,
    'mock_data',
    'latest_capture.jpg'
);

// Track server start time for uptime calculation
const SERVER_START = Date.now();

function readLatestRow() {
    const data = fs
        .readFileSync(csvPath, 'utf8')
        .trim()
        .split('\n');

    const headers = data[0].split(',');
    const lastLine = data[data.length - 1].split(',');

    const row = {};

    headers.forEach((header, index) => {
        row[header] = lastLine[index];
    });

    return row;
}

// ─── Telemetry ─────────────────────────────────────────────────────────────────

app.get('/api/telemetry', (req, res) => {
    try {
        const row = readLatestRow();

        // Compute uptime from server start
        const uptimeMs = Date.now() - SERVER_START;
        const days = Math.floor(uptimeMs / 86400000);
        const hours = Math.floor((uptimeMs % 86400000) / 3600000);
        row.uptime = `${days}d ${hours}h`;

        // Compute risk score from sensor values (normalised 0–1)
        // Weighted combination: vibration contributes most, then acoustic, then strain deviation
        const vib = parseFloat(row.vibration) || 0;
        const aco = parseFloat(row.acoustic) || 0;
        const strain = parseFloat(row.strain) || 0;

        const vibNorm = Math.min(vib / 0.30, 1.0);           // 0.30 G = max expected
        const acoNorm = Math.min((aco - 40) / 60, 1.0);      // 40–100 dB range
        const strainNorm = Math.min(Math.abs(strain - 900) / 150, 1.0); // deviation from 900 kgF baseline

        const riskScore = (0.50 * vibNorm + 0.30 * acoNorm + 0.20 * strainNorm);
        row.risk_score = riskScore.toFixed(2);
        row.risk_label = riskScore < 0.3 ? 'LOW' : riskScore < 0.6 ? 'MODERATE' : 'HIGH';

        res.json(row);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read telemetry' });
    }
});

// ─── Event history ─────────────────────────────────────────────────────────────

app.get('/api/events', (req, res) => {
    try {
        const data = fs
            .readFileSync(csvPath, 'utf8')
            .trim()
            .split('\n');

        const headers = data[0].split(',');

        const rows = data
            .slice(1)
            .slice(-20)
            .map(line => {
                const values = line.split(',');
                const obj = {};

                headers.forEach((header, index) => {
                    obj[header] = values[index];
                });

                return obj;
            });

        res.json(rows.reverse());
    } catch (err) {
        res.status(500).json({ error: 'Failed to read events' });
    }
});

// ─── Camera snapshot ───────────────────────────────────────────────────────────
// Serves the latest JPEG capture from the camera pipeline.
// In production: the Jetson camera script saves frames to this path.
// In development: generate_mock.js creates a placeholder image.

app.get('/api/camera', (req, res) => {
    if (fs.existsSync(cameraPath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        fs.createReadStream(cameraPath).pipe(res);
    } else {
        res.status(404).json({ error: 'No camera capture available' });
    }
});

// ─── GSM Alert ─────────────────────────────────────────────────────────────────
// Attempts to execute the SIM900A SMS script. Falls back to mock if hardware
// is not connected (script not found or execution fails).

app.post('/api/test-alert', (req, res) => {
    const smsScript = path.join(__dirname, 'scripts', 'send_sms.py');

    // Check if the hardware SMS script exists
    if (fs.existsSync(smsScript)) {
        const message = 'SENTINEL ALERT: Mine subsidence warning — immediate inspection required at Site Alpha-3, Zone Level-7B';

        exec(`python3 "${smsScript}" "${message}"`, { timeout: 10000 }, (error, stdout, stderr) => {
            if (error) {
                console.error('GSM hardware dispatch failed:', stderr || error.message);
                // Fall back to mock response so the dashboard doesn't break
                res.json({
                    success: true,
                    message: 'Alert logged (GSM hardware unavailable)',
                    mode: 'fallback'
                });
            } else {
                console.log('GSM SMS dispatched:', stdout.trim());
                res.json({
                    success: true,
                    message: 'SMS dispatched via SIM900A',
                    mode: 'hardware'
                });
            }
        });
    } else {
        // No hardware script — mock mode for development
        console.log('Test alert triggered (mock — SIM900A script not found)');
        res.json({
            success: true,
            message: 'Test alert sent (mock)',
            mode: 'mock'
        });
    }
});

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});