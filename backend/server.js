const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(cors());

const PORT = 5000;

const csvPath = path.join(
    __dirname,
    'mock_data',
    'sensor_log.csv'
);

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

app.get('/api/telemetry', (req, res) => {
    res.json(readLatestRow());
});

app.get('/api/events', (req, res) => {
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
});

app.post('/api/test-alert', (req, res) => {
    console.log(
        'Test alert triggered (mock — will call gsm_alert.py later)'
    );

    res.json({
        success: true,
        message: 'Test alert sent (mock)'
    });
});

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});