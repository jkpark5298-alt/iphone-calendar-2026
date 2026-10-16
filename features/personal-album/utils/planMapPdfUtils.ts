import type { DayPlan, PlanRequest, PlanScheduleSegment } from "../types";
import { getPlanDayColor } from "./planConstants";
import { getEffectiveDeparture } from "./planUtils";

export type PlanMapPdfPlace = {
  order: number;
  name: string;
  timeLabel: string;
};

/** PDF API 요청용 — base64 사진 등 대용량 필드 제외 (Failed to fetch 방지) */
function slimScheduleSegmentForMapPdf(seg: PlanScheduleSegment): PlanScheduleSegment {
  return {
    label: seg.label,
    place: seg.place,
    address: seg.address,
    dining: seg.dining,
  };
}

export function slimDayPlansForMapPdfRequest(dayPlans: DayPlan[]): DayPlan[] {
  const slimBlock = (place?: string) =>
    place?.trim()
      ? { place, feature: "", intro: "", transport: "", evaluation: "", referenceDate: "" }
      : undefined;

  return dayPlans.map((dp) => ({
    day: dp.day,
    title: dp.title,
    dateLabel: dp.dateLabel,
    mainPlaces: dp.mainPlaces,
    transport: "",
    estimatedCost: "",
    staySuggestion: dp.staySuggestion,
    accommodationRecommendation: dp.accommodationRecommendation,
    accommodationRecommendations: dp.accommodationRecommendations,
    note: "",
    morning: slimBlock(dp.morning?.place),
    afternoon: slimBlock(dp.afternoon?.place),
    evening: slimBlock(dp.evening?.place),
    morningSchedule: dp.morningSchedule?.map(slimScheduleSegmentForMapPdf),
    afternoonSchedule: dp.afternoonSchedule?.map(slimScheduleSegmentForMapPdf),
    eveningSchedule: dp.eveningSchedule?.map(slimScheduleSegmentForMapPdf),
  }));
}

export type PlanMapRouteOverlay = {
  points: string;
  color: string;
  width: number;
  height: number;
};

export type PlanMapMarkerOverlay = {
  x: number;
  y: number;
  label: string;
  color: string;
};

export type PlanMapPdfPage = {
  day: number;
  title: string;
  dateLabel?: string;
  color: string;
  places: PlanMapPdfPlace[];
  mapDataUrl: string | null;
  mapError?: string;
  routeOverlays?: PlanMapRouteOverlay[];
  markerOverlays?: PlanMapMarkerOverlay[];
  mapWidth?: number;
  mapHeight?: number;
};

function escapeHtml(text: string): string {
  return text.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));
}

function renderPlaceList(places: PlanMapPdfPlace[], color: string): string {
  if (places.length === 0) {
    return `<p class="empty">표시할 장소가 없습니다.</p>`;
  }
  return `<ol class="placeList">${places
    .map(
      (p) =>
        `<li><span class="order" style="background:${escapeHtml(color)}">${p.order}</span><span class="time">${escapeHtml(p.timeLabel)}</span><span class="name">${escapeHtml(p.name.split(/[-–—~:|·(\[]/)[0].trim())}</span></li>`,
    )
    .join("")}</ol>`;
}

function renderRouteOverlays(overlays: PlanMapRouteOverlay[] | undefined): string {
  if (!overlays?.length) return "";
  return overlays
    .map(
      (overlay) =>
        `<polyline points="${overlay.points}" fill="none" stroke="${escapeHtml(overlay.color)}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.95" />`,
    )
    .join("");
}

function renderMarkerOverlays(
  markers: PlanMapMarkerOverlay[] | undefined,
  mapWidth?: number,
  mapHeight?: number,
): string {
  if (!markers?.length) return "";
  return markers
    .map((m) => {
      const label = escapeHtml(m.label.slice(0, 2));
      const color = escapeHtml(m.color);
      return `<g transform="translate(${m.x.toFixed(1)},${m.y.toFixed(1)})">
        <path d="M0,0 L-12,-30 a14,14 0 1,1 24,0 Z" fill="${color}" stroke="#fff" stroke-width="2.5" />
        <text text-anchor="middle" y="-19" fill="#fff" font-size="13" font-weight="800" font-family="Malgun Gothic,sans-serif">${label}</text>
      </g>`;
    })
    .join("");
}

function renderMapSvgComposite(page: PlanMapPdfPage): string {
  if (!page.mapDataUrl) return "";

  const w = page.mapWidth || 1024;
  const h = page.mapHeight || 640;
  const routes = renderRouteOverlays(page.routeOverlays);
  const markers = renderMarkerOverlays(page.markerOverlays, page.mapWidth, page.mapHeight);
  const imgHref = page.mapDataUrl.replace(/"/g, "&quot;");

  return `<svg class="mapComposite" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" role="img">
    <image href="${imgHref}" x="0" y="0" width="${w}" height="${h}" />
    ${routes}
    ${markers}
  </svg>`;
}

function renderMapBlock(page: PlanMapPdfPage): string {
  if (page.mapDataUrl) {
    const composite = renderMapSvgComposite(page);
    if (composite && (page.routeOverlays?.length || page.markerOverlays?.length)) {
      return `<div class="mapStack">${composite}</div>`;
    }
    return `<img class="mapImg" src="${page.mapDataUrl}" alt="${escapeHtml(`${page.day}일차 지도`)}" />`;
  }
  return `<div class="mapFallback">${escapeHtml(page.mapError || "지도 이미지를 생성하지 못했습니다. 주소를 입력한 뒤 다시 시도해 주세요.")}</div>`;
}

function renderDayPage(page: PlanMapPdfPage): string {
  const heading = page.dateLabel
    ? `${page.day}일차 · ${page.dateLabel}`
    : `${page.day}일차 · ${page.title}`;
  return `
    <section class="sheet">
      <header class="dayHeader" style="border-color:${escapeHtml(page.color)}">
        <span class="dayBadge" style="background:${escapeHtml(page.color)}">${page.day}일</span>
        <h2>${escapeHtml(heading)}</h2>
      </header>
      ${renderPlaceList(page.places, page.color)}
      ${renderMapBlock(page)}
      <footer class="sheetFooter">Travel Diary AI · ${page.day}일차 이동 동선</footer>
    </section>`;
}

export function buildA4TravelMapPrintHtml(
  planRequest: PlanRequest,
  pages: PlanMapPdfPage[],
  overviewPage: PlanMapPdfPage | null,
): string {
  const departure = getEffectiveDeparture(planRequest.departure);
  const title = `${planRequest.destinations || "여행"} 여행 지도`;
  const meta = [
    `${planRequest.startDate} ~ ${planRequest.endDate}`,
    `출발: ${departure}`,
    planRequest.travelers,
  ]
    .filter(Boolean)
    .join(" · ");

  const legend = pages
    .map(
      (p) =>
        `<span class="legendItem"><i style="background:${escapeHtml(p.color)}"></i>${p.day}일차</span>`,
    )
    .join("");

  const cover = `
    <section class="sheet cover">
      <p class="eyebrow">A4 여행 지도</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">${escapeHtml(meta)}</p>
      <div class="legend">${legend}</div>
      <p class="hint">각 일차별 방문 순서(번호)와 <strong>자동차 도로 동선</strong>이 표시됩니다.<br/>인쇄 대화상자에서 「PDF로 저장」을 선택하세요.</p>
    </section>`;

  const overview = overviewPage
    ? `
    <section class="sheet">
      <header class="dayHeader" style="border-color:#334155">
        <span class="dayBadge" style="background:#334155">ALL</span>
        <h2>전체 동선 한눈에 보기</h2>
      </header>
      <div class="legend overviewLegend">${legend}</div>
      ${renderMapBlock(overviewPage)}
      <footer class="sheetFooter">Travel Diary AI · 전체 동선</footer>
    </section>`
    : "";

  const daySheets = pages.map(renderDayPage).join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; color: #111; background: #fff; }
    .sheet { page-break-after: always; min-height: 277mm; padding: 4mm 2mm; display: flex; flex-direction: column; gap: 10px; }
    .sheet:last-child { page-break-after: auto; }
    .cover { justify-content: center; text-align: center; padding-top: 30mm; }
    .eyebrow { color: #2563eb; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; margin: 0 0 8px; }
    .cover h1 { font-size: 28px; margin: 0 0 12px; line-height: 1.35; }
    .meta { color: #444; font-size: 14px; margin: 0 0 20px; }
    .legend { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin: 16px 0; }
    .legendItem { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; }
    .legendItem i { width: 12px; height: 12px; border-radius: 999px; display: inline-block; }
    .hint { color: #666; font-size: 12px; line-height: 1.6; margin-top: 24px; }
    .dayHeader { display: flex; align-items: center; gap: 10px; border-left: 5px solid #333; padding-left: 10px; margin: 0; }
    .dayHeader h2 { margin: 0; font-size: 18px; }
    .dayBadge { color: #fff; font-size: 11px; font-weight: 800; padding: 4px 8px; border-radius: 6px; }
    .placeList { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; font-size: 11px; }
    .placeList li { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .order { color: #fff; font-size: 10px; font-weight: 800; width: 18px; height: 18px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .time { color: #666; flex-shrink: 0; min-width: 28px; }
    .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mapStack { position: relative; width: 100%; aspect-ratio: 1024 / 640; max-height: 185mm; }
    .mapComposite { width: 100%; height: 100%; display: block; border: 1px solid #cbd5e1; border-radius: 8px; }
    .mapImg { width: 100%; height: auto; max-height: 185mm; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 8px; display: block; }
    .mapFallback { flex: 1; min-height: 120mm; border: 1px dashed #94a3b8; border-radius: 8px; display: flex; align-items: center; justify-content: center; text-align: center; padding: 20px; color: #64748b; font-size: 13px; line-height: 1.6; }
    .sheetFooter { margin-top: auto; font-size: 10px; color: #94a3b8; text-align: right; }
    .overviewLegend { justify-content: flex-start; }
    .empty { color: #64748b; font-size: 12px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  ${cover}
  ${overview}
  ${daySheets}
</body>
</html>`;
}

export function getPlanDayColorForPdf(day: number): string {
  return getPlanDayColor(day);
}

function writePrintWindowMessage(printWindow: Window, title: string, body: string): void {
  printWindow.document.open();
  printWindow.document.write(`<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>
<body style="font-family:'Malgun Gothic',sans-serif;padding:48px 32px;color:#334155;line-height:1.6">
  <p style="font-size:18px;font-weight:700;margin:0 0 8px">${escapeHtml(title)}</p>
  <p style="margin:0;font-size:14px">${escapeHtml(body)}</p>
</body></html>`);
  printWindow.document.close();
  printWindow.focus();
}

/** 클릭 직후(동기) 호출 — 팝업 차단 방지용 로딩 창 */
export function openTravelMapPrintWindowLoading(): Window | null {
  if (typeof window === "undefined") return null;
  const printWindow = window.open("about:blank", "_blank", "width=960,height=900");
  if (!printWindow) return null;
  writePrintWindowMessage(printWindow, "여행 지도 PDF", "지도를 생성하는 중입니다. 잠시만 기다려 주세요...");
  return printWindow;
}

export function writeTravelMapPrintWindowError(printWindow: Window, message: string): void {
  writePrintWindowMessage(printWindow, "여행 지도 PDF 생성 실패", message);
}

export function openTravelMapPrintWindow(html: string, existingWindow?: Window | null): boolean {
  if (typeof window === "undefined" || !html.trim()) return false;

  const printWindow = existingWindow ?? window.open("about:blank", "_blank", "width=960,height=900");
  if (!printWindow) return false;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);

  const triggerPrint = () => {
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      URL.revokeObjectURL(blobUrl);
    }, 800);
  };

  printWindow.addEventListener("load", triggerPrint, { once: true });
  printWindow.location.replace(blobUrl);
  printWindow.focus();

  return true;
}
