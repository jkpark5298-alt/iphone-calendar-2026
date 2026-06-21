const fs = require('fs');
const lines = fs.readFileSync('app/page.tsx', 'utf8').split(/\r?\n/);
for (let i = 5455; i < 5475; i++) {
  console.log(`${i+1}: ${JSON.stringify(lines[i])}`);
}
