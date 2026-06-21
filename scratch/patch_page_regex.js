const fs = require('fs');
let content = fs.readFileSync('app/page.tsx', 'utf8');

// We will locate the target section by replacing the button block with the correct indent
const oldButton = `                <button
                  type="button"
                  className="scroll-to-top-btn"
                  onClick={(e) => {
                    const listEl = e.currentTarget.parentElement?.querySelector('.info-index-list');
                    if (listEl) listEl.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  title="맨위로"
                >↑</button>`;

const newButton = `                <button
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

const normalizeNewlines = (str) => str.replace(/\r\n/g, '\n');

let normContent = normalizeNewlines(content);
let normOld = normalizeNewlines(oldButton);
let normNew = normalizeNewlines(newButton);

if (normContent.includes(normOld)) {
  normContent = normContent.replace(normOld, normNew);
  // Restore CRLF line endings
  fs.writeFileSync('app/page.tsx', normContent.replace(/\n/g, '\r\n'), 'utf8');
  console.log('Successfully patched page.tsx!');
} else {
  console.log('Target scroll button not found in page.tsx!');
}
