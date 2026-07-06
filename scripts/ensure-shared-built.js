const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const distIndex = path.join(root, 'packages', 'shared', 'dist', 'index.js');

if (fs.existsSync(distIndex)) {
  process.exit(0);
}

console.log('Building @afios/shared (dist missing)...');
execSync('npm run build -w @afios/shared', { stdio: 'inherit', cwd: root });
