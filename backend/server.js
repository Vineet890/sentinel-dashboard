const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();

app.use(cors());

const PORT = 5000;
const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8001';

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

// ─── Fetch ML prediction (non-blocking helper) ────────────────────────────────

let lastMlPrediction = null;
let mlEngineOnline = false;

async function fetchMlPrediction() {
    try {
        const response = await fetch(`${ML_API_URL}/api/ml/predict`, {
            signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
            lastMlPrediction = await response.json();
            mlEngineOnline = true;
        }
    } catch {
        // ML engine not available — use CSV status as-is
        mlEngineOnline = false;
    }
}

// Poll ML engine every 1.5s for latest prediction
setInterval(fetchMlPrediction, 1500);

// SIH 26025: Cloud Sync & Edge Buffering Simulation
let pendingCloudSync = [];
let totalSynced = 0;
let isCloudOnline = true;
const dns = require('dns').promises;

setInterval(async () => {
    try {
        await dns.resolve('google.com');
        isCloudOnline = true;
        if (pendingCloudSync.length > 0) {
            totalSynced += pendingCloudSync.length;
            pendingCloudSync = [];
        }
    } catch (e) {
        isCloudOnline = false;
    }
}, 5000);

app.get('/api/system-status', (req, res) => {
    try {
        const row = readLatestRow();
        const vib = parseFloat(row.vibration) || 0;
        const aco = parseFloat(row.acoustic) || 0;
        
        res.json({
            edgeProcessing: 'ACTIVE',
            cloudSync: {
                online: isCloudOnline,
                pending: pendingCloudSync.length,
                total: totalSynced
            },
            nodes: [
                { id: 'NODE-01', distance: 0, zone: 'ZONE-A', status: 'ACTIVE' },
                { id: 'NODE-02', distance: 25, zone: 'ZONE-A', status: 'ACTIVE' },
                { id: 'NODE-03', distance: 50, zone: 'ZONE-B', status: 'ACTIVE' },
                { id: 'NODE-04', distance: 75, zone: 'ZONE-B', status: 'ACTIVE' }
            ],
            prediction: {
                riskZone: (row.status !== 'NORMAL') ? 'ZONE-B' : 'ZONE-A',
                trend: (row.status === 'CRITICAL') ? 'INCREASING' : 'STABLE'
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate status' });
    }
});

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

        // Use ML engine prediction if available, otherwise fall back to CSV status
        if (mlEngineOnline && lastMlPrediction) {
            row.risk_score = lastMlPrediction.anomaly_score;
            row.risk_label = lastMlPrediction.status;
            // If CSV status is PENDING, use ML classification
            if (!row.status || row.status === 'PENDING') {
                row.status = lastMlPrediction.status;
            }

            // Attach ML feature breakdown
            row.ml = {
                anomaly_score: lastMlPrediction.anomaly_score,
                if_score: lastMlPrediction.if_score,
                zscore_score: lastMlPrediction.zscore_score,
                roc_score: lastMlPrediction.roc_score,
                status: lastMlPrediction.status,
                engine: 'online',
            };
        } else {
            // Fallback: simple weighted formula (legacy)
            const vib = parseFloat(row.vibration) || 0;
            const aco = parseFloat(row.acoustic) || 0;
            const vibNorm = Math.min(vib / 0.30, 1.0);
            const acoNorm = Math.min((aco - 40) / 60, 1.0);
            const riskScore = (0.60 * vibNorm + 0.40 * acoNorm);

            row.risk_score = riskScore.toFixed(2);
            row.risk_label = riskScore < 0.3 ? 'LOW' : riskScore < 0.6 ? 'MODERATE' : 'HIGH';

            // If CSV status is PENDING and no ML, use threshold-based status
            if (!row.status || row.status === 'PENDING') {
                row.status = riskScore >= 0.6 ? 'CRITICAL' : riskScore >= 0.3 ? 'WATCH' : 'NORMAL';
            }

            row.ml = { engine: 'offline' };
        }

        res.json(row);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read telemetry' });
    }
});

// ─── ML Engine Status Proxy ────────────────────────────────────────────────────

app.get('/api/ml-status', async (req, res) => {
    try {
        const response = await fetch(`${ML_API_URL}/api/ml/status`, {
            signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
            const data = await response.json();
            res.json({ online: true, ...data });
        } else {
            res.json({ online: false, error: 'ML engine returned non-OK' });
        }
    } catch {
        res.json({ online: false, error: 'ML engine not reachable' });
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
// Now reads the ML-determined status from the CSV (which the ML pipeline updates)
let lastMonitoredState = 'NORMAL';

setInterval(async () => {
    try {
        if (!fs.existsSync(csvPath)) return;
        const row = readLatestRow();
        if (!row || !row.status) return;

        // Use ML prediction status if available, otherwise CSV status
        let currentState = row.status;
        if (mlEngineOnline && lastMlPrediction) {
            currentState = lastMlPrediction.status;
        }

        // Skip PENDING status (ML hasn't classified yet)
        if (currentState === 'PENDING') return;

        // Edge trigger: Only trigger ONCE when transitioning INTO CRITICAL
        if (currentState === 'CRITICAL' && lastMonitoredState !== 'CRITICAL') {
            console.log("CRITICAL state detected by ML engine! Dispatching automatic SMS...");
            lastMonitoredState = 'CRITICAL';
            
            // Add a preliminary log
            autoSmsLogs.push({
                type: 'sms',
                timestamp: new Date().toISOString(),
                msg: 'ML ALERT — CRITICAL anomaly detected, SMS dispatched',
                level: 'critical'
            });

            const score = lastMlPrediction ? lastMlPrediction.anomaly_score : 'N/A';
            const msg = `SENTINEL ML ALERT: CRITICAL subsidence anomaly detected (score: ${score}) at site Alpha-3, Dhanbad. Immediate inspection required.`;
            const result = await sendSMSAlert(msg);
            
            if (result.success) {
                autoSmsLogs.push({
                    type: 'sms',
                    timestamp: new Date().toISOString(),
                    msg: 'ML ALERT — SMS queued successfully',
                    level: 'warn' 
                });
            } else {
                autoSmsLogs.push({
                    type: 'sms',
                    timestamp: new Date().toISOString(),
                    msg: 'ML ALERT — SMS dispatch failed',
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
    console.log(`ML Engine URL: ${ML_API_URL}`);
});