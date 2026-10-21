"use client";

import { useEffect } from "react";

/**
 * 예전 Supabase 프로젝트 주소로 남은 이미지/영상을 새 프로젝트 주소로 바꿔 보여 줍니다.
 * (2026-10 프로젝트 이전 때 파일은 같은 경로로 옮겨졌고, 예전 주소는 더 이상 열리지 않습니다.)
 * - 기기에 저장된 예전 사본(localStorage)의 주소도 한 번 고쳐 둡니다.
 */
const LEGACY_ORIGIN = "https://ykumumrvcapnehafexdl.supabase.co";
const CURRENT_ORIGIN = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");

function fixValue(value: string) {
  return value.split(LEGACY_ORIGIN).join(CURRENT_ORIGIN);
}

function fixElement(el: Element) {
  for (const attr of ["src", "poster", "href"]) {
    const value = el.getAttribute(attr);
    if (value && value.includes(LEGACY_ORIGIN)) el.setAttribute(attr, fixValue(value));
  }
}

function fixTree(root: ParentNode) {
  root.querySelectorAll?.("img, video, source, a").forEach(fixElement);
}

function fixLocalStorage() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key);
      if (value && value.includes(LEGACY_ORIGIN)) localStorage.setItem(key, fixValue(value));
    }
  } catch {
    // 저장 공간을 못 쓰는 환경이면 화면 표시만 고칩니다.
  }
}

export function LegacyMediaUrlFix() {
  useEffect(() => {
    if (!CURRENT_ORIGIN || CURRENT_ORIGIN === LEGACY_ORIGIN) return;
    fixLocalStorage();
    fixTree(document);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.target instanceof Element) {
          fixElement(m.target);
        } else {
          m.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            fixElement(node);
            fixTree(node);
          });
        }
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "poster", "href"] });
    return () => observer.disconnect();
  }, []);

  return null;
}
