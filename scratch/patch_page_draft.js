const fs = require('fs');
let content = fs.readFileSync('app/page.tsx', 'utf8');

const normalizeNewlines = (str) => str.replace(/\r\n/g, '\n');
let normContent = normalizeNewlines(content);

const oldPropCall = `              loadGeneralInfoItemsFromSupabase={infoState.loadGeneralInfoItemsFromSupabase}
              generalInfoSupabaseStatus={infoState.generalInfoSupabaseStatus}
              generalInfoCategories={infoState.generalInfoCategories}
              normalizeGeneralInfoMediaItems={infoState.normalizeGeneralInfoMediaItems}
              getGeneralInfoDisplayMediaItems={infoState.getGeneralInfoDisplayMediaItems}
            />`;

const newPropCall = `              loadGeneralInfoItemsFromSupabase={infoState.loadGeneralInfoItemsFromSupabase}
              generalInfoSupabaseStatus={infoState.generalInfoSupabaseStatus}
              generalInfoCategories={infoState.generalInfoCategories}
              normalizeGeneralInfoMediaItems={infoState.normalizeGeneralInfoMediaItems}
              getGeneralInfoDisplayMediaItems={infoState.getGeneralInfoDisplayMediaItems}
              handleSaveTemporaryGeneralInfoDraft={infoState.handleSaveTemporaryGeneralInfoDraft}
            />`;

let normOldCall = normalizeNewlines(oldPropCall);
let normNewCall = normalizeNewlines(newPropCall);

if (normContent.includes(normOldCall)) {
  normContent = normContent.replace(normOldCall, normNewCall);
  fs.writeFileSync('app/page.tsx', normContent.replace(/\n/g, '\r\n'), 'utf8');
  console.log('Successfully passed handleSaveTemporaryGeneralInfoDraft prop in page.tsx!');
} else {
  console.log('Target properties block not found in page.tsx!');
}
