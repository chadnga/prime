const { spawn } = require('child_process');

function run(file) {
  const proc = spawn('node', [file], { stdio: 'inherit' });
  proc.on('exit', (code) => {
    console.log(`${file} exited with code ${code} — restarting in 3s...`);
    setTimeout(() => run(file), 3000);
  });
}

console.log('🚀 Starting PrimeLooks bot + dashboard...');
run('index.js');
run('dashboard.js');
