"use client";

import { CONTENT_CLASSES } from "../lib/contentClass";

export function ClassTagSelect({ onSelect }: { onSelect: (label: string) => void }) {
  return (
    <label className="classTagSelect">
      <span>분류</span>
      <select
        value=""
        aria-label="분류 선택"
        onMouseDown={(event) => event.stopPropagation()}
        onChange={(event) => {
          const label = event.target.value;
          if (!label) return;
          onSelect(label);
        }}
      >
        <option value="">선택</option>
        {CONTENT_CLASSES.map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
