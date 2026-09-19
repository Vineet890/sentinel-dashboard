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

// Load env variables
require('dotenv').config();

// ─── SMS Alert Gateway ─────────────────────────────────────────────────────────

app.post('/api/test-alert', async (req, res) => {
    try {
        const apiKey = process.env.SMS_API_KEY;
        const phone = process.env.ALERT_PHONE;

        if (!apiKey || !phone) {
            console.error('SMS Gateway missing config: SMS_API_KEY or ALERT_PHONE not set in backend .env');
            return res.json({ success: false, message: 'SMS config missing on server' });
        }

        const payload = {
            phoneNumber: phone,
            message: "SENTINEL ALERT: Critical subsidence risk detected. Immediate inspection required."
        };

        const response = await fetch('https://us-central1-sms-gateway-ae7e1.cloudfunctions.net/api_sms_send', {
            method: 'POST',
            headers: {
                'X-API-Key': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            console.log('SMS Gateway Success:', data);
            return res.json({
                success: true,
                message: 'SMS queued successfully',
                smsId: data.smsId || 'unknown'
            });
        } else {
            console.error('SMS Gateway API Error:', response.status, data);
            return res.json({
                success: false,
                message: 'Failed to send SMS'
            });
        }
    } catch (error) {
        console.error('SMS Request failed:', error.message);
        return res.json({
            success: false,
            message: 'Failed to send SMS'
        });
    }
});

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});