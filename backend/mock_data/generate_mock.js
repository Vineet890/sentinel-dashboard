const fs = require('fs');
const path = require('path');

function randomStatus() {
    const r = Math.random();

    if (r > 0.95) return "CRITICAL";
    if (r > 0.85) return "WATCH";

    return "NORMAL";
}

function generateRow() {
    const now = new Date().toISOString();

    return {
        timestamp: now,
        vibration: (Math.random() * 0.3).toFixed(4),
        acoustic: (40 + Math.random() * 30).toFixed(1),
        pressure: (1010 + Math.random() * 10).toFixed(1),
        temperature: (18 + Math.random() * 8).toFixed(1),
        strain: (800 + Math.random() * 150).toFixed(1),
        status: randomStatus()
    };
}

const filePath = path.join(__dirname, 'sensor_log.csv');

if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
        filePath,
        "timestamp,vibration,acoustic,pressure,temperature,strain,status\n"
    );
}

setInterval(() => {
    const row = generateRow();

    const line =
        `${row.timestamp},${row.vibration},${row.acoustic},${row.pressure},${row.temperature},${row.strain},${row.status}\n`;

    fs.appendFileSync(filePath, line);

    console.log("Wrote:", line.trim());
}, 2000);