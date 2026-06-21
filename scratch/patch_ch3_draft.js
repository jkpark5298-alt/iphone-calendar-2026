const fs = require('fs');
let content = fs.readFileSync('components/Chapter3Info.tsx', 'utf8');

const normalizeNewlines = (str) => str.replace(/\r\n/g, '\n');
let normContent = normalizeNewlines(content);

// 1. Add handleSaveTemporaryGeneralInfoDraft to Chapter3InfoProps interface
const oldPropSearch = `  handleConfirmGeneralInfo: () => void;`;
const newPropSearch = `  handleConfirmGeneralInfo: () => void;
  handleSaveTemporaryGeneralInfoDraft: () => void;`;

if (normContent.includes(oldPropSearch)) {
  normContent = normContent.replace(oldPropSearch, newPropSearch);
  console.log('Added handleSaveTemporaryGeneralInfoDraft to Props interface.');
} else {
  console.log('oldPropSearch not matched.');
}

// 2. Add to parameter destructuring of Chapter3Info function
const oldDestructSearch = `  handleConfirmGeneralInfo,`;
const newDestructSearch = `  handleConfirmGeneralInfo,
  handleSaveTemporaryGeneralInfoDraft,`;

if (normContent.includes(oldDestructSearch)) {
  normContent = normContent.replace(oldDestructSearch, newDestructSearch);
  console.log('Added to destructured parameters.');
} else {
  console.log('oldDestructSearch not matched.');
}

// 3. Remove description text and adjust style in iPhone paste zone
const oldPasteZone = `          {/* 아이폰 붙여넣기 존 */}
          <div
            className="generalInfoIphonePasteZone"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            tabIndex={0}
            onPaste={handleGeneralInfoIphonePasteZonePaste}
          >
            <strong>📱 아이폰 이미지/인스타 링크 붙여넣기</strong>
            <p>
              인스타·카카오톡·Safari에서 이미지나 링크를 복사한 뒤 이 박스를 길게 눌러
              [붙여넣기]를 선택하세요. 이미지가 직접 들어오지 않으면 사진 앱에 저장 후
              [이미지/동영상 선택]을 사용하세요.
            </p>
          </div>`;

const newPasteZone = `          {/* 아이폰 붙여넣기 존 */}
          <div
            className="generalInfoIphonePasteZone"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            tabIndex={0}
            onPaste={handleGeneralInfoIphonePasteZonePaste}
            style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", padding: "15px", cursor: "pointer" }}
          >
            <strong>📱 아이폰 이미지/인스타 링크 붙여넣기</strong>
          </div>`;

let normOldPaste = normalizeNewlines(oldPasteZone);
let normNewPaste = normalizeNewlines(newPasteZone);

if (normContent.includes(normOldPaste)) {
  normContent = normContent.replace(normOldPaste, normNewPaste);
  console.log('Cleaned up iPhone paste zone description and updated style.');
} else {
  console.log('oldPasteZone not matched.');
}

// 4. Add "임시 저장" button next to "Confirm 저장"
const oldConfirmBtn = `            <button className="gradientButton" onClick={handleConfirmGeneralInfo}>
              {generalInfoEditingId ? "수정 저장" : "Confirm 저장"}
            </button>`;

const newConfirmBtn = `            <button className="gradientButton" onClick={handleConfirmGeneralInfo}>
              {generalInfoEditingId ? "수정 저장" : "Confirm 저장"}
            </button>
            <button
              className="secondaryButton"
              type="button"
              onClick={handleSaveTemporaryGeneralInfoDraft}
              style={{ background: "rgba(122, 184, 255, 0.12)", color: "#7ab8ff", border: "1px solid rgba(122, 184, 255, 0.25)" }}
            >
              💾 임시 저장
            </button>`;

let normOldBtn = normalizeNewlines(oldConfirmBtn);
let normNewBtn = normalizeNewlines(newConfirmBtn);

if (normContent.includes(normOldBtn)) {
  normContent = normContent.replace(normOldBtn, normNewBtn);
  console.log('Added "임시 저장" button.');
} else {
  console.log('oldConfirmBtn not matched.');
}

fs.writeFileSync('components/Chapter3Info.tsx', normContent.replace(/\n/g, '\r\n'), 'utf8');
console.log('Done patching Chapter3Info.tsx!');
