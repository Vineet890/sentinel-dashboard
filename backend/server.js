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

        // Compute uptime from server start (legacy string for old clients)
        const uptimeMs = Date.now() - SERVER_START;
        const days = Math.floor(uptimeMs / 86400000);
        const hours = Math.floor((uptimeMs % 86400000) / 3600000);
        row.uptime = `${days}d ${hours}h`;
        
        // Expose raw start timestamp so frontend can calculate dynamic uptime
        row.server_start = SERVER_START;

        // Compute risk score from sensor values (normalised 0–1)
        // Weighted combination: vibration contributes most, then acoustic
        const vib = parseFloat(row.vibration) || 0;
        const aco = parseFloat(row.acoustic) || 0;

        const vibNorm = Math.min(vib / 0.30, 1.0);           // 0.30 G = max expected
        const acoNorm = Math.min((aco - 40) / 60, 1.0);      // 40–100 dB range

        const riskScore = (0.60 * vibNorm + 0.40 * acoNorm);
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

        // Combine telemetry and SMS logs, sort by timestamp
        let combined = [...rows, ...autoSmsLogs];
        combined.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        // Take last 20
        combined = combined.slice(-20);

        // Reverse to match the existing API behavior (newest first)
        res.json(combined.reverse());
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

const autoSmsLogs = [];

async function sendSMSAlert(message) {
    const apiKey = process.env.SMS_API_KEY;
    const phone = process.env.ALERT_PHONE;

    if (!apiKey || !phone) {
        console.error('SMS Gateway missing config: SMS_API_KEY or ALERT_PHONE not set in backend .env');
        return { success: false, message: 'SMS config missing on server' };
    }

    const payload = {
        phoneNumber: phone,
        message: message
    };

    try {
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
            return {
                success: true,
                message: 'SMS queued successfully',
                smsId: data.smsId || 'unknown'
            };
        } else {
            console.error('SMS Gateway API Error:', response.status, data);
            return {
                success: false,
                message: 'Failed to send SMS'
            };
        }
    } catch (error) {
        console.error('SMS Request failed:', error.message);
        return {
            success: false,
            message: 'Failed to send SMS'
        };
    }
}

// ─── SMS Alert Gateway ─────────────────────────────────────────────────────────

app.post('/api/test-alert', async (req, res) => {
    // Record the manual action in the persistent log array so it isn't erased
    autoSmsLogs.push({
        type: 'sms',
        timestamp: new Date().toISOString(),
        msg: 'MANUAL TEST — SMS dispatched to control room',
        level: 'info'
    });

    const result = await sendSMSAlert("SENTINEL ALERT: CRITICAL subsidence risk detected at site Alpha-3, Dhanbad. Immediate inspection required.");
    
    // Log the API result
    autoSmsLogs.push({
        type: 'sms',
        timestamp: new Date().toISOString(),
        msg: result.message || (result.success ? 'MANUAL TEST — SMS queued successfully' : 'MANUAL TEST — SMS dispatch failed'),
        level: result.success ? 'warn' : 'critical'
    });

    res.json(result);
});

// ─── Automatic State Monitor ───────────────────────────────────────────────────
let lastMonitoredState = 'NORMAL';

setInterval(async () => {
    try {
        if (!fs.existsSync(csvPath)) return;
        const row = readLatestRow();
        if (!row || !row.status) return;

        const currentState = row.status;

        // Edge trigger: Only trigger ONCE when transitioning INTO CRITICAL
        if (currentState === 'CRITICAL' && lastMonitoredState !== 'CRITICAL') {
            console.log("CRITICAL state detected! Dispatching automatic SMS...");
            lastMonitoredState = 'CRITICAL';
            
            // Add a preliminary log
            autoSmsLogs.push({
                type: 'sms',
                timestamp: new Date().toISOString(),
                msg: 'CRITICAL ALERT — SMS dispatched to control room',
                level: 'critical'
            });

            const msg = "SENTINEL ALERT: CRITICAL subsidence risk detected at site Alpha-3, Dhanbad. Immediate inspection required.";
            const result = await sendSMSAlert(msg);
            
            if (result.success) {
                autoSmsLogs.push({
                    type: 'sms',
                    timestamp: new Date().toISOString(),
                    msg: 'CRITICAL ALERT — SMS queued successfully',
                    level: 'warn' 
                });
            } else {
                autoSmsLogs.push({
                    type: 'sms',
                    timestamp: new Date().toISOString(),
                    msg: 'CRITICAL ALERT — SMS dispatch failed',
                    level: 'critical'
                });
            }
        } else if (currentState !== 'CRITICAL') {
            // Re-arm when the state drops back below CRITICAL
            lastMonitoredState = currentState;
        }
    } catch (e) {
        console.error("Monitor loop error:", e.message);
    }
}, 2000); // Check every 2 seconds

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});