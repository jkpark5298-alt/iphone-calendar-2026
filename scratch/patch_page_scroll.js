const fs = require('fs');
const path = 'app/page.tsx';
let content = fs.readFileSync(path, 'utf8');

const target = `                 <button
                   type="button"
                   className="scroll-to-top-btn"
                   onClick={(e) => {
                     const listEl = e.currentTarget.parentElement?.querySelector('.info-index-list');
                     if (listEl) listEl.scrollTo({ top: 0, behavior: 'smooth' });
                   }}
                   title="맨위로"
                 >↑</button>`;

const replacement = `                 <button
                   type="button"
                   className="scroll-to-top-btn"
                   onClick={(e) => {
                     if (window.innerWidth <= 900) {
                       window.scrollTo({ top: 0, behavior: 'smooth' });
                     } else {
                       const listEl = e.currentTarget.parentElement?.querySelector('.info-index-list');
                       if (listEl) listEl.scrollTo({ top: 0, behavior: 'smooth' });
                     }
                   }}
                   title="맨위로"
                 >맨 위로 ↑</button>`;

// Normalize CRLF to LF for comparison, or do replacement on both
const normalize = (str) => str.replace(/\r\n/g, '\n').trim();

const targetNorm = normalize(target);

// Let's find index by normalized contents
const lines = content.split(/\r?\n/);
let foundIdx = -1;
for (let i = 0; i < lines.length - 8; i++) {
  const slice = lines.slice(i, i + 9).map(l => l.trim()).join('\n');
  if (slice === targetNorm) {
    foundIdx = i;
    break;
  }
}

if (foundIdx !== -1) {
  // Replace lines
  const indent = lines[foundIdx].match(/^\s*/)[0];
  const repLines = replacement.split('\n').map((line, idx) => {
    if (idx === 0) return line;
    return line; // keep spaces as defined in replacement
  });
  
  lines.splice(foundIdx, 9, ...repLines);
  fs.writeFileSync(path, lines.join('\r\n'), 'utf8');
  console.log('Successfully patched page.tsx!');
} else {
  console.log('Target block not found!');
}
