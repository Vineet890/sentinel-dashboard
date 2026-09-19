const fs = require('fs');
let lines = fs.readFileSync('frontend/src/App.jsx', 'utf8').split('\n');
lines.splice(1205, 17, 
'            lines={[',
'              { key: \'v\', color: \'#2ECC71\', name: \'mbar\', yAxisId: \'left\' },',
'              { key: \'v2\', color: \'#F1C40F\', name: \'°C\', yAxisId: \'right\' },',
'            ]}',
'            unit=\"Barometer & Temp\"',
'            yDomain={[1005, 1025]}',
'            y2Domain={[10, 40]}',
'            latestValue={lastEnv !== undefined ? `${lastEnv.v} mbar · ${lastEnv.v2}°C` : \'—\'}',
'            yAxisWidth={50}',
'            y2AxisWidth={26}',
'            style={{ gridColumn: \'1 / -1\' }}',
'          />',
'          <MapCard state={systemState} />',
'        </div>',
'',
'        {/* Right — Event log */}',
'        <EventLog entries={logEntries} />'
);
fs.writeFileSync('frontend/src/App.jsx', lines.join('\n'));
console.log('Fixed lines!');
