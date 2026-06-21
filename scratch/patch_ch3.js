const fs = require('fs');
let content = fs.readFileSync('components/Chapter3Info.tsx', 'utf8');

const normalizeNewlines = (str) => str.replace(/\r\n/g, '\n');
let normContent = normalizeNewlines(content);

// Left column scroll button replacement
const oldLeftButton = `        <button
          type="button"
          className="scroll-to-top-btn"
          onClick={(e) => {
            if (window.innerWidth <= 1100) {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              e.currentTarget.parentElement?.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          title="맨위로"
        >↑</button>`;

const newLeftButton = `        <button
          type="button"
          className="scroll-to-top-btn"
          onClick={(e) => {
            if (window.innerWidth <= 1100) {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              e.currentTarget.parentElement?.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          title="맨위로"
        >맨 위로 ↑</button>`;

// Right column scroll button replacement
const oldRightButton = `        <button
          type="button"
          className="scroll-to-top-btn"
          onClick={(e) => {
            const listEl = e.currentTarget.parentElement?.querySelector('.generalInfoList');
            if (listEl) listEl.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          title="맨위로"
        >↑</button>`;

const newRightButton = `        <button
          type="button"
          className="scroll-to-top-btn"
          onClick={(e) => {
            if (window.innerWidth <= 1100) {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              const listEl = e.currentTarget.parentElement?.querySelector('.generalInfoList');
              if (listEl) listEl.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          title="맨위로"
        >맨 위로 ↑</button>`;

let normOldLeft = normalizeNewlines(oldLeftButton);
let normNewLeft = normalizeNewlines(newLeftButton);
let normOldRight = normalizeNewlines(oldRightButton);
let normNewRight = normalizeNewlines(newRightButton);

let matched = 0;
if (normContent.includes(normOldLeft)) {
  normContent = normContent.replace(normOldLeft, normNewLeft);
  matched++;
}
if (normContent.includes(normOldRight)) {
  normContent = normContent.replace(normOldRight, normNewRight);
  matched++;
}

if (matched > 0) {
  fs.writeFileSync('components/Chapter3Info.tsx', normContent.replace(/\n/g, '\r\n'), 'utf8');
  console.log(`Successfully patched ${matched} button(s) in Chapter3Info.tsx!`);
} else {
  console.log('Scroll buttons not found in Chapter3Info.tsx!');
}
