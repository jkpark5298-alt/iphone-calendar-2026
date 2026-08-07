"use client";

import { Chapter3Info } from "../components/Chapter3Info";
import GeneralInfoDetailModal from "../components/GeneralInfoDetailModal";
import { useTravelDiaryGeneralInfoState } from "../hooks/useTravelDiaryGeneralInfoState";


import { ChangeEvent, ClipboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";
import { loadRedDatesFromSupabase, saveRedDateToSupabase } from "../lib/redDateApi";
import {
  enrichPhotoBookImageExifs,
  extractPhotoExif,
  getPhotoBookExifViewLines,
  hasPhotoBookExif,
  type PhotoBookImageExif,
} from "../lib/photoExif";

type View = "calendar" | "diary" | "info" | "schedule" | "redDate" | "markDate";
type PhotoItem = {
  url: string;
  name: string;
  tag: string;
  extraTag?: string;
  memo?: string;
  memoHidden?: boolean;
  size?: string;
  memoWidth?: string;
  memoHeight?: string;
  storagePath?: string;
  id?: string;
  isCalendarPhoto?: boolean;
  isPinned?: boolean;
};
type ScheduleColor = "yellow" | "blue" | "red" | "green" | "lightGreen" | "orange" | "navy" | "purple";
type OriginalImageTarget = 
  | { type: "diary"; photoKey: string; index: number } 
  | { type: "insta"; id: string }
  | { type: "storage-image"; url: string; fileName?: string }
  | { type: "photobook-resize"; url: string; photoBookId: string; imageIndex: number; fileName?: string }
  | null;
type ScheduleItem = {
  id: string;
  title: string;
  startDate?: string;
  startTime: string;
  endDate: string;
  endTime?: string;
  repeat: string;
  color: ScheduleColor;
};
type InfoTextCard = {
  id: string;
  content: string;
  createdAt: string;
};
type CalendarMarkType = "C" | "A" | "심야" | "노조" | "休";
type CalendarMarkItem = {
  id: string;
  type: CalendarMarkType;
  plus: boolean;
};

type SearchResult = {
  type: "diary" | "info";
  entryDate: string;
  year: number;
  month: number;
  day: number;
  text: string;
};
type GoogleScheduleItem = {
  title: string;
  start?: string;
  end?: string;
  allDay?: boolean;
};

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const weekdayLabels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const monthDays: Record<number, number> = { 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 };
const scheduleColorLabels: Record<ScheduleColor, string> = {
  yellow: "노란색",
  blue: "파란색",
  red: "빨간색",
  green: "초록색",
  lightGreen: "녹색",
  orange: "주황색",
  navy: "남색",
  purple: "보라색",
};

const calendarMarkLabels: Record<CalendarMarkType, string> = {
  C: "C",
  A: "A",
  심야: "심야",
  노조: "노조",
  休: "休",
};

function calendarMarkClassSuffix(type: CalendarMarkType) {
  if (type === "심야") return "night";
  if (type === "노조") return "union";
  if (type === "休") return "rest";
  return type.toLowerCase();
}

const holidays: Record<string, string> = {
  "5-5": "어린이날",
  "5-24": "부처님오신날",
  "5-25": "대체공휴일",
  "6-3": "지방선거",
  "6-6": "현충일",
  "8-15": "광복절",
  "8-17": "대체공휴일",
  "9-24": "추석",
  "9-25": "추석",
  "9-26": "추석",
  "10-3": "개천절",
  "10-5": "대체공휴일",
  "10-9": "한글날",
  "12-25": "성탄절",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function key(month: number, day: number, year: number = 2026) {
  if (year === 2026) {
    return `${month}-${day}`;
  }
  return `${year}-${month}-${day}`;
}

function parseScheduleKey(scheduleKey: string) {
  const parts = scheduleKey.split("-");
  if (parts.length === 3) {
    return {
      year: Number(parts[0]),
      month: Number(parts[1]),
      day: Number(parts[2]),
    };
  } else {
    return {
      year: 2026,
      month: Number(parts[0]),
      day: Number(parts[1]),
    };
  }
}

function parseScheduleKeyDate(scheduleKey: string) {
  const { year, month, day } = parseScheduleKey(scheduleKey);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day).getTime();
}

function parseScheduleEndDate(value: string | undefined, fallbackTime: number) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallbackTime;

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isFinite(month) || !Number.isFinite(day)) return fallbackTime;
  return new Date(year, month - 1, day).getTime();
}

function scheduleCoversCalendarDay(scheduleKey: string, item: ScheduleItem, month: number, day: number, year: number = 2026) {
  const fallbackStartTime = parseScheduleKeyDate(scheduleKey);
  if (fallbackStartTime === null) return false;

  const startTime = parseScheduleEndDate(item.startDate, fallbackStartTime);
  const currentTime = new Date(year, month - 1, day).getTime();
  const endTime = parseScheduleEndDate(item.endDate, startTime);

  const first = Math.min(startTime, endTime);
  const last = Math.max(startTime, endTime);

  return currentTime >= first && currentTime <= last;
}

function getCalendarDaySchedules(allSchedules: Record<string, ScheduleItem[]>, month: number, day: number, year: number = 2026) {
  return Object.entries(allSchedules)
    .flatMap(([scheduleKey, items]) =>
      items
        .filter(item => scheduleCoversCalendarDay(scheduleKey, item, month, day, year))
        .map(item => ({ ...item, calendarSourceKey: scheduleKey }))
    )
    .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function dateValueFromYmd(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day).getTime();
}

function dateValueFromScheduleKey(scheduleKey: string) {
  const { year, month, day } = parseScheduleKey(scheduleKey);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day).getTime();
}

function getVisibleSchedulesForDay(allSchedules: Record<string, ScheduleItem[]>, month: number, day: number, year: number = 2026) {
  const targetTime = new Date(year, month - 1, day).getTime();

  return Object.entries(allSchedules)
    .flatMap(([scheduleKey, items]) => {
      const fallbackStart = dateValueFromScheduleKey(scheduleKey);
      if (fallbackStart === null) return [];

      return items
        .filter(item => {
          const startTime = dateValueFromYmd(item.startDate) ?? fallbackStart;
          const endTime = dateValueFromYmd(item.endDate) ?? startTime;
          const first = Math.min(startTime, endTime);
          const last = Math.max(startTime, endTime);

          return targetTime >= first && targetTime <= last;
        })
        .map(item => ({ ...item, calendarSourceKey: scheduleKey }));
    })
    .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
}

function tag(month: number, day: number, year: number = 2026) {
  if (year === 2026) {
    return `#${pad(month)}/${pad(day)}#`;
  }
  return `#${year}/${pad(month)}/${pad(day)}#`;
}

function infoTag(month: number, day: number, year: number = 2026) {
  if (year === 2026) {
    return `#날짜(${pad(month)}/${pad(day)})#`;
  }
  return `#날짜(${year}/${pad(month)}/${pad(day)})#`;
}

function memoWithDateTag(memo: string | undefined, month: number, day: number) {
  const dateTag = tag(month, day);
  const currentMemo = memo || "";
  if (currentMemo.startsWith("#")) return currentMemo;
  if (currentMemo.trim()) return `${dateTag}${currentMemo}`;
  return dateTag;
}

function getWeekday(month: number, day: number, year: number = 2026) {
  return weekdays[new Date(year, month - 1, day).getDay()];
}

function isSunday(month: number, day: number, year: number = 2026) {
  return new Date(year, month - 1, day).getDay() === 0;
}

function getHolidayLabel(month: number, day: number) {
  return holidays[`${month}-${day}`];
}

function isHoliday(month: number, day: number) {
  return Boolean(getHolidayLabel(month, day));
}

function storageKey(type: string, month: number, day: number, year: number = 2026) {
  if (year === 2026) {
    return `iphone-diary-2026-${type}-${pad(month)}-${pad(day)}`;
  }
  return `iphone-diary-${year}-${type}-${pad(month)}-${pad(day)}`;
}

function weatherStorageKey(month: number, day: number, year: number = 2026) {
  if (year === 2026) {
    return `iphone-diary-2026-weather-${pad(month)}-${pad(day)}`;
  }
  return `iphone-diary-${year}-weather-${pad(month)}-${pad(day)}`;
}

function isWeatherForSelectedDate(weatherData: any, month: number, day: number, year: number = 2026) {
  const observedAt = String(weatherData?.observedAt || "");
  if (!observedAt) return false;

  const normalized = observedAt.replace(/\s/g, "");
  const monthPattern = String(month);
  const dayPattern = String(day);

  return (
    normalized.includes(`${year}.${monthPattern}.${dayPattern}.`) ||
    normalized.includes(`${year}.${pad(month)}.${pad(day)}.`) ||
    normalized.includes(`${year}-${pad(month)}-${pad(day)}`)
  );
}

function isSelectedDiaryDateToday(month: number, day: number, year: number = 2026) {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() + 1 === month && now.getDate() === day;
}


function getWeatherIcon(value: string) {
  const text = String(value || "");

  if (text.includes("눈")) return "❄️";
  if (text.includes("비/눈") || text.includes("빗방울/눈")) return "🌨️";
  if (text.includes("비") || text.includes("빗방울")) return "🌧️";
  if (text.includes("소나기")) return "🌦️";
  if (text.includes("흐림")) return "☁️";
  if (text.includes("구름")) return "⛅";
  if (text.includes("맑음")) return "☀️";

  return "🌤️";
}

function entryDate(month: number, day: number, year: number = 2026) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function monthDayFromEntryDate(value: string) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const maxDay = getDaysInMonth(year, month);
  if (year === 2026) {
    if (month < 5 || month > 12 || day < 1 || day > maxDay) return null;
  } else {
    if (month < 1 || month > 12 || day < 1 || day > maxDay) return null;
  }
  return { year, month, day };
}

function normalizeInfoPhotoMemo(value: string | undefined) {
  const memo = value || "";
  if (!memo.trim()) return "#";
  return memo.startsWith("#") ? memo : `#${memo}`;
}


function normalizeUrlForHref(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function extractUrls(text: string) {
  const matches = text.match(/(?:https?:\/\/|www\.)[^\s<>()]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s<>()]*)?/g) || [];
  return Array.from(new Set(matches.map(value => value.replace(/[.,!?;:)]+$/g, ""))));
}

function HyperlinkPreview({ text }: { text: string }) {
  const urls = extractUrls(text);

  if (!urls.length) return null;

  return (
    <div className="auto-link-box">
      <div className="auto-link-title">🔗 자동 생성 링크</div>
      <div className="auto-link-list">
        {urls.map(url => (
          <a key={url} href={normalizeUrlForHref(url)} target="_blank" rel="noreferrer" className="auto-link-item">
            {url}
          </a>
        ))}
      </div>
    </div>
  );
}

function PhotoMemoLinkPreview({ text }: { text: string }) {
  const urls = extractUrls(text);

  if (!urls.length) return null;

  return (
    <div className="info-photo-link-preview">
      {urls.map(url => (
        <a key={url} href={normalizeUrlForHref(url)} target="_blank" rel="noreferrer" className="info-photo-link-item">
          🔗 {url}
        </a>
      ))}
    </div>
  );
}

function getSafeToday() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  if (year > 2026) {
    return { year, month, day };
  }
  if (year === 2026 && month >= 5 && month <= 12) {
    return { year: 2026, month, day };
  }

  return { year: 2026, month: 5, day: 24 };
}


type InstaInfoCard = {
  id: string;
  title?: string;
  category: string;
  keyword: string;
  entryDate: string;
  imageUrl?: string;
  imageStoragePath?: string;
  imageUrls?: string[];
  imageStoragePaths?: string[];
  originalText: string;
  extractedText?: string;
  factCheckResult?: string;
  createdAt: string;
};

type UndoState = {
  label: string;
  target: "infoPhotos" | "diaryPhotos" | "schedules" | "diaryText" | "infoText" | "infoTextCards";
  photoKey?: string;
  year?: number;
  month?: number;
  day?: number;
  previousData: string;
  previousCalendarPhotos?: string;
  previousCalendarPhotoIndexes?: string;
  previousInfoMemoHidden?: string;
};

export default function HomePage() {
  const todayDefault = useMemo(() => getSafeToday(), []);
  const [view, setView] = useState<View>("calendar");
  const [currentYear, setCurrentYear] = useState(todayDefault.year ?? 2026);
  const [currentMonth, setCurrentMonth] = useState(todayDefault.month);
  const [currentDay, setCurrentDay] = useState(todayDefault.day);
  const [diaryText, setDiaryText] = useState("");
  const [voiceText, setVoiceText] = useState("");
  const [infoText, setInfoText] = useState("");
  const [infoTextCards, setInfoTextCards] = useState<Record<string, InfoTextCard[]>>({});
  const [editingInfoTextCard, setEditingInfoTextCard] = useState<{ index: number; content: string } | null>(null);
  const [photos, setPhotos] = useState<Record<string, PhotoItem[]>>({});
  const [infoPhotos, setInfoPhotos] = useState<Record<string, PhotoItem[]>>({});
  const [calendarPhotos, setCalendarPhotos] = useState<Record<string, string>>({});
  const [calendarPhotoIndexes, setCalendarPhotoIndexes] = useState<Record<string, number>>({});
  const [schedules, setSchedules] = useState<Record<string, ScheduleItem[]>>({});
  const [redDates, setRedDates] = useState<Record<number, number[]>>({});
  const [redDateInput, setRedDateInput] = useState("");
  const [calendarMarks, setCalendarMarks] = useState<Record<string, CalendarMarkItem[]>>({});
  const [markDateInput, setMarkDateInput] = useState("");
  const [markType, setMarkType] = useState<CalendarMarkType>("C");
  const [markPlus, setMarkPlus] = useState(false);
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleStartDate, setScheduleStartDate] = useState(`${todayDefault.year ?? 2026}-${pad(todayDefault.month)}-${pad(todayDefault.day)}`);
  const [scheduleStartTime, setScheduleStartTime] = useState("");
  const [scheduleEndDate, setScheduleEndDate] = useState("");
  const [scheduleEndTime, setScheduleEndTime] = useState("24:00");
  const [scheduleRepeat, setScheduleRepeat] = useState("없음");
  const [scheduleColor, setScheduleColor] = useState<ScheduleColor>("yellow");
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("녹음 파일 없음");
  const [lastAudioFile, setLastAudioFile] = useState<File | null>(null);
  const [weather, setWeather] = useState("조회 중");
  const [temp, setTemp] = useState("-");
  const [weatherTime, setWeatherTime] = useState("-");
  const [weatherSource, setWeatherSource] = useState("기상청 연결 대기");
  const [originalImageUrl, setOriginalImageUrl] = useState("");
  const [originalImageTarget, setOriginalImageTarget] = useState<OriginalImageTarget>(null);
  const [photoResizeMaxSide, setPhotoResizeMaxSide] = useState<800 | 1200 | 1600 | 2400>(1200);
  const [photoResizeBusy, setPhotoResizeBusy] = useState(false);
  const [photoResizePreviewUrl, setPhotoResizePreviewUrl] = useState("");
  const [photoResizeInfo, setPhotoResizeInfo] = useState("");
  const [photoCropMode, setPhotoCropMode] = useState(false);
  const [photoCropRect, setPhotoCropRect] = useState({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
  const [photoCropAspect, setPhotoCropAspect] = useState<"free" | "1:1" | "4:3" | "16:9">("free");
  const [photoCropStageSize, setPhotoCropStageSize] = useState({ w: 0, h: 0 });
  const [photoCropNatural, setPhotoCropNatural] = useState({ w: 0, h: 0 });
  const [photoCropScale, setPhotoCropScale] = useState(1);
  const [photoCropPan, setPhotoCropPan] = useState({ x: 0, y: 0 });
  const photoCropStageRef = useRef<HTMLDivElement | null>(null);
  const photoCropImageRef = useRef<HTMLImageElement | null>(null);
  const photoCropPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const photoCropGestureRef = useRef<{
    mode: "pan" | "pinch" | "crop-move" | "nw" | "ne" | "sw" | "se" | null;
    startX: number;
    startY: number;
    startPan: { x: number; y: number };
    startScale: number;
    startDist: number;
    startRect: { x: number; y: number; w: number; h: number };
    pinchOriginX: number;
    pinchOriginY: number;
  } | null>(null);
  const photoCropPanRef = useRef({ x: 0, y: 0 });
  const photoCropScaleRef = useRef(1);
  const photoCropRectRef = useRef({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
  const photoCropStageSizeRef = useRef({ w: 0, h: 0 });
  const photoCropNaturalRef = useRef({ w: 0, h: 0 });
  const photoCropAspectRef = useRef<"free" | "1:1" | "4:3" | "16:9">("free");  const [selectedInfoPhotoMenu, setSelectedInfoPhotoMenu] = useState<{ photoKey: string; index: number } | null>(null);
  const [datePickerMode, setDatePickerMode] = useState<"diary" | "info" | null>(null);
  const [datePickerValue, setDatePickerValue] = useState(`${todayDefault.year ?? 2026}-${pad(todayDefault.month)}-${pad(todayDefault.day)}`);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState("검색어를 입력하세요.");
  const [googleSchedules, setGoogleSchedules] = useState<GoogleScheduleItem[]>([]);
  const [googleScheduleStatus, setGoogleScheduleStatus] = useState("구글 일정 대기");
  const [undoHistory, setUndoHistory] = useState<UndoState[]>([]);

  // New states for 개편된 정보보관소 (인스타 주요 정보 관리 및 포토북)
  const [infoSubView, setInfoSubView] = useState<"generalInfo" | "photobook">("generalInfo");

  // Chapter 3 General Info hook
  // useCallback으로 안정화 — inline 함수는 매 렌더마다 새 참조를 만들어 useEffect 무한 루프를 유발함
  const showGeneralInfoPasteHint = useCallback((msg: string) => {
    if (
      msg.startsWith("⚠️") ||
      msg.startsWith("❌") ||
      msg.includes("실패") ||
      msg.includes("오류") ||
      msg.includes("제한")
    ) {
      alert(msg);
    } else {
      console.log(msg);
    }
  }, []);

  const makeDurableImageFiles = useCallback(async (files: File[]) => {
    const durable: File[] = [];
    for (const file of files) {
      if (!file) continue;
      const isImage =
        !file.type ||
        file.type.startsWith("image/") ||
        file.type === "application/octet-stream" ||
        /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name || "");
      if (!isImage) continue;
      try {
        const buffer = await file.arrayBuffer();
        if (!buffer.byteLength) continue;
        const name = file.name?.trim() || `pasted_${Date.now()}_${durable.length + 1}.jpg`;
        const lower = name.toLowerCase();
        let type = file.type || "";
        if (!type.startsWith("image/")) {
          if (lower.endsWith(".heic")) type = "image/heic";
          else if (lower.endsWith(".heif")) type = "image/heif";
          else if (lower.endsWith(".png")) type = "image/png";
          else if (lower.endsWith(".webp")) type = "image/webp";
          else type = "image/jpeg";
        }
        durable.push(
          new File([buffer], name, {
            type,
            lastModified: file.lastModified || Date.now(),
          })
        );
      } catch (error) {
        console.warn("pasted image clone failed", error);
      }
    }
    return durable;
  }, []);

  const infoState = useTravelDiaryGeneralInfoState({
    showPasteHint: showGeneralInfoPasteHint,
  });
  const [instaLoading, setInstaLoading] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState("");

  // Instagram Info Form states
  const [instaInputText, setInstaInputText] = useState("");
  const [instaInputImageUrl, setInstaInputImageUrl] = useState("");
  const [instaInputImageStoragePath, setInstaInputImageStoragePath] = useState("");
  const [instaInputImageUrls, setInstaInputImageUrls] = useState<string[]>([]);
  const [instaInputImageStoragePaths, setInstaInputImageStoragePaths] = useState<string[]>([]);
  const [instaInputTitle, setInstaInputTitle] = useState("");
  const [instaInputCategory, setInstaInputCategory] = useState("기타");
  const [instaInputKeyword, setInstaInputKeyword] = useState("");
  const [instaInputExtractedText, setInstaInputExtractedText] = useState("");
  const [editingInstaCardId, setEditingInstaCardId] = useState<string | null>(null);
  const [instaInputImage, setInstaInputImage] = useState<File | null>(null);

  // Photo book Form states
  const [photoBookInputImageUrl, setPhotoBookInputImageUrl] = useState("");
  const [photoBookInputImageStoragePath, setPhotoBookInputImageStoragePath] = useState("");
  const [photoBookInputImageUrls, setPhotoBookInputImageUrls] = useState<string[]>([]);
  const [photoBookInputImageStoragePaths, setPhotoBookInputImageStoragePaths] = useState<string[]>([]);
  const [activePreviewPhotoUrl, setActivePreviewPhotoUrl] = useState<string | null>(null);
  const [photoBookInputKeyword, setPhotoBookInputKeyword] = useState("");
  const [photoBookInputCategory2, setPhotoBookInputCategory2] = useState("");
  const [photoBookInputMemo, setPhotoBookInputMemo] = useState("");
  const [editingPhotoBookItemId, setEditingPhotoBookItemId] = useState<string | null>(null);
  const [photoBookInputImage, setPhotoBookInputImage] = useState<File | null>(null);
  const [photoBookInputImageMemos, setPhotoBookInputImageMemos] = useState<string[]>([]);
  const [photoBookInputImageExifs, setPhotoBookInputImageExifs] = useState<PhotoBookImageExif[]>([]);
  const [pbMemoEditIdx, setPbMemoEditIdx] = useState<number | null>(null);
  const [photoBookTab, setPhotoBookTab] = useState<"index" | "register">("index");

  // Restructured Info Repository states for global notes catalog
  const [allInstaCards, setAllInstaCards] = useState<InstaInfoCard[]>([]);
  const [allPhotoBookItems, setAllPhotoBookItems] = useState<PhotoItem[]>([]);
  const [activeItem, setActiveItem] = useState<{ type: "insta" | "photobook"; id: string } | null>(null);
  const [instaSearchKey, setInstaSearchKey] = useState("");
  const [photoSearchKey, setPhotoSearchKey] = useState("");
  const [instaInputDate, setInstaInputDate] = useState("");
  const [photoBookInputDate, setPhotoBookInputDate] = useState("");
  const [selectedPhotoBookIds, setSelectedPhotoBookIds] = useState<string[]>([]);
  const [isPhotoAlbumModalOpen, setIsPhotoAlbumModalOpen] = useState(false);
  const [albumSearchQuery, setAlbumSearchQuery] = useState("");
  const [photoAlbumViewer, setPhotoAlbumViewer] = useState<{
    photoBookId: string;
    keyword: string;
    urls: string[];
    memos: string[];
    exifs: PhotoBookImageExif[];
    index: number;
  } | null>(null);
  const [activePhotoResolvedExifs, setActivePhotoResolvedExifs] = useState<PhotoBookImageExif[] | null>(null);
  const [selectedInstaCardIds, setSelectedInstaCardIds] = useState<string[]>([]);
  const [isInfoBookModalOpen, setIsInfoBookModalOpen] = useState(false);
  const [infoBookSearchQuery, setInfoBookSearchQuery] = useState("");
  const [isPhotoMemoExpanded, setIsPhotoMemoExpanded] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const diaryTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const diaryRichTextRef = useRef<HTMLDivElement | null>(null);
  const diaryTextImageFileRef = useRef<HTMLInputElement | null>(null);
  const [showDiaryTextImageInsert, setShowDiaryTextImageInsert] = useState(false);
  const infoTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const diaryEditStartRef = useRef<{ key: string; diaryText: string; voiceText: string } | null>(null);
  const infoEditStartRef = useRef<{ key: string; infoText: string } | null>(null);

  function handleDiaryRichCommand(command: string, value?: string) {
    diaryRichTextRef.current?.focus();
    document.execCommand(command, false, value);
  }

  function diaryTextEndsWithImageTrigger(raw: string) {
    const text = String(raw || "").replace(/\u00a0/g, " ").replace(/\r/g, "");
    const trimmedEnd = text.replace(/[ \t\n]+$/g, "");
    return /S$/.test(trimmedEnd);
  }

  function checkDiaryTextImageTrigger() {
    const plain = String(diaryRichTextRef.current?.innerText || "");
    setShowDiaryTextImageInsert(diaryTextEndsWithImageTrigger(plain));
  }

  function removeDiaryTrailingImageTrigger() {
    const editor = diaryRichTextRef.current;
    if (!editor) return;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    while (walker.nextNode()) last = walker.currentNode as Text;
    if (!last?.nodeValue) return;
    const next = last.nodeValue.replace(/[ \t]*S[ \t]*$/, "");
    if (next === last.nodeValue) return;
    last.nodeValue = next;
    saveDiary(editor.innerHTML || "", voiceText);
  }

  function insertDiaryImageFilesFromTextTrigger(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    removeDiaryTrailingImageTrigger();
    const list =
      files instanceof FileList
        ? Array.from(files)
        : files;
    const imageFiles = list.filter(
      (file) => file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name || ""),
    );
    if (!imageFiles.length) {
      alert("이미지 파일을 선택해 주세요.");
      return;
    }

    void (async () => {
      try {
        const { insertInlineMediaIntoEditor, readFilesAsDataUrls } = await import("../lib/generalInfoHelpers");
        const loaded = await readFilesAsDataUrls(imageFiles);
        const editor = diaryRichTextRef.current;
        if (editor) {
          insertInlineMediaIntoEditor(
            editor,
            loaded
              .filter((item) => item.dataUrl)
              .map(({ file, dataUrl }) => ({
                src: dataUrl,
                name: file.name,
                type: "image" as const,
              })),
          );
          saveDiary(editor.innerHTML || "", voiceText);
        }
      } catch (error) {
        console.error("diary inline image insert failed", error);
        alert("이미지를 본문 TEXT에 넣지 못했습니다. 다시 시도해 주세요.");
      } finally {
        setShowDiaryTextImageInsert(false);
      }
    })();
  }

  function handleDiaryTextImageInsertPaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const clipboardData = event.clipboardData;
    const pastedFiles: File[] = [];
    if (clipboardData?.files?.length) {
      Array.from(clipboardData.files).forEach((file) => {
        if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
          pastedFiles.push(file);
        }
      });
    }
    if (clipboardData?.items) {
      Array.from(clipboardData.items).forEach((item) => {
        if (item.kind === "file" && (item.type.startsWith("image/") || item.type.startsWith("video/"))) {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      });
    }
    if (pastedFiles.length > 0) {
      insertDiaryImageFilesFromTextTrigger(pastedFiles);
    }
  }

  function resizeTextareaToContent(element: HTMLTextAreaElement | null) {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight, 180)}px`;
  }

  function updateVisualViewportHeight() {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty("--ios-vvh", `${viewportHeight}px`);
  }

  function keepTextareaAboveKeyboard(element: HTMLTextAreaElement | null) {
    if (!element) return;

    updateVisualViewportHeight();
    document.body.classList.add("ios-keyboard-editing");

    const updateAndReveal = () => {
      updateVisualViewportHeight();
      element.scrollTop = Math.max(element.scrollTop, 0);
      window.scrollTo({ top: Math.max(window.scrollY - 80, 0), behavior: "smooth" });
    };

    requestAnimationFrame(updateAndReveal);
    window.setTimeout(updateAndReveal, 120);
    window.setTimeout(updateAndReveal, 350);
    window.setTimeout(updateAndReveal, 700);
  }

  function stopTextareaKeyboardMode() {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active?.tagName !== "TEXTAREA" && active?.tagName !== "INPUT") {
        document.body.classList.remove("ios-keyboard-editing");
        document.documentElement.style.removeProperty("--ios-vvh");
      }
    }, 180);
  }

  function focusDiaryTextarea(element: HTMLTextAreaElement) {
    beginDiaryTextUndoSession();
    resizeTextareaToContent(element);
    keepTextareaAboveKeyboard(element);
  }

  function focusInfoTextarea(element: HTMLTextAreaElement) {
    beginInfoTextUndoSession();
    resizeTextareaToContent(element);
    keepTextareaAboveKeyboard(element);
  }

  function expandInfoPhotoNote(element: HTMLTextAreaElement | null) {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight, 74)}px`;
  }

  function collapseInfoPhotoNote(element: HTMLTextAreaElement | null) {
    if (!element) return;
    element.style.height = "";
    requestAnimationFrame(() => {
      element.scrollTop = 0;
      element.setSelectionRange(0, 0);
    });
  }


  function handleDiaryTextPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    requestAnimationFrame(() => saveDiary(event.currentTarget.value, voiceText));
  }

  function handleInfoTextPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    requestAnimationFrame(() => saveInfo(event.currentTarget.value));
  }

  async function pasteCopiedTextToDiary() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        alert("클립보드에 붙일 글이 없습니다.");
        return;
      }
      beginDiaryTextUndoSession();
      const nextText = diaryText ? `${diaryText}\n${text}` : text;
      saveDiary(nextText, voiceText);
      requestAnimationFrame(() => resizeTextareaToContent(diaryTextareaRef.current));
    } catch {
      alert("브라우저에서 클립보드 읽기를 허용하지 않았습니다. 입력칸을 길게 눌러 붙여넣어 주세요.");
    }
  }

  async function pasteCopiedTextToInfo() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        alert("클립보드에 붙일 글이 없습니다.");
        return;
      }
      beginInfoTextUndoSession();
      const nextText = infoText ? `${infoText}\n${text}` : text;
      saveInfo(nextText);
      requestAnimationFrame(() => resizeTextareaToContent(infoTextareaRef.current));
    } catch {
      alert("브라우저에서 클립보드 읽기를 허용하지 않았습니다. 입력칸을 길게 눌러 붙여넣어 주세요.");
    }
  }

  async function loadDiaryEntryFromSupabase(month: number, day: number, year: number = currentYear) {
    if (!isSupabaseConfigured || !supabase) return null;

    const { data, error } = await supabase
      .from("diary_entries")
      .select("diary_text, voice_text, weather")
      .eq("entry_date", entryDate(month, day, year))
      .maybeSingle();

    if (error) {
      console.warn("Supabase diary load error:", error.message);
      return null;
    }

    return data as { diary_text?: string | null; voice_text?: string | null; weather?: any } | null;
  }

  async function loadInfoEntryFromSupabase(month: number, day: number, year: number = currentYear) {
    if (!isSupabaseConfigured || !supabase) return null;

    const { data, error } = await supabase
      .from("info_entries")
      .select("info_text")
      .eq("entry_date", entryDate(month, day, year))
      .maybeSingle();

    if (error) {
      console.warn("Supabase info load error:", error.message);
      return null;
    }

    return data as { info_text?: string | null } | null;
  }


  function photoItemFromSupabaseRow(row: any, month: number, day: number, year: number = 2026): PhotoItem {
    const storagePath = row.storage_path || "";
    const fallbackName = storagePath.split("/").pop() || "photo.jpg";

    return {
      id: row.id,
      url: row.public_url,
      name: fallbackName,
      tag: tag(month, day),
      extraTag: "",
      memo: normalizeInfoPhotoMemo(row.caption || ""),
      size: "360",
      memoWidth: "360",
      memoHeight: "110",
      storagePath,
      isCalendarPhoto: Boolean(row.is_calendar_photo),
    };
  }

  function deletedPhotoStorageKey(photoType: "diary" | "info", year: number = currentYear) {
    return `iphone-calendar-${year}-deleted-${photoType}-photos`;
  }

  function photoDeleteIdentity(item: PhotoItem | { storagePath?: string; url?: string; name?: string }) {
    return item.storagePath || item.url || item.name || "";
  }

  function getDeletedPhotoIdentities(photoType: "diary" | "info", year: number = currentYear) {
    try {
      const raw = localStorage.getItem(deletedPhotoStorageKey(photoType, year));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
    } catch {
      return [];
    }
  }

  function saveDeletedPhotoIdentities(photoType: "diary" | "info", identities: string[], year: number = currentYear) {
    const uniqueIdentities = Array.from(new Set(identities.filter(Boolean)));
    try {
      localStorage.setItem(deletedPhotoStorageKey(photoType, year), JSON.stringify(uniqueIdentities));
    } catch {
      // 삭제 표시 저장 실패 시 화면 상태만 유지합니다.
    }
  }

  function markPhotoAsDeleted(photoType: "diary" | "info", item: PhotoItem, year: number = currentYear) {
    const identity = photoDeleteIdentity(item);
    if (!identity) return;
    saveDeletedPhotoIdentities(photoType, [...getDeletedPhotoIdentities(photoType, year), identity], year);
  }

  function clearDeletedPhotoMarkers(photoType: "diary" | "info", items: PhotoItem[], year: number = currentYear) {
    const identitiesToRestore = new Set(items.map(photoDeleteIdentity).filter(Boolean));
    if (!identitiesToRestore.size) return;
    const remaining = getDeletedPhotoIdentities(photoType, year).filter(identity => !identitiesToRestore.has(identity));
    saveDeletedPhotoIdentities(photoType, remaining, year);
  }

  function isPhotoMarkedDeleted(photoType: "diary" | "info", item: PhotoItem | { storagePath?: string; url?: string; name?: string }, year: number = currentYear) {
    const identity = photoDeleteIdentity(item);
    if (!identity) return false;
    return getDeletedPhotoIdentities(photoType, year).includes(identity);
  }

  async function loadDiaryPhotosFromSupabase(month: number, day: number, year: number = currentYear) {
    if (!isSupabaseConfigured || !supabase) return null;

    const { data, error } = await supabase
      .from("diary_photos")
      .select("id, storage_path, public_url, sort_order, is_calendar_photo")
      .eq("entry_date", entryDate(month, day, year))
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("Supabase diary photo load error:", error.message);
      return null;
    }

    return (data || [])
      .map(row => photoItemFromSupabaseRow(row, month, day, year))
      .filter(item => !isPhotoMarkedDeleted("diary", item, year));
  }

  async function loadInfoPhotosFromSupabase(month: number, day: number, year: number = currentYear) {
    if (!isSupabaseConfigured || !supabase) return null;

    const { data, error } = await supabase
      .from("info_photos")
      .select("id, storage_path, public_url, caption, sort_order")
      .eq("entry_date", entryDate(month, day, year))
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("Supabase info photo load error:", error.message);
      return null;
    }

    return (data || [])
      .map(row => photoItemFromSupabaseRow(row, month, day, year))
      .filter(item => !isPhotoMarkedDeleted("info", item, year));
  }

  async function loadCalendarPhotosFromSupabase() {
    if (!isSupabaseConfigured || !supabase) return;

    const { data, error } = await supabase
      .from("diary_photos")
      .select("entry_date, public_url, storage_path, sort_order")
      .eq("is_calendar_photo", true);

    if (error) {
      console.warn("Supabase calendar photo load error:", error.message);
      return;
    }

    const nextCalendarPhotos: Record<string, string> = {};
    const nextCalendarPhotoIndexes: Record<string, number> = {};

    (data || []).forEach(row => {
      const parts = String(row.entry_date || "").split("-");
      if (parts.length !== 3) return;
      const year = Number(parts[0]);
      const month = Number(parts[1]);
      const day = Number(parts[2]);
      if (isPhotoMarkedDeleted("diary", { storagePath: row.storage_path || "", url: row.public_url || "" }, year)) return;
      const photoKey = key(month, day, year);
      nextCalendarPhotos[photoKey] = row.public_url;
      nextCalendarPhotoIndexes[photoKey] = Number(row.sort_order || 0);
    });

    // Supabase 사용 시 캘린더 대표사진도 서버값을 기준으로 맞춥니다.
    // 예전 localStorage 대표사진이 남아서 기기마다 다르게 보이는 문제를 줄입니다.
    setCalendarPhotos(nextCalendarPhotos);
    setCalendarPhotoIndexes(nextCalendarPhotoIndexes);
    setLocalStorageSafely("iphone-diary-2026-calendar-photos", JSON.stringify(nextCalendarPhotos));
    setLocalStorageSafely("iphone-diary-2026-calendar-photo-indexes", JSON.stringify(nextCalendarPhotoIndexes));
  }

  async function loadCalendarMarksFromSupabase() {
    if (!isSupabaseConfigured || !supabase) return;

    const { data, error } = await supabase
      .from("calendar_marks")
      .select("id, month, day, mark_type, plus")
      .order("month", { ascending: true })
      .order("day", { ascending: true });

    if (error) {
      console.warn("Supabase calendar mark load error:", error.message);
      return;
    }

    const nextMarks: Record<string, CalendarMarkItem[]> = {};
    (data || []).forEach((row: any) => {
      let month = Number(row.month);
      let year = 2026;
      if (month > 100) {
        year = Math.floor(month / 100);
        month = month % 100;
      }
      const day = Number(row.day);
      const type = row.mark_type as CalendarMarkType;
      const maxDay = getDaysInMonth(year, month);
      if (day < 1 || day > maxDay) return;
      if (!["C", "A", "심야", "노조", "休"].includes(type)) return;

      const markKey = key(month, day, year);
      nextMarks[markKey] = [
        ...(nextMarks[markKey] || []),
        {
          id: row.id || `${markKey}-${type}-${row.plus ? "plus" : "base"}`,
          type,
          plus: Boolean(row.plus),
        },
      ];
    });

    setCalendarMarks(nextMarks);
    localStorage.setItem("iphone-calendar-2026-marks", JSON.stringify(nextMarks));
  }

  async function loadCalendarSchedulesFromSupabase() {
    if (!isSupabaseConfigured || !supabase) return null;

    const { data, error } = await supabase
      .from("calendar_schedules")
      .select("schedule_id, schedule_key, month, day, title, start_date, start_time, end_date, end_time, repeat, color")
      .order("month", { ascending: true })
      .order("day", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) {
      console.warn("Supabase schedule load error:", error.message);
      return null;
    }

    const nextSchedules: Record<string, ScheduleItem[]> = {};
    (data || []).forEach((row: any) => {
      const startParts = String(row.start_date || "").split("-");
      let year = 2026;
      let month = Number(row.month);
      let day = Number(row.day);
      if (startParts.length === 3) {
        year = Number(startParts[0]);
        month = Number(startParts[1]);
        day = Number(startParts[2]);
      }
      const maxDay = getDaysInMonth(year, month);
      if (month < 1 || month > 12 || day < 1 || day > maxDay) return;

      const scheduleKey = row.schedule_key || key(month, day, year);
      const color = String(row.color || "yellow") as ScheduleColor;
      const item: ScheduleItem = {
        id: String(row.schedule_id || row.id || `${scheduleKey}-${Date.now()}`),
        title: String(row.title || ""),
        startDate: row.start_date || `${year}-${pad(month)}-${pad(day)}`,
        startTime: row.start_time || "08:00",
        endDate: row.end_date || `${year}-${pad(month)}-${pad(day)}`,
        endTime: row.end_time || "24:00",
        repeat: row.repeat || "없음",
        color: ["yellow", "blue", "red", "green", "lightGreen", "orange", "navy", "purple"].includes(color) ? color : "yellow",
      };
      nextSchedules[scheduleKey] = [...(nextSchedules[scheduleKey] || []), item];
    });

    return nextSchedules;
  }

  // 성공 시 true, 실패 시 false 반환 — 호출부에서 pending 플래그 처리에 사용
  async function saveSchedulesToSupabase(nextSchedules: Record<string, ScheduleItem[]>): Promise<boolean> {
    if (!isSupabaseConfigured || !supabase) return false;

    const rows = Object.entries(nextSchedules).flatMap(([scheduleKey, items]) => {
      const { year, month, day } = parseScheduleKey(scheduleKey);

      return items.map(item => ({
        schedule_id: item.id,
        schedule_key: scheduleKey,
        month,
        day,
        title: item.title,
        entry_date: item.startDate || `${year}-${pad(month)}-${pad(day)}`,
        start_date: item.startDate || `${year}-${pad(month)}-${pad(day)}`,
        start_time: item.startTime || "08:00",
        end_date: item.endDate || item.startDate || `${year}-${pad(month)}-${pad(day)}`,
        end_time: item.endTime || "24:00",
        repeat: item.repeat || "없음",
        color: item.color || "yellow",
        updated_at: new Date().toISOString(),
      }));
    });

    // 전체 삭제 후 현재 상태로 전체 재삽입
    const { error: deleteError } = await supabase
      .from("calendar_schedules")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (deleteError) {
      console.warn("Supabase schedule clear error:", deleteError.message);
      return false; // 삭제 실패 → pending 유지해야 함
    }

    if (!rows.length) return true; // 모든 일정 삭제 성공 (빈 상태)

    const { error: insertError } = await supabase
      .from("calendar_schedules")
      .insert(rows);

    if (insertError) {
      console.warn("Supabase schedule save error:", insertError.message);
      return false; // 삽입 실패 → pending 유지
    }

    return true;
  }



  function saveDiaryEntryToSupabase(month: number, day: number, nextDiaryText: string, nextVoiceText: string, year: number = currentYear) {
    if (!isSupabaseConfigured || !supabase) return;

    void supabase
      .from("diary_entries")
      .upsert(
        {
          entry_date: entryDate(month, day, year),
          diary_text: nextDiaryText,
          voice_text: nextVoiceText,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "entry_date" }
      )
      .then(({ error }) => {
        if (error) console.warn("Supabase diary save error:", error.message);
      });
  }

  function saveInfoEntryToSupabase(month: number, day: number, nextInfoText: string, year: number = currentYear) {
    if (!isSupabaseConfigured || !supabase) return;

    void supabase
      .from("info_entries")
      .upsert(
        {
          entry_date: entryDate(month, day, year),
          info_text: nextInfoText,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "entry_date" }
      )
      .then(({ error }) => {
        if (error) console.warn("Supabase info save error:", error.message);
      });
  }

  function saveInfoTextCards(month: number, day: number, nextCards: InfoTextCard[], year: number = currentYear) {
    const cardKey = key(month, day, year);
    setInfoTextCards(previousCards => ({ ...previousCards, [cardKey]: nextCards }));
    localStorage.setItem(storageKey("infoTextCards", month, day, year), JSON.stringify(nextCards));
    
    // Optimistically update allInstaCards to instantly reflect edits/saves in the sidebar index
    setAllInstaCards(prevAllCards => {
      const dateStr = entryDate(month, day, year);
      const nextCardIds = nextCards.map(c => c.id);
      
      const filteredPrev = prevAllCards.filter(c => {
        if (c.entryDate === dateStr) {
          return nextCardIds.includes(c.id);
        }
        return true;
      });
      
      const newParsedCards = nextCards.map(c => 
        parseInstaCardContent(c.content, c.id, dateStr, c.createdAt || new Date().toISOString())
      );
      
      const result = [...filteredPrev];
      newParsedCards.forEach(nc => {
        const idx = result.findIndex(c => c.id === nc.id);
        if (idx > -1) {
          result[idx] = nc;
        } else {
          result.push(nc);
        }
      });
      
      return result;
    });

    void saveInfoTextCardsToSupabase(month, day, nextCards, year);
  }

  async function loadInfoTextCardsFromSupabase(month: number, day: number, year: number = currentYear) {
    if (!isSupabaseConfigured || !supabase) return null;

    const { data, error } = await supabase
      .from("info_text_cards")
      .select("card_id, content, created_at, sort_order")
      .eq("entry_date", entryDate(month, day, year))
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("Supabase info text card load error:", error.message);
      return null;
    }

    return (data || []).map((row: any) => ({
      id: String(row.card_id || row.id || `${Date.now()}`),
      content: String(row.content || ""),
      createdAt: row.created_at || new Date().toISOString(),
    })) as InfoTextCard[];
  }

  async function saveInfoTextCardsToSupabase(month: number, day: number, nextCards: InfoTextCard[], year: number = currentYear) {
    if (!isSupabaseConfigured || !supabase) return;

    const targetDate = entryDate(month, day, year);
    const { error: deleteError } = await supabase.from("info_text_cards").delete().eq("entry_date", targetDate);
    if (deleteError) {
      console.warn("Supabase info text card clear error:", deleteError.message);
      return;
    }

    if (!nextCards.length) return;

    const rows = nextCards.map((card, index) => ({
      entry_date: targetDate,
      month,
      day,
      card_id: card.id,
      content: card.content,
      sort_order: index,
      updated_at: new Date().toISOString(),
    }));

    const { error: insertError } = await supabase.from("info_text_cards").insert(rows);
    if (insertError) console.warn("Supabase info text card save error:", insertError.message);
  }

  async function getInfoTextCardContent() {
    const selectedText = (() => {
      const textarea = infoTextareaRef.current;
      if (!textarea) return "";
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      if (start === end) return "";
      return textarea.value.slice(start, end).trim();
    })();

    if (selectedText) return selectedText;

    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText.trim()) return clipboardText.trim();
    } catch {
      // 아이폰/Safari에서 클립보드 권한이 막힌 경우 직접 입력으로 진행
    }

    const manualText = window.prompt("글 카드에 추가할 내용을 붙여넣으세요.");
    if (manualText?.trim()) return manualText.trim();

    return "";
  }

  async function addInfoTextCardFromBody() {
    const content = await getInfoTextCardContent();

    if (!content) {
      alert("글 카드에 저장할 내용이 없습니다. 글을 복사한 뒤 다시 눌러 주세요.");
      return;
    }

    const cardKey = key(currentMonth, currentDay);
    const previousCards = infoTextCards[cardKey] || [];

    registerUndo({
      label: "정보보관소 글 카드 추가",
      target: "infoTextCards",
      month: currentMonth,
      day: currentDay,
      previousData: JSON.stringify(previousCards),
    });

    if (previousCards.length === 0) {
      const nextCard: InfoTextCard = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content,
        createdAt: new Date().toISOString(),
      };

      saveInfoTextCards(currentMonth, currentDay, [nextCard]);
      alert("복사글 카드를 저장했습니다.");
      return;
    }

    const lastIndex = previousCards.length - 1;
    const nextCards = previousCards.map((card, index) =>
      index === lastIndex
        ? { ...card, content: `${card.content.trim()}\n\n${content}`.trim() }
        : card
    );

    saveInfoTextCards(currentMonth, currentDay, nextCards);
    alert("기존 글 카드에 복사글을 추가했습니다.");
  }

  function editInfoTextCard(cardIndex: number) {
    const cardKey = key(currentMonth, currentDay, currentYear);
    const previousCards = infoTextCards[cardKey] || [];
    const targetCard = previousCards[cardIndex];

    if (!targetCard) return;

    setEditingInfoTextCard({
      index: cardIndex,
      content: targetCard.content,
    });
  }

  function saveEditingInfoTextCard() {
    if (!editingInfoTextCard) return;

    const cardKey = key(currentMonth, currentDay, currentYear);
    const previousCards = infoTextCards[cardKey] || [];
    const targetCard = previousCards[editingInfoTextCard.index];

    if (!targetCard) {
      setEditingInfoTextCard(null);
      return;
    }

    const trimmedContent = editingInfoTextCard.content.trim();
    if (!trimmedContent) {
      alert("글 카드 내용은 비워둘 수 없습니다.");
      return;
    }

    registerUndo({
      label: "정보보관소 글 카드 수정",
      target: "infoTextCards",
      year: currentYear,
      month: currentMonth,
      day: currentDay,
      previousData: JSON.stringify(previousCards),
    });

    const nextCards = previousCards.map((card, index) =>
      index === editingInfoTextCard.index
        ? { ...card, content: trimmedContent }
        : card
    );

    saveInfoTextCards(currentMonth, currentDay, nextCards, currentYear);
    setEditingInfoTextCard(null);
  }

  function deleteInfoTextCard(cardIndex: number) {
    const cardKey = key(currentMonth, currentDay, currentYear);
    const previousCards = infoTextCards[cardKey] || [];
    if (!previousCards[cardIndex]) return;
    if (!window.confirm("이 글 카드를 삭제할까요?")) return;

    registerUndo({
      label: "정보보관소 글 카드 삭제",
      target: "infoTextCards",
      year: currentYear,
      month: currentMonth,
      day: currentDay,
      previousData: JSON.stringify(previousCards),
    });

    const nextCards = previousCards.filter((_, index) => index !== cardIndex);
    saveInfoTextCards(currentMonth, currentDay, nextCards, currentYear);
  }

  function saveWeatherToSupabase(month: number, day: number, weatherData: Record<string, string>, year: number = currentYear) {
    if (!isSupabaseConfigured || !supabase) return;

    void supabase
      .from("diary_entries")
      .upsert(
        {
          entry_date: entryDate(month, day, year),
          weather: weatherData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "entry_date" }
      )
      .then(({ error }) => {
        if (error) console.warn("Supabase weather save error:", error.message);
      });
  }
  async function searchDiaryAndInfo() {
    const keyword = searchKeyword.trim();

    if (!keyword) {
      setSearchResults([]);
      setSearchStatus("검색어를 입력하세요.");
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setSearchResults([]);
      setSearchStatus("Supabase 연결 후 검색할 수 있습니다.");
      return;
    }

    setSearchStatus("검색 중...");
    const pattern = `%${keyword}%`;

    const [diaryRes, infoCardsRes, infoMemoRes] = await Promise.all([
      supabase
        .from("diary_entries")
        .select("entry_date, diary_text, voice_text")
        .or(`diary_text.ilike.${pattern},voice_text.ilike.${pattern}`)
        .order("entry_date", { ascending: true }),
      supabase
        .from("info_text_cards")
        .select("entry_date, content")
        .ilike("content", pattern)
        .order("entry_date", { ascending: true }),
      supabase
        .from("info_photos")
        .select("entry_date, caption")
        .ilike("caption", pattern)
        .order("entry_date", { ascending: true }),
    ]);

    const errors = [diaryRes.error, infoCardsRes.error, infoMemoRes.error].filter(Boolean);
    if (errors.length) {
      console.warn("Supabase search error:", errors.map(error => error?.message).join(" / "));
      setSearchResults([]);
      setSearchStatus("검색 중 오류가 발생했습니다.");
      return;
    }

    const nextResults: SearchResult[] = [];

    (diaryRes.data || []).forEach((row: any) => {
      const date = monthDayFromEntryDate(row.entry_date);
      if (!date) return;
      const text = [row.diary_text, row.voice_text].filter(Boolean).join(" / ");
      nextResults.push({
        type: "diary",
        entryDate: row.entry_date,
        year: date.year,
        month: date.month,
        day: date.day,
        text: text || "일기장 검색 결과",
      });
    });

    (infoCardsRes.data || []).forEach((row: any) => {
      const date = monthDayFromEntryDate(row.entry_date);
      if (!date) return;
      
      let cardText = row.content || "";
      if (cardText.startsWith("{")) {
        try {
          const parsed = JSON.parse(cardText);
          cardText = `[인스타 정보 - ${parsed.category}] #${parsed.keyword} / ${parsed.originalText}`;
        } catch (e) {}
      }
      
      nextResults.push({
        type: "info",
        entryDate: row.entry_date,
        year: date.year,
        month: date.month,
        day: date.day,
        text: cardText || "인스타 주요 정보 검색 결과",
      });
    });

    (infoMemoRes.data || []).forEach((row: any) => {
      const date = monthDayFromEntryDate(row.entry_date);
      if (!date) return;
      
      let captionText = row.caption || "";
      if (captionText.startsWith("{")) {
        try {
          const parsed = JSON.parse(captionText);
          captionText = `[포토북] #${parsed.keyword} / ${parsed.memo}`;
        } catch (e) {}
      }
      
      nextResults.push({
        type: "info",
        entryDate: row.entry_date,
        year: date.year,
        month: date.month,
        day: date.day,
        text: captionText || "포토북 사진 메모 검색 결과",
      });
    });

    Object.entries(schedules).forEach(([scheduleKey, items]) => {
      const { year, month, day } = parseScheduleKey(scheduleKey);
      if (!month || !day) return;

      items.forEach(item => {
        const scheduleText = `${item.startTime ? `${item.startTime} ` : ""}${item.title}`;
        const searchText = [scheduleText, item.repeat, item.endDate].filter(Boolean).join(" / ");
        if (!searchText.toLowerCase().includes(keyword.toLowerCase())) return;

        nextResults.push({
          type: "diary",
          entryDate: entryDate(month, day, year),
          year,
          month,
          day,
          text: `캘린더 일정 · ${scheduleText}`,
        });
      });
    });

    googleSchedules.forEach(item => {
      const googleText = [item.title, item.start, item.end, item.allDay ? "종일" : ""].filter(Boolean).join(" / ");
      if (!googleText.toLowerCase().includes(keyword.toLowerCase())) return;

      nextResults.push({
        type: "diary",
        entryDate: entryDate(currentMonth, currentDay, currentYear),
        year: currentYear,
        month: currentMonth,
        day: currentDay,
        text: `구글 일정 · ${item.allDay ? "종일" : item.start || "시간 없음"} ${item.title}`,
      });
    });

    const unique = new Map<string, SearchResult>();
    nextResults.forEach(result => {
      const uniqueKey = `${result.type}-${result.entryDate}-${result.text.slice(0, 40)}`;
      if (!unique.has(uniqueKey)) unique.set(uniqueKey, result);
    });

    const results = Array.from(unique.values()).slice(0, 30);
    setSearchResults(results);
    setSearchStatus(results.length ? `${results.length}개 검색 결과` : "검색 결과가 없습니다.");
  }

  async function loadGoogleSchedulesForDay(month: number, day: number, year: number = currentYear) {
    setGoogleScheduleStatus("구글 일정 조회 중");
    setGoogleSchedules([]);

    try {
      const response = await fetch(`/api/google-calendar?date=${entryDate(month, day, year)}`, { cache: "no-store" });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.message || "google calendar error");
      }

      const items = Array.isArray(data.items) ? data.items : [];
      setGoogleSchedules(items);
      setGoogleScheduleStatus(items.length ? `${items.length}개 일정` : "구글 일정 없음");
    } catch (error) {
      console.warn("Google calendar load error:", error instanceof Error ? error.message : error);
      setGoogleSchedules([]);
      setGoogleScheduleStatus("구글 일정 연결 필요");
    }
  }


  useEffect(() => {
    setActivePreviewPhotoUrl(null);
  }, [activeItem]);

  useEffect(() => {
    let localSchedules: Record<string, ScheduleItem[]> = {};

    try {
      const rawCalendar = localStorage.getItem("iphone-diary-2026-calendar-photos");
      if (rawCalendar) setCalendarPhotos(JSON.parse(rawCalendar));
      const rawCalendarIndexes = localStorage.getItem("iphone-diary-2026-calendar-photo-indexes");
      if (rawCalendarIndexes) setCalendarPhotoIndexes(JSON.parse(rawCalendarIndexes));
      const rawSchedules = localStorage.getItem("iphone-calendar-2026-schedules");
      if (rawSchedules) {
        localSchedules = JSON.parse(rawSchedules);
        setSchedules(localSchedules);
      }
      const rawRedDates = localStorage.getItem("iphone-calendar-2026-red-dates");
      if (rawRedDates) setRedDates(JSON.parse(rawRedDates));
      const rawMarks = localStorage.getItem("iphone-calendar-2026-marks");
      if (rawMarks) setCalendarMarks(JSON.parse(rawMarks));
    } catch {
      setCalendarPhotos({});
    }

    try {
      const rawApiKey = localStorage.getItem("gemini_api_key");
      if (rawApiKey) setGeminiApiKey(rawApiKey);
    } catch (e) {}

    void loadCalendarPhotosFromSupabase();
    void loadCalendarMarksFromSupabase();

    const pendingSave = localStorage.getItem("iphone-calendar-schedule-pending") === "true";

    if (pendingSave && Object.keys(localSchedules).length > 0) {
      // 이전 저장 실패 → 로컬 데이터를 Supabase에 재업로드
      void saveSchedulesToSupabase(localSchedules).then((success) => {
        if (success) {
          localStorage.setItem("iphone-calendar-schedule-pending", "false");
          localStorage.setItem("iphone-calendar-schedule-saved-at", String(Date.now()));
        }
      });
    } else {
      void loadCalendarSchedulesFromSupabase().then(remoteSchedules => {
        if (!remoteSchedules) return; // 네트워크 오류 → 로컬 유지

        if (Object.keys(remoteSchedules).length > 0) {
          // Supabase에 데이터 있음 → 다른 기기의 최신 상태로 로컬 업데이트
          setSchedules(remoteSchedules);
          localStorage.setItem("iphone-calendar-2026-schedules", JSON.stringify(remoteSchedules));
          return;
        }

        // Supabase가 비어있음 = 다른 기기에서 전부 삭제 → 로컬도 비워야 함
        setSchedules({});
        localStorage.setItem("iphone-calendar-2026-schedules", "{}");
      });
    }

    // 탭/창이 다시 활성화될 때 Supabase에서 최신 일정 재조회
    // → 다른 기기(PC)  에서 추가/삭제한 내용이 반영됨
    function syncSchedulesFromSupabase() {
      // pending=true면 로컬 저장 진행 중 → 폴링 스킵
      if (localStorage.getItem("iphone-calendar-schedule-pending") === "true") return;
      // 저장 완료 후 35초 이내면 스킵 → 저장 직후 Supabase 덮어씌움 방지
      const savedAt = Number(localStorage.getItem("iphone-calendar-schedule-saved-at") || "0");
      if (Date.now() - savedAt < 35000) return;

      void loadCalendarSchedulesFromSupabase().then(remoteSchedules => {
        if (!remoteSchedules) return; // 네트워크 오류 → 로컬 유지
        if (Object.keys(remoteSchedules).length === 0) {
          // Supabase가 비어있음 = 다른 기기에서 전부 삭제 → 로컬도 비워야 함
          setSchedules({});
          localStorage.setItem("iphone-calendar-2026-schedules", "{}");
          return;
        }
        setSchedules(remoteSchedules);
        localStorage.setItem("iphone-calendar-2026-schedules", JSON.stringify(remoteSchedules));
      });
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") syncSchedulesFromSupabase();
    };
    const handleFocus = () => syncSchedulesFromSupabase();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    // 30초 주기 자동 폴링 — PC/아이폰 간 실시간에 가까운 동기화
    const pollingInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        syncSchedulesFromSupabase();
      }
    }, 30000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      clearInterval(pollingInterval);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("gemini_api_key", geminiApiKey);
  }, [geminiApiKey]);

  useEffect(() => {
    if (view !== "diary") return;

    let isActive = true;
    const photoKey = key(currentMonth, currentDay, currentYear);

    // Supabase가 설정된 상태에서는 서버 데이터를 우선합니다.
    // 예전 localStorage 데이터가 기기마다 달라서 아이폰/PC가 다르게 보이는 문제를 방지합니다.
    if (isSupabaseConfigured && supabase) {
      setDiaryText("");
      setVoiceText("");
      setPhotos(prev => ({ ...prev, [photoKey]: [] }));
    } else {
      try {
        const raw = localStorage.getItem(storageKey("diary", currentMonth, currentDay, currentYear));
        const data = raw ? JSON.parse(raw) : {};
        setDiaryText(data.diaryText || "");
        setVoiceText(data.voiceText || "");

        const rawPhotos = localStorage.getItem(storageKey("photos", currentMonth, currentDay, currentYear));
        const items = rawPhotos ? JSON.parse(rawPhotos) : [];
        setPhotos(prev => ({ ...prev, [photoKey]: items }));

        const rawWeather = localStorage.getItem(weatherStorageKey(currentMonth, currentDay, currentYear));
        if (rawWeather) {
          const cachedWeather = JSON.parse(rawWeather);
          if (isWeatherForSelectedDate(cachedWeather, currentMonth, currentDay, currentYear)) {
            setWeather(cachedWeather.weather || "확인 필요");
            setTemp(cachedWeather.temperature || "-");
            setWeatherTime(cachedWeather.observedAt || "-");
            setWeatherSource(cachedWeather.source || "기상청");
          } else {
            localStorage.removeItem(weatherStorageKey(currentMonth, currentDay, currentYear));
            setWeather("해당일 날씨 조회 필요");
            setTemp("-");
            setWeatherTime("-");
            setWeatherSource("기상청");
          }
        }
      } catch {
        setDiaryText("");
        setVoiceText("");
      }
    }

    loadDiaryEntryFromSupabase(currentMonth, currentDay, currentYear).then(remoteData => {
      if (!isActive) return;

      const remoteDiaryText = remoteData?.diary_text || "";
      const remoteVoiceText = remoteData?.voice_text || "";
      setDiaryText(remoteDiaryText);
      setVoiceText(remoteVoiceText);
      localStorage.setItem(
        storageKey("diary", currentMonth, currentDay, currentYear),
        JSON.stringify({ diaryText: remoteDiaryText, voiceText: remoteVoiceText })
      );

      const remoteWeather = remoteData?.weather;
      if (remoteWeather && typeof remoteWeather === "object") {
        if (isWeatherForSelectedDate(remoteWeather, currentMonth, currentDay, currentYear)) {
          setWeather(remoteWeather.weather || "확인 필요");
          setTemp(remoteWeather.temperature || "-");
          setWeatherTime(remoteWeather.observedAt || "-");
          setWeatherSource(remoteWeather.source || "기상청");
          localStorage.setItem(weatherStorageKey(currentMonth, currentDay, currentYear), JSON.stringify(remoteWeather));
        } else {
          setWeather("해당일 날씨 조회 필요");
          setTemp("-");
          setWeatherTime("-");
          setWeatherSource("기상청");
        }
      }
    });

    loadDiaryPhotosFromSupabase(currentMonth, currentDay, currentYear).then(remoteItems => {
      if (!isActive || !remoteItems) return;

      setPhotos(prev => ({ ...prev, [photoKey]: remoteItems }));
      setLocalStorageSafely(storageKey("photos", currentMonth, currentDay, currentYear), JSON.stringify(remoteItems));

      const calendarIndex = remoteItems.findIndex(item => item.isCalendarPhoto);
      if (calendarIndex >= 0) {
        const nextCalendarPhotos = { ...calendarPhotos, [photoKey]: remoteItems[calendarIndex].url };
        const nextCalendarPhotoIndexes = { ...calendarPhotoIndexes, [photoKey]: calendarIndex };
        setCalendarPhotos(nextCalendarPhotos);
        setCalendarPhotoIndexes(nextCalendarPhotoIndexes);
        setLocalStorageSafely("iphone-diary-2026-calendar-photos", JSON.stringify(nextCalendarPhotos));
        setLocalStorageSafely("iphone-diary-2026-calendar-photo-indexes", JSON.stringify(nextCalendarPhotoIndexes));
      } else if (isSupabaseConfigured && supabase) {
        const nextCalendarPhotos = { ...calendarPhotos };
        const nextCalendarPhotoIndexes = { ...calendarPhotoIndexes };
        delete nextCalendarPhotos[photoKey];
        delete nextCalendarPhotoIndexes[photoKey];
        setCalendarPhotos(nextCalendarPhotos);
        setCalendarPhotoIndexes(nextCalendarPhotoIndexes);
        setLocalStorageSafely("iphone-diary-2026-calendar-photos", JSON.stringify(nextCalendarPhotos));
        setLocalStorageSafely("iphone-diary-2026-calendar-photo-indexes", JSON.stringify(nextCalendarPhotoIndexes));
      }
    });

    fetchWeatherFromKma();
    void loadGoogleSchedulesForDay(currentMonth, currentDay, currentYear);

    return () => {
      isActive = false;
    };
  }, [view, currentMonth, currentDay, currentYear]);

  useEffect(() => {
    // Supabase에서 먼저 불러오고, 실패하면 localStorage fallback
    loadRedDatesFromSupabase(currentYear)
      .then(remote => {
        if (remote && Object.keys(remote).length > 0) {
          setRedDates(remote);
          // 로컬스토리지도 최신으로 갱신
          localStorage.setItem(`iphone-calendar-${currentYear}-red-dates`, JSON.stringify(remote));
        } else {
          // Supabase에 데이터 없으면 로컬스토리지 확인 후 Supabase 업로드
          try {
            const rawRedDates = localStorage.getItem(`iphone-calendar-${currentYear}-red-dates`);
            if (rawRedDates) {
              const local = JSON.parse(rawRedDates) as Record<number, number[]>;
              setRedDates(local);
              // 로컬에 데이터가 있으면 Supabase에도 올림
              Object.entries(local).forEach(([month, days]) => {
                void saveRedDateToSupabase(currentYear, Number(month), days);
              });
            } else {
              setRedDates({});
            }
          } catch {
            setRedDates({});
          }
        }
      })
      .catch(() => {
        // 네트워크 오류 시 localStorage fallback
        try {
          const rawRedDates = localStorage.getItem(`iphone-calendar-${currentYear}-red-dates`);
          if (rawRedDates) setRedDates(JSON.parse(rawRedDates));
          else setRedDates({});
        } catch {
          setRedDates({});
        }
      });
  }, [currentYear]);


  useEffect(() => {
    if (view !== "info") return;
    const defaultDate = entryDate(currentMonth, currentDay);
    setInstaInputDate(defaultDate);
    setPhotoBookInputDate(defaultDate);
    void refreshAllInfoData();
  }, [view, currentMonth, currentDay]);

  useEffect(() => {
    const handleViewportChange = () => {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty("--ios-vvh", `${viewportHeight}px`);
    };

    handleViewportChange();
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);

    return () => {
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
      document.body.classList.remove("ios-keyboard-editing");
      document.documentElement.style.removeProperty("--ios-vvh");
    };
  }, []);

  useEffect(() => {
    if (view !== "diary") return;
    requestAnimationFrame(() => resizeTextareaToContent(diaryTextareaRef.current));
  }, [view, diaryText, currentMonth, currentDay]);

  useEffect(() => {
    if (view !== "info") return;
    requestAnimationFrame(() => resizeTextareaToContent(infoTextareaRef.current));
  }, [view, infoText, currentMonth, currentDay]);

  useEffect(() => {
    setIsPhotoMemoExpanded(false);
  }, [activeItem]);

  useEffect(() => {
    if (!photoAlbumViewer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePhotoAlbumViewer();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        movePhotoAlbumViewer(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        movePhotoAlbumViewer(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [photoAlbumViewer]);

  useEffect(() => {
    if (!activeItem || activeItem.type !== "photobook" || !activeItem.id) {
      setActivePhotoResolvedExifs(null);
      return;
    }
    const photoId = activeItem.id;
    const raw = allPhotoBookItems.find((item) => item.id === photoId);
    if (!raw) {
      setActivePhotoResolvedExifs(null);
      return;
    }
    const parsed = parsePhotoBookMemo(raw.memo || "");
    let cancelled = false;
    void enrichPhotoBookImageExifs(parsed.imageExifs || []).then((exifs) => {
      if (!cancelled) setActivePhotoResolvedExifs(exifs);
    });
    return () => {
      cancelled = true;
    };
  }, [activeItem, allPhotoBookItems]);

  useEffect(() => {
    photoCropPanRef.current = photoCropPan;
  }, [photoCropPan]);

  useEffect(() => {
    photoCropScaleRef.current = photoCropScale;
  }, [photoCropScale]);

  useEffect(() => {
    photoCropRectRef.current = photoCropRect;
  }, [photoCropRect]);

  useEffect(() => {
    photoCropStageSizeRef.current = photoCropStageSize;
  }, [photoCropStageSize]);

  useEffect(() => {
    photoCropNaturalRef.current = photoCropNatural;
  }, [photoCropNatural]);

  useEffect(() => {
    photoCropAspectRef.current = photoCropAspect;
  }, [photoCropAspect]);

  useEffect(() => {
    if (!photoCropMode) return;
    const id = requestAnimationFrame(() => {
      const img = photoCropImageRef.current;
      if (img?.naturalWidth) {
        onPhotoCropImageLoad();
      } else {
        updatePhotoCropStageSize();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [photoCropMode, originalImageUrl]);

  useEffect(() => {
    if (!photoCropMode) return;

    const getTouchPoint = (touch: Touch) => ({ x: touch.clientX, y: touch.clientY });

    const beginPan = (x: number, y: number) => {
      photoCropGestureRef.current = {
        mode: "pan",
        startX: x,
        startY: y,
        startPan: { ...photoCropPanRef.current },
        startScale: photoCropScaleRef.current,
        startDist: 0,
        startRect: { ...photoCropRectRef.current },
        pinchOriginX: 0,
        pinchOriginY: 0,
      };
    };

    const beginPinch = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const stage = photoCropStageRef.current;
      if (!stage) return;
      const bounds = stage.getBoundingClientRect();
      const midX = (a.x + b.x) / 2 - bounds.left;
      const midY = (a.y + b.y) / 2 - bounds.top;
      photoCropGestureRef.current = {
        mode: "pinch",
        startX: midX,
        startY: midY,
        startPan: { ...photoCropPanRef.current },
        startScale: photoCropScaleRef.current,
        startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        startRect: { ...photoCropRectRef.current },
        pinchOriginX: midX,
        pinchOriginY: midY,
      };
    };

    const applyPan = (x: number, y: number) => {
      const gesture = photoCropGestureRef.current;
      if (!gesture || gesture.mode !== "pan") return;
      const stageSize = photoCropStageSizeRef.current;
      const natural = photoCropNaturalRef.current;
      if (stageSize.w <= 0 || stageSize.h <= 0) return;
      const next = clampPhotoCropPan(
        { x: gesture.startPan.x + (x - gesture.startX), y: gesture.startPan.y + (y - gesture.startY) },
        photoCropScaleRef.current,
        stageSize,
        natural,
        photoCropRectRef.current
      );
      setPhotoCropPan(next);
    };

    const applyPinch = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const gesture = photoCropGestureRef.current;
      if (!gesture || gesture.mode !== "pinch" || gesture.startDist <= 0) return;
      const stageSize = photoCropStageSizeRef.current;
      const natural = photoCropNaturalRef.current;
      if (stageSize.w <= 0 || stageSize.h <= 0) return;
      const stage = photoCropStageRef.current;
      if (!stage) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const nextScale = clampPhotoCropScale(
        gesture.startScale * (dist / gesture.startDist),
        stageSize,
        natural,
        photoCropRectRef.current
      );
      const bounds = stage.getBoundingClientRect();
      const localX = (a.x + b.x) / 2 - bounds.left;
      const localY = (a.y + b.y) / 2 - bounds.top;
      const offsetX = (gesture.pinchOriginX - stageSize.w / 2 - gesture.startPan.x) / gesture.startScale;
      const offsetY = (gesture.pinchOriginY - stageSize.h / 2 - gesture.startPan.y) / gesture.startScale;
      const pan = {
        x: localX - stageSize.w / 2 - offsetX * nextScale,
        y: localY - stageSize.h / 2 - offsetY * nextScale,
      };
      setPhotoCropScale(nextScale);
      setPhotoCropPan(clampPhotoCropPan(pan, nextScale, stageSize, natural, photoCropRectRef.current));
    };

    const applyCropDrag = (x: number, y: number) => {
      const gesture = photoCropGestureRef.current;
      if (
        !gesture ||
        (gesture.mode !== "crop-move" &&
          gesture.mode !== "nw" &&
          gesture.mode !== "ne" &&
          gesture.mode !== "sw" &&
          gesture.mode !== "se")
      ) {
        return;
      }
      const stageSize = photoCropStageSizeRef.current;
      const natural = photoCropNaturalRef.current;
      if (stageSize.w <= 0 || stageSize.h <= 0) return;
      const dx = (x - gesture.startX) / stageSize.w;
      const dy = (y - gesture.startY) / stageSize.h;
      const start = gesture.startRect;
      let next = { ...start };

      if (gesture.mode === "crop-move") {
        next = { ...start, x: start.x + dx, y: start.y + dy };
      } else if (gesture.mode === "nw") {
        next = { x: start.x + dx, y: start.y + dy, w: start.w - dx, h: start.h - dy };
      } else if (gesture.mode === "ne") {
        next = { x: start.x, y: start.y + dy, w: start.w + dx, h: start.h - dy };
      } else if (gesture.mode === "sw") {
        next = { x: start.x + dx, y: start.y, w: start.w - dx, h: start.h + dy };
      } else if (gesture.mode === "se") {
        next = { x: start.x, y: start.y, w: start.w + dx, h: start.h + dy };
      }

      const aspect = photoCropAspectRef.current;
      if (aspect !== "free") {
        const ratioMap = { "1:1": 1, "4:3": 4 / 3, "16:9": 16 / 9 } as const;
        const target = ratioMap[aspect];
        const stageAspect = stageSize.w / stageSize.h;
        const desired = target / stageAspect;
        if (gesture.mode === "se" || gesture.mode === "ne") {
          next.h = next.w / desired;
        } else if (gesture.mode === "nw" || gesture.mode === "sw") {
          next.w = next.h * desired;
        }
      }

      const clampedRect = clampPhotoCropRect(next);
      setPhotoCropRect(clampedRect);
      setPhotoCropPan((prev) =>
        clampPhotoCropPan(prev, photoCropScaleRef.current, stageSize, natural, clampedRect)
      );
    };

    const onTouchStart = (event: TouchEvent) => {
      const stage = photoCropStageRef.current;
      if (!stage || !stage.contains(event.target as Node)) return;
      // Don't steal handle interactions
      if ((event.target as HTMLElement)?.classList?.contains("photo-crop-handle")) return;
      if ((event.target as HTMLElement)?.closest?.(".photo-crop-handle")) return;

      event.preventDefault();
      const touches = Array.from(event.touches).map(getTouchPoint);
      photoCropPointersRef.current.clear();
      touches.forEach((pt, idx) => photoCropPointersRef.current.set(idx, pt));

      if (touches.length >= 2) {
        beginPinch(touches[0], touches[1]);
      } else if (touches.length === 1) {
        // Drag inside crop box moves the frame; outside pans the photo.
        const target = event.target as HTMLElement | null;
        if (target?.closest?.(".photo-crop-box") && !target.classList.contains("photo-crop-handle")) {
          photoCropGestureRef.current = {
            mode: "crop-move",
            startX: touches[0].x,
            startY: touches[0].y,
            startPan: { ...photoCropPanRef.current },
            startScale: photoCropScaleRef.current,
            startDist: 0,
            startRect: { ...photoCropRectRef.current },
            pinchOriginX: 0,
            pinchOriginY: 0,
          };
        } else {
          beginPan(touches[0].x, touches[0].y);
        }
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = photoCropGestureRef.current;
      if (!gesture) return;
      event.preventDefault();
      const touches = Array.from(event.touches).map(getTouchPoint);
      if (gesture.mode === "pinch" && touches.length >= 2) {
        applyPinch(touches[0], touches[1]);
      } else if (gesture.mode === "pan" && touches.length >= 1) {
        applyPan(touches[0].x, touches[0].y);
      } else if (touches.length >= 1) {
        applyCropDrag(touches[0].x, touches[0].y);
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      const touches = Array.from(event.touches).map(getTouchPoint);
      if (touches.length >= 2) {
        beginPinch(touches[0], touches[1]);
        return;
      }
      if (touches.length === 1) {
        beginPan(touches[0].x, touches[0].y);
        return;
      }
      photoCropGestureRef.current = null;
      photoCropPointersRef.current.clear();
    };

    const onPointerMove = (event: PointerEvent) => {
      // Mouse / stylus fallback (touch uses touch handlers above)
      if (event.pointerType === "touch") return;
      const gesture = photoCropGestureRef.current;
      if (!gesture) return;
      if (gesture.mode === "pan") {
        applyPan(event.clientX, event.clientY);
      } else {
        applyCropDrag(event.clientX, event.clientY);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      photoCropGestureRef.current = null;
    };

    const onResize = () => updatePhotoCropStageSize();

    // Listen on document so attachment does not depend on stage mount timing.
    // non-passive touchstart/move so iOS can prevent page scroll while cropping.
    document.addEventListener("touchstart", onTouchStart, { passive: false });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("resize", onResize);
    };
  }, [photoCropMode]);

  async function fetchWeatherFromKma() {
    if (!isSelectedDiaryDateToday(currentMonth, currentDay, currentYear)) {
      return;
    }

    setWeather("조회 중");
    setTemp("-");
    setWeatherSource("기상청 조회 중");

    try {
      const response = await fetch("/api/weather", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.message || "weather error");
      }

      const nextTemperature = data.temperature
        ? String(data.temperature).includes("℃")
          ? String(data.temperature)
          : `${data.temperature}℃`
        : "-";
      const nextWeather = data.weather || "확인 필요";
      const nextObservedAt = data.observedAt || new Date().toLocaleString("ko-KR");

      setWeather(nextWeather);
      setTemp(nextTemperature);
      setWeatherTime(nextObservedAt);
      const weatherSnapshot = { weather: nextWeather, temperature: nextTemperature, observedAt: nextObservedAt, source: "기상청" };

      setWeatherSource("기상청");
      localStorage.setItem(weatherStorageKey(currentMonth, currentDay, currentYear), JSON.stringify(weatherSnapshot));
      saveWeatherToSupabase(currentMonth, currentDay, weatherSnapshot, currentYear);
    } catch {
      setWeather("기상청 연결 필요");
      setTemp("-");
      setWeatherTime(new Date().toLocaleString("ko-KR"));
      setWeatherSource("KMA_SERVICE_KEY 필요");
    }
  }

  function openCalendar(month = currentMonth) {
    setCurrentMonth(month);
    setView("calendar");
  }

  function handleYearChange(offset: number) {
    const nextYear = currentYear + offset;
    if (nextYear < 2026 || nextYear > 2036) {
      alert("2026년부터 2036년까지만 지원합니다.");
      return;
    }
    let nextMonth = currentMonth;
    if (nextYear === 2026 && currentMonth < 5) {
      nextMonth = 5;
    }
    setCurrentYear(nextYear);
    setCurrentMonth(nextMonth);
  }

  function openDiary(month: number, day: number, year: number = currentYear) {
    setCurrentYear(year);
    setCurrentMonth(month);
    setCurrentDay(day);
    setShowDiaryTextImageInsert(false);
    setView("diary");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openInfo(
    month: number,
    day: number,
    year: number = currentYear,
    subView: "generalInfo" | "photobook" = "generalInfo"
  ) {
    setCurrentYear(year);
    setCurrentMonth(month);
    setCurrentDay(day);
    setInfoSubView(subView);
    setActiveItem(null);
    if (subView === "photobook") {
      setPhotoBookTab("index");
      setEditingPhotoBookItemId(null);
    }
    setView("info");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getAdjacentDate(year: number, month: number, day: number, direction: -1 | 1) {
    let nextYear = year;
    let nextMonth = month;
    let nextDay = day + direction;

    if (nextDay < 1) {
      nextMonth -= 1;
      if (nextMonth < (nextYear === 2026 ? 5 : 1)) {
        if (nextYear > 2026) {
          nextYear -= 1;
          nextMonth = 12;
          nextDay = getDaysInMonth(nextYear, nextMonth);
        } else {
          return { year: 2026, month: 5, day: 1 };
        }
      } else {
        nextDay = getDaysInMonth(nextYear, nextMonth);
      }
    } else if (nextDay > getDaysInMonth(nextYear, nextMonth)) {
      nextMonth += 1;
      if (nextMonth > 12) {
        nextYear += 1;
        nextMonth = 1;
        nextDay = 1;
      } else {
        nextDay = 1;
      }
    }

    return { year: nextYear, month: nextMonth, day: nextDay };
  }

  function moveDiaryDate(direction: -1 | 1) {
    const nextDate = getAdjacentDate(currentYear, currentMonth, currentDay, direction);
    openDiary(nextDate.month, nextDate.day, nextDate.year);
  }

  function moveInfoDate(direction: -1 | 1) {
    const nextDate = getAdjacentDate(currentYear, currentMonth, currentDay, direction);
    openInfo(nextDate.month, nextDate.day, nextDate.year);
  }

  function openSchedule(month: number, day: number) {
    setCurrentMonth(month);
    setCurrentDay(day);
    setScheduleTitle("");
    setScheduleStartDate(`${currentYear}-${pad(month)}-${pad(day)}`);
    setScheduleStartTime("08:00");
    setScheduleEndDate(`${currentYear}-${pad(month)}-${pad(day)}`);
    setScheduleEndTime("24:00");
    setScheduleRepeat("없음");
    setScheduleColor("yellow");
    setEditingScheduleId(null);
    setView("schedule");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openRedDateInput() {
    setRedDateInput((redDates[currentMonth] || []).join(","));
    setView("redDate");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveRedDateInput() {
    const parsedDays = (redDateInput.match(/\d+/g) || [])
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value >= 1 && value <= getDaysInMonth(currentYear, currentMonth));

    const uniqueDays = Array.from(new Set<number>(parsedDays)).sort((a: number, b: number) => a - b);
    const nextRedDates = { ...redDates, [currentMonth]: uniqueDays };
    setRedDates(nextRedDates);
    setRedDateInput(uniqueDays.join(", "));
    // localStorage에도 유지 (오프라인 fallback)
    localStorage.setItem(`iphone-calendar-${currentYear}-red-dates`, JSON.stringify(nextRedDates));
    // Supabase에 저장 → PC/iPhone/iPad 공유
    saveRedDateToSupabase(currentYear, currentMonth, uniqueDays).catch(() => {
      console.warn("빨간 날짜 Supabase 저장 실패 – 로컬스토리지에만 저장됨");
    });
    alert(uniqueDays.length ? `${currentMonth}월 ${uniqueDays.join(", ")}일을 빨간 날짜로 저장했습니다.` : `${currentMonth}월 빨간 날짜를 모두 해제했습니다.`);
    setView("calendar");
  }

  function openCalendarMarkInput() {
    setMarkDateInput("");
    setMarkType("C");
    setMarkPlus(false);
    setView("markDate");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveCalendarMarks(nextMarks: Record<string, CalendarMarkItem[]>) {
    setCalendarMarks(nextMarks);
    localStorage.setItem("iphone-calendar-2026-marks", JSON.stringify(nextMarks));
  }

  async function addCalendarMarks() {
    const parsedDays = (markDateInput.match(/\d+/g) || [])
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value >= 1 && value <= getDaysInMonth(currentYear, currentMonth));

    const uniqueDays = Array.from(new Set<number>(parsedDays)).sort((a: number, b: number) => a - b);
    if (!uniqueDays.length) {
      alert("표시할 날짜를 입력해 주세요. 예: 1, 3, 15");
      return;
    }

    const nextPlus = markType === "노조" ? false : markPlus;
    const nextMarks = { ...calendarMarks };

    uniqueDays.forEach(day => {
      const markKey = key(currentMonth, day, currentYear);
      const current = nextMarks[markKey] || [];
      const exists = current.some(item => item.type === markType && item.plus === nextPlus);
      if (!exists) {
        current.push({
          id: `${Date.now()}-${currentMonth}-${day}-${markType}-${nextPlus ? "plus" : "base"}`,
          type: markType,
          plus: nextPlus,
        });
      }
      nextMarks[markKey] = current;
    });

    saveCalendarMarks(nextMarks);

    const supabaseClient = supabase;
    if (isSupabaseConfigured && supabaseClient) {
      const saveErrors: string[] = [];
      await Promise.all(
        uniqueDays.map(async (day) => {
          const dbMonth = currentYear === 2026 ? currentMonth : currentYear * 100 + currentMonth;
          const { error } = await supabaseClient.from("calendar_marks").upsert(
            {
              month: dbMonth,
              day,
              mark_type: markType,
              plus: nextPlus,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "month,day,mark_type,plus" },
          );
          if (error) {
            console.warn("Supabase calendar mark save error:", error.message);
            saveErrors.push(error.message);
          }
        }),
      );

      if (saveErrors.length) {
        const isCheckConstraint = saveErrors.some((msg) => /mark_type_check|23514/i.test(msg));
        if (isCheckConstraint && markType === "休") {
          alert(
            "休 표시는 이 기기에는 저장됐지만, 서버(DB) 제약 때문에 PC·아이폰 공유에 실패했습니다.\n\n" +
              "Supabase SQL Editor에서 아래를 한 번 실행해 주세요.\n\n" +
              "ALTER TABLE public.calendar_marks DROP CONSTRAINT IF EXISTS calendar_marks_mark_type_check;\n" +
              "ALTER TABLE public.calendar_marks ADD CONSTRAINT calendar_marks_mark_type_check CHECK (mark_type = ANY (ARRAY['C'::text, 'A'::text, '심야'::text, '노조'::text, '休'::text]));",
          );
        } else {
          alert(`근무 표시 서버 저장 실패: ${saveErrors[0]}`);
        }
        return;
      }
    }

    setMarkDateInput(uniqueDays.join(", "));
    alert(`${currentMonth}월 ${uniqueDays.join(", ")}일에 ${markType}${nextPlus ? "+" : ""} 표시를 저장했습니다.`);
  }

  function deleteCalendarMark(month: number, day: number, mark: CalendarMarkItem, year: number = currentYear) {
    const markKey = key(month, day, year);
    const nextMarks = {
      ...calendarMarks,
      [markKey]: (calendarMarks[markKey] || []).filter(item => !(item.type === mark.type && item.plus === mark.plus)),
    };

    if ((nextMarks[markKey] || []).length === 0) delete nextMarks[markKey];

    saveCalendarMarks(nextMarks);

    if (isSupabaseConfigured && supabase) {
      const dbMonth = year === 2026 ? month : year * 100 + month;
      void supabase
        .from("calendar_marks")
        .delete()
        .eq("month", dbMonth)
        .eq("day", day)
        .eq("mark_type", mark.type)
        .eq("plus", mark.plus)
        .then(({ error }) => {
          if (error) console.warn("Supabase calendar mark delete error:", error.message);
        });
    }
  }

  function moveToTodayOnCalendar() {
    const today = getSafeToday();
    setCurrentYear(today.year ?? 2026);
    setCurrentMonth(today.month);
    setCurrentDay(today.day);
    setView("calendar");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openTodayDiary() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    if (year === 2026 && month >= 5 && month <= 12) {
      openDiary(month, day, 2026);
      return;
    }
    if (year >= 2027 && year <= 2036) {
      openDiary(month, day, year);
      return;
    }

    openDiary(5, 24, 2026);
  }

  function openDatePicker(mode: "diary" | "info") {
    setDatePickerMode(mode);
    setDatePickerValue(`${currentYear}-${pad(currentMonth)}-${pad(currentDay)}`);
  }

  function applyDatePicker() {
    if (!datePickerMode) return;
    const match = datePickerValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      alert("올바른 날짜를 선택해 주세요.");
      return;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const maxDay = getDaysInMonth(year, month);

    if (year === 2026) {
      if (month < 5 || month > 12 || day < 1 || day > maxDay) {
        alert("2026년 5월~12월 범위 안의 날짜를 선택해 주세요.");
        return;
      }
    } else if (year >= 2027 && year <= 2036) {
      if (month < 1 || month > 12 || day < 1 || day > maxDay) {
        alert("2027년~2036년 범위 안의 날짜를 선택해 주세요.");
        return;
      }
    } else {
      alert("선택 가능한 날짜 범위를 벗어났습니다 (2026-05-01 ~ 2036-12-31).");
      return;
    }

    setDatePickerMode(null);
    if (datePickerMode === "diary") openDiary(month, day, year);
    if (datePickerMode === "info") openInfo(month, day, year);
  }

  function saveDiary(nextDiaryText: string, nextVoiceText: string, year: number = currentYear) {
    const currentKey = key(currentMonth, currentDay, year);
    const editStart = diaryEditStartRef.current;

    if (
      editStart?.key === currentKey &&
      (editStart.diaryText !== nextDiaryText || editStart.voiceText !== nextVoiceText) &&
      undoHistory[0]?.target !== "diaryText"
    ) {
      registerUndo({
        label: "일기장 본문 수정",
        target: "diaryText",
        year,
        month: currentMonth,
        day: currentDay,
        previousData: JSON.stringify({ diaryText: editStart.diaryText, voiceText: editStart.voiceText }),
      });
    }

    setDiaryText(nextDiaryText);
    setVoiceText(nextVoiceText);
    localStorage.setItem(
      storageKey("diary", currentMonth, currentDay, year),
      JSON.stringify({ diaryText: nextDiaryText, voiceText: nextVoiceText })
    );
    saveDiaryEntryToSupabase(currentMonth, currentDay, nextDiaryText, nextVoiceText, year);
  }

  function saveInfo(nextInfoText: string, year: number = currentYear) {
    const currentKey = key(currentMonth, currentDay, year);
    const editStart = infoEditStartRef.current;

    if (
      editStart?.key === currentKey &&
      editStart.infoText !== nextInfoText &&
      undoHistory[0]?.target !== "infoText"
    ) {
      registerUndo({
        label: "정보보관소 본문 수정",
        target: "infoText",
        year,
        month: currentMonth,
        day: currentDay,
        previousData: JSON.stringify({ infoText: editStart.infoText }),
      });
    }

    setInfoText(nextInfoText);
    localStorage.setItem(storageKey("info", currentMonth, currentDay, year), JSON.stringify({ infoText: nextInfoText }));
    saveInfoEntryToSupabase(currentMonth, currentDay, nextInfoText, year);
  }

  function saveInfoPhotos(month: number, day: number, nextPhotos: PhotoItem[], year: number = currentYear) {
    setLocalStorageSafely(storageKey("infoPhotos", month, day, year), JSON.stringify(nextPhotos));
  }


  function readImageFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("이미지 파일을 읽지 못했습니다."));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
      image.src = dataUrl;
    });
  }

  async function makeImageDataUrl(dataUrl: string, maxSide = 1000, quality = 0.68, force = false) {
    try {
      const image = await loadImage(dataUrl);
      const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * ratio));
      const height = Math.max(1, Math.round(image.height * ratio));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return dataUrl;
      ctx.drawImage(image, 0, 0, width, height);

      const optimized = canvas.toDataURL("image/jpeg", quality);
      if (force) return optimized;
      return optimized.length < dataUrl.length ? optimized : dataUrl;
    } catch {
      return dataUrl;
    }
  }

  async function makeOptimizedImageDataUrl(file: File) {
    const originalDataUrl = await readImageFileAsDataUrl(file);
    if (!file.type.startsWith("image/")) return originalDataUrl;
    return makeImageDataUrl(originalDataUrl, 1200, 0.85);
  }

  async function makeCalendarThumbDataUrl(dataUrl: string) {
    return makeImageDataUrl(dataUrl, 420, 0.7);
  }

  function setLocalStorageSafely(storageName: string, value: string) {
    try {
      localStorage.setItem(storageName, value);
      return true;
    } catch {
      alert("사진 저장 공간이 부족합니다. 사진 수를 줄이거나 기존 사진을 삭제한 뒤 다시 시도해 주세요.");
      return false;
    }
  }


  function dataUrlToBlob(dataUrl: string) {
    const [header, body] = dataUrl.split(",");
    const mime = header.match(/data:(.*?);base64/)?.[1] || "image/jpeg";
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function safeFileName(name: string) {
    const normalized = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    return normalized || "photo.jpg";
  }

  async function uploadPhotoToSupabase(file: File, bucket: "diary-photos" | "info-photos", month: number, day: number, sortOrder: number, year: number = currentYear) {
    if (!isSupabaseConfigured || !supabase) return null;

    try {
      const optimizedDataUrl = await makeOptimizedImageDataUrl(file);
      const blob = dataUrlToBlob(optimizedDataUrl);
      const folder = `${entryDate(month, day, year)}`;
      const storagePath = `${folder}/${Date.now()}-${sortOrder}-${safeFileName(file.name || "photo.jpg")}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(storagePath, blob, {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
      return {
        url: data.publicUrl,
        name: file.name || "photo.jpg",
        tag: tag(month, day, year),
        extraTag: "",
        memo: bucket === "info-photos" ? "#" : "",
        size: "360",
        memoWidth: "360",
        memoHeight: "110",
        storagePath,
      } satisfies PhotoItem;
    } catch (error) {
      console.warn("Supabase photo upload error:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  async function saveDiaryPhotoRecordToSupabase(month: number, day: number, item: PhotoItem, sortOrder: number, isCalendarPhoto = false, year: number = currentYear) {
    if (!isSupabaseConfigured || !supabase || !item.storagePath) return;

    const { error } = await supabase.from("diary_photos").insert({
      entry_date: entryDate(month, day, year),
      storage_path: item.storagePath,
      public_url: item.url,
      sort_order: sortOrder,
      is_calendar_photo: isCalendarPhoto,
    });

    if (error) console.warn("Supabase diary photo record error:", error.message);
  }

  async function saveInfoPhotoRecordToSupabase(month: number, day: number, item: PhotoItem, sortOrder: number, year: number = currentYear) {
    if (!isSupabaseConfigured || !supabase || !item.storagePath) return;

    const { error } = await supabase.from("info_photos").insert({
      entry_date: entryDate(month, day, year),
      storage_path: item.storagePath,
      public_url: item.url,
      caption: normalizeInfoPhotoMemo(item.memo),
      sort_order: sortOrder,
    });

    if (error) console.warn("Supabase info photo record error:", error.message);
  }

  async function deleteSupabasePhoto(bucket: "diary-photos" | "info-photos", table: "diary_photos" | "info_photos", storagePath?: string) {
    if (!isSupabaseConfigured || !supabase || !storagePath) return;

    const { error: storageError } = await supabase.storage.from(bucket).remove([storagePath]);
    if (storageError) console.warn("Supabase photo storage delete error:", storageError.message);

    const { error: tableError } = await supabase.from(table).delete().eq("storage_path", storagePath);
    if (tableError) console.warn("Supabase photo table delete error:", tableError.message);
  }

  async function saveInfoPhotoFiles(files: File[]) {
    if (!files.length) return;

    const k = key(currentMonth, currentDay, currentYear);
    const previousItems = infoPhotos[k] || [];

    registerUndo({
      label: "정보보관소 사진 추가",
      target: "infoPhotos",
      photoKey: k,
      year: currentYear,
      previousData: JSON.stringify(previousItems),
    });

    const newItems: PhotoItem[] = [];

    for (const [offset, file] of files.entries()) {
      const sortOrder = previousItems.length + offset;
      const uploadedItem = await uploadPhotoToSupabase(file, "info-photos", currentMonth, currentDay, sortOrder, currentYear);

      if (uploadedItem) {
        newItems.push(uploadedItem);
        await saveInfoPhotoRecordToSupabase(currentMonth, currentDay, uploadedItem, sortOrder, currentYear);
      } else {
        newItems.push({
          url: await makeOptimizedImageDataUrl(file),
          name: file.name,
          tag: tag(currentMonth, currentDay),
          extraTag: "",
          memo: "",
          size: "360",
          memoWidth: "360",
          memoHeight: "110",
        });
      }
    }

    const nextPhotosForDay = [...previousItems, ...newItems];
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };

    setInfoPhotos(nextInfoPhotos);
    saveInfoPhotos(currentMonth, currentDay, nextPhotosForDay);
  }

  async function addInfoPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []) as File[];
    await saveInfoPhotoFiles(files);
    event.target.value = "";
  }

  async function handleInfoPhotoPaste(event: ClipboardEvent<HTMLDivElement>) {
    const pastedFiles = (Array.from(event.clipboardData.items) as DataTransferItem[])
      .filter(item => item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (!pastedFiles.length) return;
    event.preventDefault();
    await saveInfoPhotoFiles(pastedFiles);
  }

  async function handleInfoPasteZone(event: ClipboardEvent<HTMLDivElement>) {
    const pastedFiles = (Array.from(event.clipboardData.items) as DataTransferItem[])
      .filter(item => item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (!pastedFiles.length) {
      alert("복사한 이미지가 감지되지 않았습니다. Safari에서 이미지를 길게 눌러 ‘이미지 복사’ 후, 이 영역을 길게 눌러 ‘붙여넣기’를 선택해 주세요.");
      return;
    }

    event.preventDefault();
    await saveInfoPhotoFiles(pastedFiles);

    const target = event.currentTarget;
    requestAnimationFrame(() => {
      target.textContent = "";
      target.blur();
    });
  }

  async function pasteInfoPhotoFromClipboard() {
    try {
      const clipboard = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };
      if (!clipboard.read) {
        alert("이 브라우저에서는 이미지 붙여넣기를 지원하지 않습니다. 사진 가져오기를 사용해 주세요.");
        return;
      }

      const clipboardItems = await clipboard.read();
      const files: File[] = [];

      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        files.push(new File([blob], `info_pasted_${Date.now()}.png`, { type: imageType }));
      }

      if (!files.length) {
        alert("클립보드에 이미지 데이터가 없습니다. Safari에서 이미지를 복사한 경우, 아래 붙여넣기 영역을 길게 눌러 붙여넣기를 선택해 주세요.");
        return;
      }

      await saveInfoPhotoFiles(files);
    } catch {
      alert("아이폰 Safari에서는 이미지 붙여넣기가 제한될 수 있습니다. 사진 가져오기를 사용해 주세요.");
    }
  }

  async function deleteInfoPhoto(k: string, index: number) {
    const items = infoPhotos[k] || [];
    if (!items[index]) return;

    const deletingItem = items[index];

    registerUndo({
      label: "정보보관소 사진 삭제",
      target: "infoPhotos",
      photoKey: k,
      previousData: JSON.stringify(items),
    });

    markPhotoAsDeleted("info", deletingItem);

    const nextPhotosForDay = items.filter((_, itemIndex) => itemIndex !== index);
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const { year, month, day } = parseScheduleKey(k);
    saveInfoPhotos(month, day, nextPhotosForDay, year);

    // 되돌리기 지원을 위해 Supabase Storage 파일은 즉시 삭제하지 않습니다.
    // 실제 파일 정리는 추후 별도 "완전 삭제/정리" 기능에서 처리합니다.
    if (deletingItem.storagePath) {
      console.info("Info photo removed locally only for undo support:", deletingItem.storagePath);
    }
  }

  function updateInfoPhotoExtraTag(k: string, index: number, extraTag: string) {
    const items = infoPhotos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, extraTag } : item
    );
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const { year, month, day } = parseScheduleKey(k);
    saveInfoPhotos(month, day, nextPhotosForDay, year);
  }


  function infoPhotoMemoHiddenStorageKey(k: string, index: number, item: PhotoItem) {
    const identity = item.storagePath || item.url || item.name || String(index);
    return `iphone-calendar-2026-info-photo-memo-hidden-${k}-${identity}`;
  }

  function getInfoPhotoMemoHidden(k: string, index: number, item: PhotoItem) {
    if (item.memoHidden === true) return true;

    try {
      return localStorage.getItem(infoPhotoMemoHiddenStorageKey(k, index, item)) === "1";
    } catch {
      return false;
    }
  }

  function setInfoPhotoMemoHidden(k: string, index: number, item: PhotoItem, hidden: boolean) {
    try {
      const storageKey = infoPhotoMemoHiddenStorageKey(k, index, item);
      if (hidden) {
        localStorage.setItem(storageKey, "1");
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // localStorage 사용 불가 환경에서는 화면 상태만 반영
    }
  }

  function saveInfoPhotoMemoToSupabase(item: PhotoItem, memo: string) {
    if (!isSupabaseConfigured || !supabase) return;

    if (item.id) {
      void supabase
        .from("info_photos")
        .update({ caption: memo })
        .eq("id", item.id)
        .then(({ error }) => {
          if (error) console.warn("Supabase info photo memo save error:", error.message);
        });
      return;
    }

    if (item.storagePath) {
      void supabase
        .from("info_photos")
        .update({ caption: memo })
        .eq("storage_path", item.storagePath)
        .then(({ error }) => {
          if (error) console.warn("Supabase info photo memo save error:", error.message);
        });
    }
  }

  function updateInfoPhotoMemo(k: string, index: number, memo: string) {
    const items = infoPhotos[k] || [];
    if (!items[index]) return;

    const normalizedMemo = normalizeInfoPhotoMemo(memo);
    const currentItem = items[index];

    setInfoPhotoMemoHidden(k, index, currentItem, false);

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, memo: normalizedMemo, memoHidden: false } : item
    );
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const { year, month, day } = parseScheduleKey(k);
    saveInfoPhotos(month, day, nextPhotosForDay, year);
    saveInfoPhotoMemoToSupabase(currentItem, normalizedMemo);
  }


  function clearInfoPhotoMemo(k: string, index: number) {
    const items = infoPhotos[k] || [];
    const targetItem = items[index];
    if (!targetItem) return;

    registerUndo({
      label: "정보보관소 메모 삭제",
      target: "infoPhotos",
      photoKey: k,
      previousData: JSON.stringify(items),
      previousInfoMemoHidden: JSON.stringify({
        [infoPhotoMemoHiddenStorageKey(k, index, targetItem)]: localStorage.getItem(infoPhotoMemoHiddenStorageKey(k, index, targetItem)),
      }),
    });

    setInfoPhotoMemoHidden(k, index, targetItem, true);

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, memo: "", extraTag: "", memoHidden: true } : item
    );
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const { year, month, day } = parseScheduleKey(k);
    saveInfoPhotos(month, day, nextPhotosForDay, year);
    saveInfoPhotoMemoToSupabase(targetItem, "");
  }

  async function handleInfoPhotoMenuAction(action: "view" | "delete" | "clearMemo" | "editMemo" | "prev" | "next") {
    if (!selectedInfoPhotoMenu) return;

    const { photoKey, index } = selectedInfoPhotoMenu;
    const items = infoPhotos[photoKey] || [];
    const targetItem = items[index];

    if (!targetItem) {
      setSelectedInfoPhotoMenu(null);
      return;
    }

    if (action === "view") {
      setOriginalImageUrl(targetItem.url);
      setSelectedInfoPhotoMenu(null);
      return;
    }

    if (action === "delete") {
      if (!window.confirm(`${index + 1}번째 사진을 삭제하시겠습니까?`)) return;
      await deleteInfoPhoto(photoKey, index);
      setSelectedInfoPhotoMenu(null);
      return;
    }

    if (action === "clearMemo") {
      if (!window.confirm(`${index + 1}번째 사진의 메모를 삭제하시겠습니까? 사진은 유지됩니다.`)) return;
      clearInfoPhotoMemo(photoKey, index);
      setSelectedInfoPhotoMenu(null);
      return;
    }

    if (action === "editMemo") {
      const nextMemo = window.prompt("사진 메모를 입력하세요:", normalizeInfoPhotoMemo(targetItem.memo));
      if (nextMemo === null) return;
      updateInfoPhotoMemo(photoKey, index, nextMemo);
      setSelectedInfoPhotoMenu(null);
      return;
    }

    if (action === "prev") {
      moveInfoPhoto(photoKey, index, -1);
      setSelectedInfoPhotoMenu(null);
      return;
    }

    if (action === "next") {
      moveInfoPhoto(photoKey, index, 1);
      setSelectedInfoPhotoMenu(null);
    }
  }

  function openInfoPhotoMenu(photoKey: string, index: number) {
    setSelectedInfoPhotoMenu({ photoKey, index });
  }

  function updateInfoPhotoSize(k: string, index: number, size: string) {
    const items = infoPhotos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, size } : item
    );
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const { year, month, day } = parseScheduleKey(k);
    saveInfoPhotos(month, day, nextPhotosForDay, year);
  }


  function updateInfoPhotoMemoFrame(k: string, index: number, memoWidth: string, memoHeight: string) {
    const items = infoPhotos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, memoWidth, memoHeight } : item
    );
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const { year, month, day } = parseScheduleKey(k);
    saveInfoPhotos(month, day, nextPhotosForDay, year);
  }

  function updateDiaryPhotoExtraTag(k: string, index: number, extraTag: string) {
    const items = photos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, extraTag } : item
    );
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    setPhotos(nextPhotos);
    const { year, month, day } = parseScheduleKey(k);
    savePhotos(month, day, nextPhotosForDay, calendarPhotos, calendarPhotoIndexes, year);
  }

  function updateDiaryPhotoMemo(k: string, index: number, memo: string) {
    const items = photos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, memo } : item
    );
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    setPhotos(nextPhotos);
    const { year, month, day } = parseScheduleKey(k);
    savePhotos(month, day, nextPhotosForDay, calendarPhotos, calendarPhotoIndexes, year);
  }

  function updateDiaryPhotoSize(k: string, index: number, size: string) {
    const items = photos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, size } : item
    );
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    setPhotos(nextPhotos);
    const { year, month, day } = parseScheduleKey(k);
    savePhotos(month, day, nextPhotosForDay, calendarPhotos, calendarPhotoIndexes, year);
  }


  function updateDiaryPhotoMemoFrame(k: string, index: number, memoWidth: string, memoHeight: string) {
    const items = photos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, memoWidth, memoHeight } : item
    );
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    setPhotos(nextPhotos);
    const { year, month, day } = parseScheduleKey(k);
    savePhotos(month, day, nextPhotosForDay, calendarPhotos, calendarPhotoIndexes, year);
  }

  function updateDiaryPhotoCardFrame(k: string, index: number, size: string, memoHeight: string) {
    const items = photos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, size, memoWidth: size, memoHeight } : item
    );
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    setPhotos(nextPhotos);
    const { year, month, day } = parseScheduleKey(k);
    savePhotos(month, day, nextPhotosForDay, calendarPhotos, calendarPhotoIndexes, year);
  }

  function updateInfoPhotoCardFrame(k: string, index: number, size: string, memoHeight: string) {
    const items = infoPhotos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, size, memoWidth: size, memoHeight } : item
    );
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const { year, month, day } = parseScheduleKey(k);
    saveInfoPhotos(month, day, nextPhotosForDay, year);
  }

  function moveDiaryPhoto(k: string, index: number, direction: -1 | 1) {
    const items = photos[k] || [];
    const targetIndex = index + direction;
    if (!items[index] || targetIndex < 0 || targetIndex >= items.length) return;

    const { year, month, day } = parseScheduleKey(k);

    registerUndo({
      label: "일기장 사진 순서 변경",
      target: "diaryPhotos",
      photoKey: k,
      year,
      month,
      day,
      previousData: JSON.stringify(items),
      previousCalendarPhotos: JSON.stringify(calendarPhotos),
      previousCalendarPhotoIndexes: JSON.stringify(calendarPhotoIndexes),
    });

    const nextPhotosForDay = [...items];
    [nextPhotosForDay[index], nextPhotosForDay[targetIndex]] = [nextPhotosForDay[targetIndex], nextPhotosForDay[index]];
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    setPhotos(nextPhotos);
    savePhotos(month, day, nextPhotosForDay, calendarPhotos, calendarPhotoIndexes, year);
  }

  function moveInfoPhoto(k: string, index: number, direction: -1 | 1) {
    const items = infoPhotos[k] || [];
    const targetIndex = index + direction;
    if (!items[index] || targetIndex < 0 || targetIndex >= items.length) return;

    const { year, month, day } = parseScheduleKey(k);

    registerUndo({
      label: "정보보관소 사진 순서 변경",
      target: "infoPhotos",
      photoKey: k,
      year,
      month,
      day,
      previousData: JSON.stringify(items),
    });

    const nextPhotosForDay = [...items];
    [nextPhotosForDay[index], nextPhotosForDay[targetIndex]] = [nextPhotosForDay[targetIndex], nextPhotosForDay[index]];
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    saveInfoPhotos(month, day, nextPhotosForDay, year);
  }

  function startPhotoCardResize(
    event: React.PointerEvent<HTMLButtonElement>,
    photoType: "diary" | "info",
    photoKey: string,
    index: number,
    currentSize?: string,
    currentMemoHeight?: string
  ) {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = Number(currentSize || "360");
    const startHeight = Number(currentMemoHeight || "110");
    const minSize = 150;
    const maxSize = Math.min(980, Math.max(180, window.innerWidth - 32));
    const ratio = startHeight / Math.max(startSize, 1);

    const applyFrame = (nextClientX: number, nextClientY: number) => {
      const delta = Math.abs(nextClientX - startX) >= Math.abs(nextClientY - startY)
        ? nextClientX - startX
        : nextClientY - startY;
      const nextSize = Math.max(minSize, Math.min(maxSize, Math.round(startSize + delta)));
      const nextMemoHeight = Math.max(70, Math.min(420, Math.round(nextSize * ratio)));
      if (photoType === "diary") updateDiaryPhotoCardFrame(photoKey, index, String(nextSize), String(nextMemoHeight));
      if (photoType === "info") updateInfoPhotoCardFrame(photoKey, index, String(nextSize), String(nextMemoHeight));
    };

    const handlePointerMove = (moveEvent: PointerEvent) => applyFrame(moveEvent.clientX, moveEvent.clientY);
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function startPhotoFrameResize(
    event: React.PointerEvent<HTMLButtonElement>,
    photoType: "diary" | "info",
    photoKey: string,
    index: number,
    currentSize?: string
  ) {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startSize = Number(currentSize || "360");
    const minSize = 120;
    const maxSize = Math.min(980, Math.max(160, window.innerWidth - 32));

    const applySize = (nextClientX: number) => {
      const delta = nextClientX - startX;
      const nextSize = Math.max(minSize, Math.min(maxSize, Math.round(startSize + delta)));
      if (photoType === "diary") updateDiaryPhotoSize(photoKey, index, String(nextSize));
      if (photoType === "info") updateInfoPhotoSize(photoKey, index, String(nextSize));
    };

    const handlePointerMove = (moveEvent: PointerEvent) => applySize(moveEvent.clientX);
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function startMemoFrameResize(
    event: React.PointerEvent<HTMLButtonElement>,
    photoType: "diary" | "info",
    photoKey: string,
    index: number,
    currentWidth?: string,
    currentHeight?: string
  ) {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = Number(currentWidth || "360");
    const startHeight = Number(currentHeight || "110");
    const minWidth = 150;
    const maxWidth = Math.min(980, Math.max(180, window.innerWidth - 32));
    const minHeight = 72;
    const maxHeight = 560;

    const applyFrame = (nextClientX: number, nextClientY: number) => {
      const deltaX = nextClientX - startX;
      const deltaY = nextClientY - startY;
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, Math.round(startWidth + deltaX)));
      const nextHeight = Math.max(minHeight, Math.min(maxHeight, Math.round(startHeight + deltaY)));
      if (photoType === "diary") updateDiaryPhotoMemoFrame(photoKey, index, String(nextWidth), String(nextHeight));
      if (photoType === "info") updateInfoPhotoMemoFrame(photoKey, index, String(nextWidth), String(nextHeight));
    };

    const handlePointerMove = (moveEvent: PointerEvent) => applyFrame(moveEvent.clientX, moveEvent.clientY);
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function saveSchedules(nextSchedules: Record<string, ScheduleItem[]>) {
    setSchedules(nextSchedules);
    localStorage.setItem("iphone-calendar-2026-schedules", JSON.stringify(nextSchedules));
    // pending=true: 저장 중임을 표시 → 폴링이 Supabase로 덮어씌우는 것 방지
    localStorage.setItem("iphone-calendar-schedule-pending", "true");
    // 저장 완료 시간 기록 → 저장 직후 폴링 스킵용
    void saveSchedulesToSupabase(nextSchedules).then((success) => {
      if (success) {
        localStorage.setItem("iphone-calendar-schedule-pending", "false");
        localStorage.setItem("iphone-calendar-schedule-saved-at", String(Date.now()));
      }
      // 실패 시 pending=true 유지 → 다음 앱 실행 시 로컬 데이터로 재시도
    });
  }

  function registerUndo(nextUndo: UndoState) {
    setUndoHistory(previousHistory => [nextUndo, ...previousHistory].slice(0, 2));
  }

  function beginDiaryTextUndoSession() {
    const currentKey = key(currentMonth, currentDay, currentYear);
    if (diaryEditStartRef.current?.key === currentKey) return;
    diaryEditStartRef.current = { key: currentKey, diaryText, voiceText };
  }

  function beginInfoTextUndoSession() {
    const currentKey = key(currentMonth, currentDay, currentYear);
    if (infoEditStartRef.current?.key === currentKey) return;
    infoEditStartRef.current = { key: currentKey, infoText };
  }

  function applyUndo() {
    const undoState = undoHistory[0];
    if (!undoState) return;

    const finishUndo = () => {
      setUndoHistory(previousHistory => previousHistory.slice(1));
    };

    try {
      if (undoState.target === "infoPhotos" && undoState.photoKey) {
        const restoredItems = JSON.parse(undoState.previousData) as PhotoItem[];
        const { year, month, day } = parseScheduleKey(undoState.photoKey);
        clearDeletedPhotoMarkers("info", restoredItems, year);
        const nextInfoPhotos = { ...infoPhotos, [undoState.photoKey]: restoredItems };
        setInfoPhotos(nextInfoPhotos);
        saveInfoPhotos(month, day, restoredItems, year);

        if (undoState.previousInfoMemoHidden) {
          const hiddenMap = JSON.parse(undoState.previousInfoMemoHidden) as Record<string, string | null>;
          Object.entries(hiddenMap).forEach(([storageKey, value]) => {
            if (value === null) localStorage.removeItem(storageKey);
            else localStorage.setItem(storageKey, value);
          });
        }

        finishUndo();
        void refreshAllInfoData();
        alert("정보보관소 사진 작업을 되돌렸습니다.");
        return;
      }

      if (undoState.target === "diaryPhotos" && undoState.photoKey && undoState.month && undoState.day) {
        const restoredItems = JSON.parse(undoState.previousData) as PhotoItem[];
        const restoredCalendarPhotos = undoState.previousCalendarPhotos
          ? JSON.parse(undoState.previousCalendarPhotos) as Record<string, string>
          : calendarPhotos;
        const restoredCalendarPhotoIndexes = undoState.previousCalendarPhotoIndexes
          ? JSON.parse(undoState.previousCalendarPhotoIndexes) as Record<string, number>
          : calendarPhotoIndexes;

        const { year } = parseScheduleKey(undoState.photoKey);
        clearDeletedPhotoMarkers("diary", restoredItems, year);
        const nextPhotos = { ...photos, [undoState.photoKey]: restoredItems };
        setPhotos(nextPhotos);
        setCalendarPhotos(restoredCalendarPhotos);
        setCalendarPhotoIndexes(restoredCalendarPhotoIndexes);
        savePhotos(undoState.month, undoState.day, restoredItems, restoredCalendarPhotos, restoredCalendarPhotoIndexes, year);

        finishUndo();
        alert("일기장 사진 작업을 되돌렸습니다.");
        return;
      }

      if (undoState.target === "diaryText" && undoState.month && undoState.day) {
        const restored = JSON.parse(undoState.previousData) as { diaryText: string; voiceText: string };
        setCurrentMonth(undoState.month);
        setCurrentDay(undoState.day);
        if (undoState.year) setCurrentYear(undoState.year);
        saveDiary(restored.diaryText || "", restored.voiceText || "", undoState.year);
        diaryEditStartRef.current = null;
        finishUndo();
        requestAnimationFrame(() => resizeTextareaToContent(diaryTextareaRef.current));
        alert("일기장 본문을 되돌렸습니다.");
        return;
      }

      if (undoState.target === "infoText" && undoState.month && undoState.day) {
        const restored = JSON.parse(undoState.previousData) as { infoText: string };
        setCurrentMonth(undoState.month);
        setCurrentDay(undoState.day);
        if (undoState.year) setCurrentYear(undoState.year);
        saveInfo(restored.infoText || "", undoState.year);
        infoEditStartRef.current = null;
        finishUndo();
        requestAnimationFrame(() => resizeTextareaToContent(infoTextareaRef.current));
        alert("정보보관소 본문을 되돌렸습니다.");
        return;
      }

      if (undoState.target === "infoTextCards" && undoState.month && undoState.day) {
        const restoredCards = JSON.parse(undoState.previousData) as InfoTextCard[];
        setCurrentMonth(undoState.month);
        setCurrentDay(undoState.day);
        if (undoState.year) setCurrentYear(undoState.year);
        saveInfoTextCards(undoState.month, undoState.day, restoredCards, undoState.year);
        finishUndo();
        void refreshAllInfoData();
        alert("정보보관소 글 카드를 되돌렸습니다.");
        return;
      }

      if (undoState.target === "schedules") {
        const restoredSchedules = JSON.parse(undoState.previousData) as Record<string, ScheduleItem[]>;
        saveSchedules(restoredSchedules);
        finishUndo();
        alert("캘린더 일정 작업을 되돌렸습니다.");
      }
    } catch (error) {
      console.warn("Undo restore error:", error);
      alert("되돌리기에 실패했습니다.");
    }
  }

  function addSchedule() {
    const trimmedTitle = scheduleTitle.trim();
    if (!trimmedTitle) {
      alert("일정 제목을 입력해 주세요.");
      return;
    }

    const selectedStartDate = scheduleStartDate || `${currentYear}-${pad(currentMonth)}-${pad(currentDay)}`;
    const startYear = Number(selectedStartDate.slice(0, 4));
    const startMonth = Number(selectedStartDate.slice(5, 7));
    const startDay = Number(selectedStartDate.slice(8, 10));
    const k = key(startMonth, startDay, startYear);
    const scheduleData: ScheduleItem = {
      id: editingScheduleId || `${Date.now()}`,
      title: trimmedTitle,
      startDate: selectedStartDate,
      startTime: scheduleStartTime || "08:00",
      endDate: scheduleEndDate || selectedStartDate,
      endTime: scheduleEndTime || "24:00",
      repeat: scheduleRepeat,
      color: scheduleColor,
    };

    const currentItems = schedules[k] || [];
    const nextForDay = editingScheduleId
      ? currentItems.map(item => (item.id === editingScheduleId ? scheduleData : item))
      : [...currentItems, scheduleData];

    const nextSchedules = { ...schedules, [k]: nextForDay };

    registerUndo({
      label: editingScheduleId ? "일정 수정" : "일정 추가",
      target: "schedules",
      previousData: JSON.stringify(schedules),
    });

    saveSchedules(nextSchedules);

    setScheduleTitle("");
    setScheduleStartDate(`${currentYear}-${pad(currentMonth)}-${pad(currentDay)}`);
    setScheduleStartTime("08:00");
    setScheduleEndTime("24:00");
    setScheduleRepeat("없음");
    setScheduleColor("yellow");
    setEditingScheduleId(null);
    alert(editingScheduleId ? "일정이 수정되었습니다." : "일정이 저장되었습니다.");
  }

  function editSchedule(item: ScheduleItem) {
    setEditingScheduleId(item.id);
    setScheduleTitle(item.title);
    setScheduleStartDate(item.startDate || `${currentYear}-${pad(currentMonth)}-${pad(currentDay)}`);
    setScheduleStartTime(item.startTime || "");
    setScheduleEndDate(item.endDate || `${currentYear}-${pad(currentMonth)}-${pad(currentDay)}`);
    setScheduleEndTime(item.endTime || "24:00");
    setScheduleRepeat(item.repeat || "없음");
    setScheduleColor(item.color || "yellow");
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function cancelScheduleEdit() {
    setEditingScheduleId(null);
    setScheduleTitle("");
    setScheduleStartTime("");
    setScheduleEndDate(`${currentYear}-${pad(currentMonth)}-${pad(currentDay)}`);
    setScheduleRepeat("없음");
    setScheduleColor("yellow");
  }


  function openScheduleEditorForItem(item: ScheduleItem, month: number, day: number) {
    setCurrentMonth(month);
    setCurrentDay(day);
    editSchedule(item);
    setView("schedule");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function deleteSchedule(scheduleId: string) {
    const k = key(currentMonth, currentDay, currentYear);
    const nextForDay = (schedules[k] || []).filter(item => item.id !== scheduleId);
    const nextSchedules = { ...schedules, [k]: nextForDay };

    registerUndo({
      label: "일정 삭제",
      target: "schedules",
      previousData: JSON.stringify(schedules),
    });

    // saveSchedules = state + localStorage + Supabase 전체 동기화
    // Supabase는 전체 삭제 후 재삽입 → 삭제된 일정이 확실히 제거됨
    saveSchedules(nextSchedules);

    if (editingScheduleId === scheduleId) cancelScheduleEdit();
  }


  function savePhotos(month: number, day: number, nextPhotos: PhotoItem[], nextCalendarPhotos: Record<string, string>, nextCalendarPhotoIndexes = calendarPhotoIndexes, year: number = currentYear) {
    const okPhotos = setLocalStorageSafely(storageKey("photos", month, day, year), JSON.stringify(nextPhotos));
    const okCalendar = setLocalStorageSafely("iphone-diary-2026-calendar-photos", JSON.stringify(nextCalendarPhotos));
    const okIndexes = setLocalStorageSafely("iphone-diary-2026-calendar-photo-indexes", JSON.stringify(nextCalendarPhotoIndexes));
    return okPhotos && okCalendar && okIndexes;
  }

  async function savePhotoFiles(files: File[]) {
    if (!files.length) return;

    const k = key(currentMonth, currentDay, currentYear);
    const previousItems = photos[k] || [];
    const previousCalendarPhotos = { ...calendarPhotos };
    const previousCalendarPhotoIndexes = { ...calendarPhotoIndexes };
    const newItems: PhotoItem[] = [];

    for (const [offset, file] of files.entries()) {
      const sortOrder = previousItems.length + offset;
      const uploadedItem = await uploadPhotoToSupabase(file, "diary-photos", currentMonth, currentDay, sortOrder, currentYear);

      if (uploadedItem) {
        newItems.push(uploadedItem);
        await saveDiaryPhotoRecordToSupabase(currentMonth, currentDay, uploadedItem, sortOrder, previousItems.length === 0 && offset === 0, currentYear);
      } else {
        newItems.push({
          url: await makeOptimizedImageDataUrl(file),
          name: file.name,
          tag: tag(currentMonth, currentDay, currentYear),
          extraTag: "",
          memo: "",
          size: "360",
          memoWidth: "360",
          memoHeight: "110",
        });
      }
    }

    if (!newItems.length) return;

    registerUndo({
      label: "일기장 사진 추가",
      target: "diaryPhotos",
      photoKey: k,
      year: currentYear,
      month: currentMonth,
      day: currentDay,
      previousData: JSON.stringify(previousItems),
      previousCalendarPhotos: JSON.stringify(previousCalendarPhotos),
      previousCalendarPhotoIndexes: JSON.stringify(previousCalendarPhotoIndexes),
    });

    const nextPhotosForDay = [...previousItems, ...newItems];
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    const nextCalendarPhotos = { ...calendarPhotos };
    const nextCalendarPhotoIndexes = { ...calendarPhotoIndexes };

    if (!nextCalendarPhotos[k]) {
      nextCalendarPhotos[k] = await makeCalendarThumbDataUrl(newItems[0].url);
      nextCalendarPhotoIndexes[k] = previousItems.length;
    }

    setPhotos(nextPhotos);
    setCalendarPhotos(nextCalendarPhotos);
    setCalendarPhotoIndexes(nextCalendarPhotoIndexes);
    savePhotos(currentMonth, currentDay, nextPhotosForDay, nextCalendarPhotos, nextCalendarPhotoIndexes, currentYear);
  }

  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []) as File[];
    await savePhotoFiles(files);
    event.target.value = "";
  }

  async function handlePhotoPaste(event: ClipboardEvent<HTMLDivElement>) {
    const pastedFiles = (Array.from(event.clipboardData.items) as DataTransferItem[])
      .filter(item => item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (!pastedFiles.length) return;
    event.preventDefault();
    await savePhotoFiles(pastedFiles);
  }

  async function setCalendarPhoto(k: string, index: number) {
    const items = photos[k] || [];
    if (!items[index]) return;
    const nextCalendarPhotos = { ...calendarPhotos, [k]: await makeCalendarThumbDataUrl(items[index].url) };
    const nextCalendarPhotoIndexes = { ...calendarPhotoIndexes, [k]: index };
    setCalendarPhotos(nextCalendarPhotos);
    setCalendarPhotoIndexes(nextCalendarPhotoIndexes);
    const { year, month, day } = parseScheduleKey(k);
    savePhotos(month, day, items, nextCalendarPhotos, nextCalendarPhotoIndexes, year);

    if (isSupabaseConfigured && supabase && items[index].storagePath) {
      const targetDate = entryDate(month, day, year);
      const { error: clearError } = await supabase
        .from("diary_photos")
        .update({ is_calendar_photo: false })
        .eq("entry_date", targetDate);
      if (clearError) console.warn("Supabase calendar photo clear error:", clearError.message);

      const { error: setError } = await supabase
        .from("diary_photos")
        .update({ is_calendar_photo: true })
        .eq("storage_path", items[index].storagePath);
      if (setError) console.warn("Supabase calendar photo set error:", setError.message);
    }

    alert("선택한 사진을 월간 캘린더에 붙였습니다.");
  }

  function openCalendarPhotoOriginal(k: string) {
    const { year, month, day } = parseScheduleKey(k);
    const dayItems = photos[k] || (() => {
      try {
        const raw = localStorage.getItem(storageKey("photos", month, day, year));
        return raw ? JSON.parse(raw) as PhotoItem[] : [];
      } catch {
        return [];
      }
    })();
    const selectedIndex = calendarPhotoIndexes[k] ?? 0;
    const original = dayItems[selectedIndex]?.url || dayItems[0]?.url || calendarPhotos[k];
    if (original) setOriginalImageUrl(original);
  }

  async function deletePhoto(k: string, index: number) {
    const items = photos[k] || [];
    if (!items[index]) return;

    const deletingItem = items[index];
    const deletedUrl = deletingItem.url;
    const { year, month, day } = parseScheduleKey(k);

    registerUndo({
      label: "일기장 사진 삭제",
      target: "diaryPhotos",
      photoKey: k,
      month,
      day,
      year,
      previousData: JSON.stringify(items),
      previousCalendarPhotos: JSON.stringify(calendarPhotos),
      previousCalendarPhotoIndexes: JSON.stringify(calendarPhotoIndexes),
    });

    const nextPhotosForDay = items.filter((_, itemIndex) => itemIndex !== index);
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    const nextCalendarPhotos = { ...calendarPhotos };

    const nextCalendarPhotoIndexes = { ...calendarPhotoIndexes };
    const selectedIndex = nextCalendarPhotoIndexes[k];

    if (selectedIndex === index || nextCalendarPhotos[k] === deletedUrl) {
      if (nextPhotosForDay[0]) {
        nextCalendarPhotos[k] = nextPhotosForDay[0].url;
        nextCalendarPhotoIndexes[k] = 0;
      } else {
        delete nextCalendarPhotos[k];
        delete nextCalendarPhotoIndexes[k];
      }
    } else if (typeof selectedIndex === "number" && selectedIndex > index) {
      nextCalendarPhotoIndexes[k] = selectedIndex - 1;
    }

    markPhotoAsDeleted("diary", deletingItem);

    setPhotos(nextPhotos);
    setCalendarPhotos(nextCalendarPhotos);
    setCalendarPhotoIndexes(nextCalendarPhotoIndexes);
    savePhotos(month, day, nextPhotosForDay, nextCalendarPhotos, nextCalendarPhotoIndexes, year);

    // 되돌리기 지원을 위해 Supabase Storage 파일은 즉시 삭제하지 않습니다.
    // 실제 파일 정리는 추후 별도 "완전 삭제/정리" 기능에서 처리합니다.
    if (deletingItem.storagePath) {
      console.info("Diary photo removed locally only for undo support:", deletingItem.storagePath);
    }
  }

  function openDiaryOriginalPhoto(photoKey: string, index: number) {
    const item = photos[photoKey]?.[index];
    if (!item) return;
    setOriginalImageUrl(item.url);
    setOriginalImageTarget({ type: "diary", photoKey, index });
  }

  function closeOriginalImage() {
    setOriginalImageUrl("");
    setOriginalImageTarget(null);
    setPhotoResizePreviewUrl("");
    setPhotoResizeInfo("");
    setPhotoResizeBusy(false);
    setPhotoCropMode(false);
    setPhotoCropAspect("free");
    setPhotoCropRect({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
    setPhotoCropStageSize({ w: 0, h: 0 });
    setPhotoCropNatural({ w: 0, h: 0 });
    setPhotoCropScale(1);
    setPhotoCropPan({ x: 0, y: 0 });
    photoCropPointersRef.current.clear();
    photoCropGestureRef.current = null;
  }

  function openStorageImage(url: string, fileName?: string) {
    if (!url) return;
    setPhotoResizePreviewUrl("");
    setPhotoResizeInfo("");
    setPhotoCropMode(false);
    setOriginalImageUrl(url);
    setOriginalImageTarget({ type: "storage-image", url, fileName });
  }

  function openPhotoBookImageResize(params: {
    url: string;
    photoBookId: string;
    imageIndex: number;
    fileName?: string;
  }) {
    if (!params.url || !params.photoBookId) return;
    setPhotoResizeMaxSide(1200);
    setPhotoResizePreviewUrl("");
    setPhotoResizeInfo("");
    setPhotoCropMode(false);
    setPhotoCropAspect("free");
    setPhotoCropRect({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
    setPhotoCropScale(1);
    setPhotoCropPan({ x: 0, y: 0 });
    setOriginalImageUrl(params.url);
    setOriginalImageTarget({
      type: "photobook-resize",
      url: params.url,
      photoBookId: params.photoBookId,
      imageIndex: params.imageIndex,
      fileName: params.fileName,
    });
  }

  function getPhotoCropBaseFit(
    stage: { w: number; h: number },
    natural: { w: number; h: number }
  ) {
    if (stage.w <= 0 || stage.h <= 0 || natural.w <= 0 || natural.h <= 0) {
      return { baseScale: 1, displayW: 0, displayH: 0 };
    }
    const baseScale = Math.min(stage.w / natural.w, stage.h / natural.h);
    return {
      baseScale,
      displayW: natural.w * baseScale,
      displayH: natural.h * baseScale,
    };
  }

  function getPhotoCropImageRect(
    scale: number,
    pan: { x: number; y: number },
    stage: { w: number; h: number },
    natural: { w: number; h: number }
  ) {
    const { displayW, displayH } = getPhotoCropBaseFit(stage, natural);
    const imgW = displayW * scale;
    const imgH = displayH * scale;
    return {
      left: (stage.w - imgW) / 2 + pan.x,
      top: (stage.h - imgH) / 2 + pan.y,
      width: imgW,
      height: imgH,
    };
  }

  function clampPhotoCropScale(
    scale: number,
    stage: { w: number; h: number },
    natural: { w: number; h: number },
    _cropRect: { x: number; y: number; w: number; h: number }
  ) {
    const { displayW, displayH } = getPhotoCropBaseFit(stage, natural);
    if (displayW <= 0 || displayH <= 0) return 1;
    // Allow zooming from fit(1) up to 8x. Covering the crop window is preferred but
    // not forced as a floor — otherwise one-finger pan has zero room at open.
    void _cropRect;
    return Math.max(1, Math.min(8, scale));
  }

  function clampPhotoCropPan(
    pan: { x: number; y: number },
    scale: number,
    stage: { w: number; h: number },
    natural: { w: number; h: number },
    cropRect: { x: number; y: number; w: number; h: number }
  ) {
    const img = getPhotoCropImageRect(scale, { x: 0, y: 0 }, stage, natural);
    const cropLeft = cropRect.x * stage.w;
    const cropTop = cropRect.y * stage.h;
    const cropRight = (cropRect.x + cropRect.w) * stage.w;
    const cropBottom = (cropRect.y + cropRect.h) * stage.h;
    const centerOffsetX = (stage.w - img.width) / 2;
    const centerOffsetY = (stage.h - img.height) / 2;
    const cropW = cropRight - cropLeft;
    const cropH = cropBottom - cropTop;

    let x = pan.x;
    let y = pan.y;

    // Keep as much of the image under the crop as possible, but always allow
    // some movement so finger drag never feels "stuck".
    if (img.width <= cropW) {
      x = (cropLeft + cropRight) / 2 - stage.w / 2;
    } else {
      const minX = cropRight - centerOffsetX - img.width;
      const maxX = cropLeft - centerOffsetX;
      x = Math.min(maxX, Math.max(minX, x));
    }
    if (img.height <= cropH) {
      y = (cropTop + cropBottom) / 2 - stage.h / 2;
    } else {
      const minY = cropBottom - centerOffsetY - img.height;
      const maxY = cropTop - centerOffsetY;
      y = Math.min(maxY, Math.max(minY, y));
    }
    return { x, y };
  }

  function updatePhotoCropStageSize() {
    const stage = photoCropStageRef.current;
    if (!stage) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w <= 0 || h <= 0) return;
    setPhotoCropStageSize({ w, h });
    setPhotoCropScale((prev) => {
      const next = clampPhotoCropScale(prev, { w, h }, photoCropNatural, photoCropRectRef.current);
      setPhotoCropPan((pan) => clampPhotoCropPan(pan, next, { w, h }, photoCropNatural, photoCropRectRef.current));
      return next;
    });
  }

  function onPhotoCropImageLoad() {
    const img = photoCropImageRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const natural = { w: img.naturalWidth, h: img.naturalHeight };
    setPhotoCropNatural(natural);
    requestAnimationFrame(() => {
      const stage = photoCropStageRef.current;
      if (!stage) return;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (w <= 0 || h <= 0) return;
      const stageSize = { w, h };
      setPhotoCropStageSize(stageSize);
      const scale = clampPhotoCropScale(1, stageSize, natural, photoCropRectRef.current);
      setPhotoCropScale(scale);
      setPhotoCropPan(clampPhotoCropPan({ x: 0, y: 0 }, scale, stageSize, natural, photoCropRectRef.current));
    });
  }

  function clampPhotoCropRect(rect: { x: number; y: number; w: number; h: number }) {
    let { x, y, w, h } = rect;
    w = Math.max(0.12, Math.min(1, w));
    h = Math.max(0.12, Math.min(1, h));
    x = Math.max(0, Math.min(1 - w, x));
    y = Math.max(0, Math.min(1 - h, y));
    return { x, y, w, h };
  }

  function applyPhotoCropAspect(aspect: "free" | "1:1" | "4:3" | "16:9") {
    setPhotoCropAspect(aspect);
    if (aspect === "free") return;
    const ratioMap = { "1:1": 1, "4:3": 4 / 3, "16:9": 16 / 9 } as const;
    const target = ratioMap[aspect];
    const stageAspect = photoCropStageSize.w > 0 && photoCropStageSize.h > 0
      ? photoCropStageSize.w / photoCropStageSize.h
      : 1;
    let w = 0.84;
    let h = w * (stageAspect / target);
    if (h > 0.84) {
      h = 0.84;
      w = h * (target / stageAspect);
    }
    const nextRect = clampPhotoCropRect({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
    setPhotoCropRect(nextRect);
    setPhotoCropScale((prev) => {
      const next = clampPhotoCropScale(prev, photoCropStageSize, photoCropNatural, nextRect);
      setPhotoCropPan((pan) => clampPhotoCropPan(pan, next, photoCropStageSize, photoCropNatural, nextRect));
      return next;
    });
  }

  function startPhotoCropBoxDrag(
    type: "crop-move" | "nw" | "ne" | "sw" | "se",
    event: React.PointerEvent
  ) {
    event.preventDefault();
    event.stopPropagation();
    photoCropPointersRef.current.clear();
    photoCropGestureRef.current = {
      mode: type,
      startX: event.clientX,
      startY: event.clientY,
      startPan: { ...photoCropPanRef.current },
      startScale: photoCropScaleRef.current,
      startDist: 0,
      startRect: { ...photoCropRectRef.current },
      pinchOriginX: 0,
      pinchOriginY: 0,
    };
  }

  function onPhotoCropStagePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Touch is handled by native touch listeners for reliable multi-touch on iOS.
    if (event.pointerType === "touch") return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(".photo-crop-handle")) return;
    if (target?.closest?.(".photo-crop-box")) {
      startPhotoCropBoxDrag("crop-move", event);
      return;
    }
    photoCropPointersRef.current.clear();
    photoCropGestureRef.current = {
      mode: "pan",
      startX: event.clientX,
      startY: event.clientY,
      startPan: { ...photoCropPanRef.current },
      startScale: photoCropScaleRef.current,
      startDist: 0,
      startRect: { ...photoCropRectRef.current },
      pinchOriginX: 0,
      pinchOriginY: 0,
    };
  }

  function nudgePhotoCropZoom(direction: 1 | -1) {
    if (photoCropStageSize.w <= 0 || photoCropNatural.w <= 0) return;
    const prevScale = photoCropScaleRef.current;
    const nextScale = clampPhotoCropScale(
      prevScale * (direction > 0 ? 1.2 : 1 / 1.2),
      photoCropStageSize,
      photoCropNatural,
      photoCropRectRef.current
    );
    const pan = clampPhotoCropPan(
      photoCropPanRef.current,
      nextScale,
      photoCropStageSize,
      photoCropNatural,
      photoCropRectRef.current
    );
    setPhotoCropScale(nextScale);
    setPhotoCropPan(pan);
  }

  function onPhotoCropWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (photoCropStageSize.w <= 0 || photoCropNatural.w <= 0) return;
    const stage = photoCropStageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;
    const prevScale = photoCropScaleRef.current;
    const nextScale = clampPhotoCropScale(
      prevScale * (event.deltaY < 0 ? 1.08 : 1 / 1.08),
      photoCropStageSize,
      photoCropNatural,
      photoCropRectRef.current
    );
    const offsetX = (localX - photoCropStageSize.w / 2 - photoCropPanRef.current.x) / prevScale;
    const offsetY = (localY - photoCropStageSize.h / 2 - photoCropPanRef.current.y) / prevScale;
    const pan = {
      x: localX - photoCropStageSize.w / 2 - offsetX * nextScale,
      y: localY - photoCropStageSize.h / 2 - offsetY * nextScale,
    };
    setPhotoCropScale(nextScale);
    setPhotoCropPan(clampPhotoCropPan(pan, nextScale, photoCropStageSize, photoCropNatural, photoCropRectRef.current));
  }

  function beginPhotoCropMode() {
    setPhotoCropMode(true);
    setPhotoCropAspect("free");
    setPhotoCropRect({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
    setPhotoCropScale(1);
    setPhotoCropPan({ x: 0, y: 0 });
    setPhotoResizePreviewUrl("");
    setPhotoResizeInfo("초록 틀을 드래그하거나, 사진을 확대·이동한 뒤 저장하세요.");
  }

  async function buildCroppedPhotoDataUrl() {
    if (!originalImageUrl) throw new Error("원본 이미지가 없습니다.");
    const source = await loadSourceDataUrl(originalImageUrl);
    const image = await loadImage(source);
    const stage = photoCropStageSize.w > 0
      ? photoCropStageSize
      : { w: photoCropStageRef.current?.clientWidth || 1, h: photoCropStageRef.current?.clientHeight || 1 };
    const natural = photoCropNatural.w > 0
      ? photoCropNatural
      : { w: image.width, h: image.height };
    const imgRect = getPhotoCropImageRect(photoCropScale, photoCropPan, stage, natural);
    if (imgRect.width <= 0 || imgRect.height <= 0) {
      throw new Error("잘라낼 이미지 영역을 계산하지 못했습니다.");
    }

    const cropLeft = photoCropRect.x * stage.w;
    const cropTop = photoCropRect.y * stage.h;
    const cropRight = (photoCropRect.x + photoCropRect.w) * stage.w;
    const cropBottom = (photoCropRect.y + photoCropRect.h) * stage.h;

    // Intersect crop window with the visible image so letterboxed areas are excluded.
    const left = Math.max(cropLeft, imgRect.left);
    const top = Math.max(cropTop, imgRect.top);
    const right = Math.min(cropRight, imgRect.left + imgRect.width);
    const bottom = Math.min(cropBottom, imgRect.top + imgRect.height);
    const cropW = Math.max(1, right - left);
    const cropH = Math.max(1, bottom - top);

    let sx = Math.round(((left - imgRect.left) / imgRect.width) * image.width);
    let sy = Math.round(((top - imgRect.top) / imgRect.height) * image.height);
    let sw = Math.round((cropW / imgRect.width) * image.width);
    let sh = Math.round((cropH / imgRect.height) * image.height);
    sx = Math.max(0, Math.min(image.width - 1, sx));
    sy = Math.max(0, Math.min(image.height - 1, sy));
    sw = Math.max(1, Math.min(image.width - sx, sw));
    sh = Math.max(1, Math.min(image.height - sy, sh));

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("캔버스를 사용할 수 없습니다.");
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
    const cropped = canvas.toDataURL("image/jpeg", 0.92);
    return makeImageDataUrl(cropped, photoResizeMaxSide, 0.9, true);
  }

  async function loadSourceDataUrl(url: string) {
    if (url.startsWith("data:")) return url;
    const base64 = await imageUrlToBase64(url);
    if (!base64) throw new Error("이미지를 불러오지 못했습니다.");
    return `data:image/jpeg;base64,${base64}`;
  }

  async function previewPhotoBookResize(maxSide: 800 | 1200 | 1600 | 2400) {
    if (!originalImageUrl) return;
    setPhotoResizeMaxSide(maxSide);
    setPhotoResizeBusy(true);
    try {
      const source = await loadSourceDataUrl(originalImageUrl);
      const image = await loadImage(source);
      const resized = await makeImageDataUrl(source, maxSide, 0.85, true);
      const previewImage = await loadImage(resized);
      setPhotoResizePreviewUrl(resized);
      setPhotoResizeInfo(
        `원본 ${image.width}×${image.height} → ${previewImage.width}×${previewImage.height} (최대 ${maxSide}px)`
      );
    } catch (error) {
      console.warn(error);
      alert("크기 미리보기에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setPhotoResizeBusy(false);
    }
  }

  async function downloadStorageImage() {
    if (!originalImageTarget) return;
    if (originalImageTarget.type !== "storage-image" && originalImageTarget.type !== "photobook-resize") return;
    const fileName = originalImageTarget.fileName || `saved_image_${Date.now()}.jpg`;
    const sourceUrl = photoResizePreviewUrl || originalImageUrl;
    if (!sourceUrl) return;
    try {
      if (sourceUrl.startsWith("data:")) {
        const link = document.createElement("a");
        link.href = sourceUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }
      const response = await fetch(sourceUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(sourceUrl, "_blank");
    }
  }

  async function replacePhotoBookImageWithDataUrl(dataUrl: string, undoLabel: string) {
    if (!originalImageTarget || originalImageTarget.type !== "photobook-resize") {
      setPhotoResizeBusy(false);
      return;
    }
    const { photoBookId, imageIndex } = originalImageTarget;
    const targetItem = allPhotoBookItems.find((item) => item.id === photoBookId);
    if (!targetItem) {
      alert("포토북 항목을 찾을 수 없습니다.");
      setPhotoResizeBusy(false);
      return;
    }

    setPhotoResizeBusy(true);
    try {
      const blob = dataUrlToBlob(dataUrl);
      const file = new File([blob], originalImageTarget.fileName || `photobook_edited_${Date.now()}.jpg`, {
        type: "image/jpeg",
      });

      const dateStr = targetItem.tag || entryDate(currentMonth, currentDay, currentYear);
      const [tYear, tMonth, tDay] = dateStr.split("-").map(Number);
      const uploaded = await uploadPhotoToSupabase(file, "info-photos", tMonth, tDay, imageIndex, tYear);
      const nextUrl = uploaded?.url || dataUrl;
      const nextPath = uploaded?.storagePath || "";

      const parsed = parsePhotoBookMemo(targetItem.memo || "");
      const urls = [targetItem.url, ...(parsed.additionalImages?.map((img) => img.url) || [])].filter(Boolean);
      const paths = [
        targetItem.storagePath || "",
        ...(parsed.additionalImages?.map((img) => img.storagePath || "") || []),
      ];
      while (urls.length <= imageIndex) urls.push("");
      while (paths.length <= imageIndex) paths.push("");
      urls[imageIndex] = nextUrl;
      paths[imageIndex] = nextPath;

      const primaryUrl = urls[0] || nextUrl;
      const primaryPath = paths[0] || nextPath;
      const additionalImages = urls.slice(1).map((url, i) => ({
        url,
        storagePath: paths[i + 1] || "",
      }));
      const serializedCaption = JSON.stringify({
        type: "photobook",
        keyword: parsed.keyword || "일반",
        category2: parsed.category2 || "기타",
        memo: parsed.memo || "",
        imageMemos: parsed.imageMemos || [],
        imageExifs: parsed.imageExifs || [],
        additionalImages,
        isPinned: parsed.isPinned || targetItem.isPinned || false,
      });

      const photoKey = key(tMonth, tDay, tYear);
      const previousItems = infoPhotos[photoKey] || [];
      registerUndo({
        label: undoLabel,
        target: "infoPhotos",
        photoKey,
        year: tYear,
        previousData: JSON.stringify(previousItems),
      });

      const nextPhotosForDay = previousItems.map((item) => {
        if (item.id !== photoBookId) return item;
        return {
          ...item,
          url: primaryUrl,
          name: primaryPath.split("/").pop() || item.name || "photo.jpg",
          storagePath: primaryPath,
          memo: serializedCaption,
        };
      });

      setInfoPhotos((prev) => ({ ...prev, [photoKey]: nextPhotosForDay }));
      saveInfoPhotos(tMonth, tDay, nextPhotosForDay, tYear);

      if (isSupabaseConfigured && supabase && photoBookId && !photoBookId.startsWith("temp-")) {
        await supabase
          .from("info_photos")
          .update({
            caption: serializedCaption,
            public_url: primaryUrl,
            storage_path: primaryPath,
          })
          .eq("id", photoBookId);
      }

      if (editingPhotoBookItemId === photoBookId) {
        setPhotoBookInputImageUrls(urls);
        setPhotoBookInputImageStoragePaths(paths);
        setPhotoBookInputImageUrl(primaryUrl);
        setPhotoBookInputImageStoragePath(primaryPath);
      }

      setAllPhotoBookItems((prev) =>
        prev.map((item) =>
          item.id === photoBookId
            ? {
                ...item,
                url: primaryUrl,
                storagePath: primaryPath,
                memo: serializedCaption,
              }
            : item
        )
      );

      if (activeItem?.type === "photobook" && activeItem.id === photoBookId) {
        setActivePreviewPhotoUrl(nextUrl);
      }

      setPhotoAlbumViewer((prev) => {
        if (!prev || prev.photoBookId !== photoBookId) return prev;
        const nextUrls = [...prev.urls];
        if (imageIndex < nextUrls.length) nextUrls[imageIndex] = nextUrl;
        else nextUrls.push(nextUrl);
        return { ...prev, urls: nextUrls };
      });

      setOriginalImageUrl(nextUrl);
      setPhotoResizePreviewUrl("");
      setPhotoCropMode(false);
      setPhotoResizeInfo(`저장 완료 · ${undoLabel}`);
      alert(`${undoLabel}을(를) 완료하고 같은 포토북에 다시 저장했습니다.`);
      await refreshAllInfoData();
    } catch (error) {
      console.error(error);
      alert(`${undoLabel} 저장에 실패했습니다.`);
    } finally {
      setPhotoResizeBusy(false);
    }
  }

  async function resizeAndResavePhotoBookImage() {
    if (!originalImageTarget || originalImageTarget.type !== "photobook-resize") return;
    setPhotoResizeBusy(true);
    try {
      const source = await loadSourceDataUrl(originalImageUrl);
      const resizedDataUrl = photoResizePreviewUrl || await makeImageDataUrl(source, photoResizeMaxSide, 0.85, true);
      await replacePhotoBookImageWithDataUrl(resizedDataUrl, "크기 변경");
    } catch (error) {
      console.error(error);
      alert("포토북 사진 크기 변경 저장에 실패했습니다.");
      setPhotoResizeBusy(false);
    }
  }

  async function cropAndResavePhotoBookImage() {
    if (!originalImageTarget || originalImageTarget.type !== "photobook-resize") return;
    setPhotoResizeBusy(true);
    try {
      const croppedDataUrl = await buildCroppedPhotoDataUrl();
      const previewImage = await loadImage(croppedDataUrl);
      setPhotoResizePreviewUrl(croppedDataUrl);
      setPhotoResizeInfo(`잘라내기 ${previewImage.width}×${previewImage.height}`);
      await replacePhotoBookImageWithDataUrl(croppedDataUrl, "잘라내기");
    } catch (error) {
      console.error(error);
      alert("포토북 사진 잘라내기 저장에 실패했습니다.");
      setPhotoResizeBusy(false);
    }
  }

  async function deleteOriginalDiaryPhoto() {
    if (!originalImageTarget || originalImageTarget.type !== "diary") return;
    const itemNumber = originalImageTarget.index + 1;
    if (!window.confirm(`${itemNumber}번째 사진을 삭제할까요?`)) return;
    await deletePhoto(originalImageTarget.photoKey, originalImageTarget.index);
    closeOriginalImage();
  }


  function getDiaryPhotoIndexFromUser(k: string, actionName: string) {
    const items = photos[k] || [];
    if (!items.length) {
      alert("선택할 사진이 없습니다.");
      return null;
    }

    const input = window.prompt(`${actionName}할 사진 번호를 입력하세요. (1~${items.length})`);
    if (!input) return null;

    const index = Number(input.trim()) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= items.length) {
      alert("사진 번호가 올바르지 않습니다.");
      return null;
    }

    return index;
  }

  async function attachDiaryPhotoToCalendar(k: string) {
    const index = getDiaryPhotoIndexFromUser(k, "캘린더에 붙이기");
    if (index === null) return;
    await setCalendarPhoto(k, index);
  }

  async function deleteDiaryPhotoBySelect(k: string) {
    const index = getDiaryPhotoIndexFromUser(k, "삭제");
    if (index === null) return;
    if (!window.confirm(`${index + 1}번 사진을 삭제할까요?`)) return;
    await deletePhoto(k, index);
  }

  async function pastePhotoFromClipboard() {
    try {
      const clipboard = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };
      if (!clipboard.read) {
        alert("이 브라우저에서는 이미지 붙여넣기를 지원하지 않습니다. 사진 가져오기를 사용해 주세요.");
        return;
      }

      const clipboardItems = await clipboard.read();
      const files: File[] = [];

      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        files.push(new File([blob], `pasted_${Date.now()}.png`, { type: imageType }));
      }

      if (!files.length) {
        alert("클립보드에 이미지 데이터가 없습니다. Safari에서 이미지를 복사한 경우, 아래 붙여넣기 영역을 길게 눌러 붙여넣기를 선택해 주세요.");
        return;
      }

      await savePhotoFiles(files);
    } catch {
      alert("아이폰 Safari에서는 이미지 붙여넣기가 제한될 수 있습니다. 복사한 이미지가 붙지 않으면 사진 가져오기를 사용해 주세요.");
    }
  }

  function getSupportedAudioMimeType() {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
    const candidates = [
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
      "audio/mpeg",
      "audio/aac",
      "audio/webm;codecs=opus",
      "audio/webm",
    ];
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) || "";
  }

  function getAudioExtension(type: string) {
    const lowered = type.toLowerCase();
    if (lowered.includes("mpeg") || lowered.includes("mp3")) return "mp3";
    if (lowered.includes("mp4") || lowered.includes("m4a") || lowered.includes("aac")) return "m4a";
    if (lowered.includes("webm")) return "webm";
    return "m4a";
  }

  function normalizeAudioFileName(file: File) {
    const extension = getAudioExtension(file.type || file.name);
    const originalName = file.name || `diary_voice_${pad(currentMonth)}_${pad(currentDay)}.${extension}`;
    const hasSupportedExtension = /\.(m4a|mp3|mp4|aac|webm)$/i.test(originalName);
    return hasSupportedExtension ? originalName : `diary_voice_${pad(currentMonth)}_${pad(currentDay)}.${extension}`;
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      alert("현재 브라우저에서는 웹앱 직접 녹음이 지원되지 않습니다. 아이폰의 음성메모 앱으로 녹음한 뒤 '음성파일 가져오기'를 사용해 주세요.");
      setVoiceStatus("직접 녹음 미지원 - 음성파일 가져오기 사용");
      return;
    }

    const currentRecorder = mediaRecorderRef.current;
    if (currentRecorder && currentRecorder.state === "recording") {
      setVoiceStatus("이미 녹음 중...");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl("");
      setLastAudioFile(null);
      setVoiceStatus("녹음 중...");

      const mimeType = getSupportedAudioMimeType();
      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onerror = () => {
        stream.getTracks().forEach(track => track.stop());
        setVoiceStatus("녹음 오류 - 음성파일 가져오기 권장");
        alert("아이폰 Safari에서 직접 녹음 오류가 발생했습니다. 음성메모 앱으로 녹음한 뒤 '음성파일 가져오기'를 사용해 주세요.");
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());

        if (!audioChunksRef.current.length) {
          setVoiceStatus("녹음 데이터 없음 - 다시 시도");
          return;
        }

        const finalType = mediaRecorder.mimeType || mimeType || "audio/mp4";
        const blob = new Blob(audioChunksRef.current, { type: finalType });
        const ext = getAudioExtension(finalType);
        const file = new File([blob], `diary_voice_${pad(currentMonth)}_${pad(currentDay)}.${ext}`, { type: finalType });
        setLastAudioFile(file);
        setAudioUrl(URL.createObjectURL(blob));
        setVoiceStatus(`${tag(currentMonth, currentDay)} 녹음 완료`);
      };

      mediaRecorder.start(1000);
    } catch (error) {
      const message = error instanceof Error ? error.name : "UnknownError";
      alert(`마이크 권한 또는 브라우저 녹음 오류입니다. (${message})
아이폰 설정에서 Safari 마이크 권한을 확인하거나, 음성메모 앱으로 녹음 후 '음성파일 가져오기'를 사용해 주세요.`);
      setVoiceStatus("마이크 권한/녹음 오류");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setVoiceStatus(lastAudioFile ? "녹음 완료" : "녹음 중 아님");
      return;
    }

    try {
      if (recorder.state === "recording") recorder.requestData();
      recorder.stop();
      setVoiceStatus("녹음 정리 중...");
    } catch {
      setVoiceStatus("녹음 정지 오류");
    }
  }

  function importVoiceFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const supportedAudio = /\.(m4a|mp3|mp4|aac|webm)$/i.test(file.name) || ["audio/mp4", "audio/x-m4a", "audio/mpeg", "audio/mp3", "audio/aac", "audio/webm"].includes(file.type);
    if (!supportedAudio) {
      alert("m4a, mp3 형식의 음성파일을 권장합니다. 이 파일은 일부 기기에서 재생되지 않을 수 있습니다.");
    }

    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const normalizedFile = new File([file], normalizeAudioFileName(file), { type: file.type || "audio/mp4" });
    const url = URL.createObjectURL(normalizedFile);
    setLastAudioFile(normalizedFile);
    setAudioUrl(url);
    setVoiceStatus(`${tag(currentMonth, currentDay)} ${normalizedFile.name} 가져옴`);
    event.target.value = "";
  }

  function saveVoiceMemoFile() {
    if (!lastAudioFile) {
      alert("저장할 음성 파일이 없습니다. 먼저 녹음하거나 음성파일을 가져와 주세요.");
      return;
    }

    const url = URL.createObjectURL(lastAudioFile);
    const link = document.createElement("a");
    link.href = url;
    link.download = normalizeAudioFileName(lastAudioFile);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setVoiceStatus("음성 파일 저장 실행");
  }

  function deleteVoiceMemo() {
    if (!audioUrl && !lastAudioFile) {
      alert("삭제할 녹음 파일이 없습니다.");
      return;
    }

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl("");
    setLastAudioFile(null);
    audioChunksRef.current = [];
    setVoiceStatus("녹음 파일 삭제됨");
  }

  async function shareVoiceMemoToIphoneMemo() {
    if (!lastAudioFile) {
      alert("먼저 음성 메모를 녹음해 주세요.");
      return;
    }

    const memoText = `${tag(currentMonth, currentDay)} 2026. ${pad(currentMonth)}. ${pad(currentDay)} (${getWeekday(currentMonth, currentDay)})\n\n음성 메모 파일을 첨부합니다.\n\n받아쓰기 정리:\n${voiceText || ""}`;
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };

    if (nav.canShare?.({ files: [lastAudioFile] }) && navigator.share) {
      try {
        await navigator.share({ title: `${tag(currentMonth, currentDay)} 음성 메모`, text: memoText, files: [lastAudioFile] });
        setVoiceStatus("공유창 열림 - 메모 선택");
      } catch {
        setVoiceStatus("공유 취소 또는 실패");
      }
      return;
    }

    saveVoiceMemoFile();
    setVoiceStatus("공유 미지원 - 파일 저장 실행");
  }

  function CalendarView() {
    const first = new Date(currentYear, currentMonth - 1, 1).getDay();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(<div key={`empty-${i}`} className="day empty" />);

    for (let day = 1; day <= getDaysInMonth(currentYear, currentMonth); day++) {
      const k = key(currentMonth, day, currentYear);
      const manuallyRed = (redDates[currentMonth] || []).includes(day);
      const redMarked = manuallyRed;
      const isToday = todayDefault.month === currentMonth && todayDefault.day === day && todayDefault.year === currentYear;
      const daySchedules = getVisibleSchedulesForDay(schedules, currentMonth, day, currentYear);
      const dayMarks = calendarMarks[k] || [];
      const isSelected = currentDay === day;
      cells.push(
        <div className={`day ${redMarked ? "holiday-day" : ""} ${isToday ? "today-day" : ""} ${isSelected ? "selected-day" : ""}`} key={k}>
          <button
            type="button"
            className="day-hit"
            onClick={() => openDiary(currentMonth, day)}
            aria-label={`${currentMonth}월 ${day}일 일기장으로 이동`}
          />
          <div className="day-top">
            <span className={`num ${redMarked ? "num-red" : ""} ${isToday ? "today-num" : ""}`}>{day}</span>
            {dayMarks.length > 0 && (
              <div className="calendar-mark-list" aria-label={`${currentMonth}월 ${day}일 표시`}>
                {dayMarks.slice(0, 4).map(mark => (
                  <span
                    key={`${mark.type}-${mark.plus}`}
                    className={`calendar-mark calendar-mark-${calendarMarkClassSuffix(mark.type)}`}
                  >
                    {calendarMarkLabels[mark.type]}{mark.plus ? "+" : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
          {holidays[k] && <div className="holiday holiday-neutral">{holidays[k]}</div>}
          <div className={`thumb ${calendarPhotos[k] ? "" : "empty-thumb"}`}>
            {calendarPhotos[k] ? (
              <button
                type="button"
                className="calendar-thumb-button"
                onClick={(event) => {
                  event.stopPropagation();
                  openCalendarPhotoOriginal(k);
                }}
                aria-label={`${currentMonth}월 ${day}일 대표 사진 원본 보기`}
              >
                <img src={calendarPhotos[k]} alt="캘린더 대표 사진" />
              </button>
            ) : null}
          </div>
          {daySchedules.length > 0 && (
            <div className="schedule-chip-list">
              {daySchedules.slice(0, 3).map(item => (
                <button
                  type="button"
                  className={`schedule-chip schedule-${item.color} schedule-chip-button`}
                  key={`${item.id}-${day}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    openScheduleEditorForItem(item, currentMonth, day);
                  }}
                  aria-label={`${item.title} 일정 수정${item.startTime ? ` (${item.startTime})` : ""}`}
                  title={item.startTime ? `${item.startTime} ${item.title}` : item.title}
                >
                  {item.title || "제목 없음"}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <section>
        <div className="month-tabs">
          {(currentYear === 2026
            ? Array.from({ length: 8 }, (_, i) => i + 5)
            : Array.from({ length: 12 }, (_, i) => i + 1)
          ).map(month => (
            <button
              key={month}
              type="button"
              className={`month-tab ${month === currentMonth ? "active" : ""}`}
              onClick={() => openCalendar(month)}
            >
              {month}월
            </button>
          ))}
        </div>

        <div className="section-title calendar-headline">
          <h1 className="calendar-title-line">
            <span className="main-title">
              <button type="button" className="year-nav-btn" onClick={() => handleYearChange(-1)}>◀</button>
              {currentYear}년 아이폰 캘린더
              <button type="button" className="year-nav-btn" onClick={() => handleYearChange(1)}>▶</button>
            </span>
            <button type="button" className="month-badge month-diary-link" onClick={() => openDiary(currentMonth, currentDay, currentYear)} aria-label="선택 날짜 일기장으로 이동">{currentMonth}월</button>
          </h1>
          <div className="head-actions calendar-top-actions calendar-top-actions-redesign">
            <button type="button" className="pill-btn compact-pill calendar-primary-link" onClick={() => openDatePicker("diary")}>일기장</button>
            <button type="button" className="pill-btn compact-pill calendar-primary-link" onClick={() => openInfo(currentMonth, currentDay, currentYear, "photobook")}>포토</button>
            <button type="button" className="pill-btn compact-pill calendar-primary-link" onClick={() => openInfo(currentMonth, currentDay, currentYear, "generalInfo")}>일반</button>
            <button type="button" className="today-circle calendar-date-shortcut" onClick={openTodayDiary} aria-label="오늘 날짜 일기장으로 이동">{todayDefault.day}</button>
            <button type="button" className="red-plus-btn" onClick={openRedDateInput} aria-label="빨간 날짜 표시">+</button>
            <button type="button" className="mark-btn" onClick={openCalendarMarkInput} aria-label="근무 표시 입력">근무</button>
            <button type="button" className="plus-btn" onClick={() => openSchedule(currentMonth, currentDay)} aria-label="일정 추가">+</button>
            <button type="button" className="undo-btn" onClick={applyUndo} disabled={!undoHistory.length}>↩ 되돌리기</button>
          </div>
        </div>

        <div className="calendar-search-box">
          <div className="calendar-search-row">
            <input
              className="calendar-search-input"
              value={searchKeyword}
              onChange={e => setSearchKeyword(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void searchDiaryAndInfo(); }}
              placeholder="일기장/정보보관소 검색어 입력"
            />
            <button type="button" className="soft-btn" onClick={() => void searchDiaryAndInfo()}>검색</button>
          </div>
          <div className="calendar-search-status">{searchStatus}</div>
          {searchResults.length > 0 && (
            <div className="calendar-search-results">
              {searchResults.map((result, index) => (
                <button
                  type="button"
                  key={`${result.type}-${result.entryDate}-${index}`}
                  className="calendar-search-result"
                  onClick={() => result.type === "diary" ? openDiary(result.month, result.day) : openInfo(result.month, result.day)}
                >
                  <strong>{result.type === "diary" ? "일기장" : "정보보관소"} · {pad(result.month)}/{pad(result.day)}</strong>
                  <span>{result.text.length > 70 ? `${result.text.slice(0, 70)}...` : result.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="calendar">
          {weekdayLabels.map(label => <div key={label} className="weekday">{label}</div>)}
          {cells}
        </div>
      </section>
    );
  }

  function DiaryView() {
    const k = key(currentMonth, currentDay, currentYear);
    const dayPhotos = photos[k] || [];
    const daySchedules = getVisibleSchedulesForDay(schedules, currentMonth, currentDay, currentYear);
    const diaryPhotoCountClass = `count-${Math.min(Math.max(dayPhotos.length, 1), 4)}`;
    return (
      <section>
        <div className="diary-head diary-head-redesign diary-head-final">
          <div className="diary-date-nav-row diary-date-nav-final">
            <button type="button" className="pill-btn date-nav-btn" onClick={() => moveDiaryDate(-1)}>← 이전일</button>
            <h1>{currentYear}. {pad(currentMonth)}. {pad(currentDay)} ({getWeekday(currentMonth, currentDay, currentYear)})</h1>
            <button type="button" className="pill-btn date-nav-btn" onClick={() => moveDiaryDate(1)}>다음일 →</button>
          </div>

          <div className="diary-title-nav-row diary-action-nav-final">
            <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>📅 캘린더</button>
            <button type="button" className="pill-btn" onClick={() => openInfo(currentMonth, currentDay)}>📂 정보 이동</button>
            <button type="button" className="weather-refresh-btn diary-weather-action-btn" onClick={fetchWeatherFromKma}>{weatherSource}</button>
            <button type="button" className="undo-btn" onClick={applyUndo} disabled={!undoHistory.length}>↩ 되돌리기</button>
          </div>
        </div>

        <div className="diary-top-row">
          <div className="weather-line diary-weather-line">
            <span>🏠 집</span>
            <span>{getWeatherIcon(weather)} {weather}</span>
            <span>🌡 {temp}</span>
            <span className="weather-time-inline">🕒 {weatherTime}</span>
          </div>
          <div className="google-schedule-box diary-schedule-box">
            <div className="google-schedule-head">
              <strong>일정</strong>
              <button type="button" className="google-refresh-btn" onClick={() => void loadGoogleSchedulesForDay(currentMonth, currentDay)}>구글 새로고침</button>
              <span>{daySchedules.length + googleSchedules.length}개 일정</span>
            </div>
            {(daySchedules.length > 0 || googleSchedules.length > 0) ? (
              <div className="google-schedule-list">
                {daySchedules.map(item => (
                  <div className="google-schedule-item app-schedule-item" key={item.id}>
                    <span className="google-schedule-time">{item.startTime || "08:00"}~{item.endTime || "24:00"}</span>
                    <span className="google-schedule-title">입력 · {item.title}</span>
                  </div>
                ))}
                {googleSchedules.map((item, index) => (
                  <div className="google-schedule-item" key={`${item.title}-${index}`}>
                    <span className="google-schedule-time">{item.allDay ? "종일" : item.start || "시간 없음"}</span>
                    <span className="google-schedule-title">구글 · {item.title}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="google-schedule-empty">저장된 일정이 없습니다.</div>
            )}
          </div>
          <div className="diary-photo-button-group">
            <div className="button-row diary-photo-import-row diary-photo-row-primary">
              <label className="soft-btn compact-photo-btn">
                📷 사진찍기
                <input className="hidden-input" type="file" accept=".heic,.heif,.jpg,.jpeg,.png,image/heic,image/heif,image/jpeg,image/png" capture="environment" multiple onChange={addPhotos} />
              </label>
              <label className="soft-btn compact-photo-btn">
                🖼 사진 가져오기
                <input className="hidden-input" type="file" accept=".heic,.heif,.jpg,.jpeg,.png,image/heic,image/heif,image/jpeg,image/png" multiple onChange={addPhotos} />
              </label>
              <button type="button" className="soft-btn compact-photo-btn" onClick={pastePhotoFromClipboard}>📋 웹/캡처 붙여넣기</button>
            </div>
            <div className="button-row diary-photo-import-row diary-photo-row-secondary">
              <button type="button" className="soft-btn compact-photo-btn" onClick={() => attachDiaryPhotoToCalendar(k)}>캘린더 붙이기</button>
              <button type="button" className="soft-btn compact-photo-btn delete-btn" onClick={() => deleteDiaryPhotoBySelect(k)}>삭제</button>
              <button type="button" className="soft-btn compact-photo-btn" onClick={pasteCopiedTextToDiary}>복사한 글 붙이기</button>
            </div>
          </div>
        </div>
        {/* ── Text 입력 / 편집 (일반정보저장함과 동일한 Rich Text 편집기) ── */}
        <div className="generalInfoTextBox generalInfoRichTextBox" style={{ margin: "10px 0" }}>
          <div className="generalInfoRichTextHeader">
            <strong>Text 입력 / 편집</strong>
            <span>줄바꿈, 띄어쓰기, 글자색, 굵게, 밑줄 편집 가능 · 문자 끝에 S를 붙이면 이미지 붙여넣기</span>
          </div>
          <div className="generalInfoRichToolbar" aria-label="Text 편집 도구">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleDiaryRichCommand("bold")}>B 굵게</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleDiaryRichCommand("underline")}>U 밑줄</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handleDiaryRichCommand("removeFormat")}>서식 지우기</button>
            <button type="button" className="generalInfoRichColorDefault" onMouseDown={(e) => e.preventDefault()} onClick={() => handleDiaryRichCommand("foreColor", "#e2e8f0")}>● 기본</button>
            <button type="button" className="generalInfoRichColorRed" onMouseDown={(e) => e.preventDefault()} onClick={() => handleDiaryRichCommand("foreColor", "#f87171")}>● 빨강</button>
            <button type="button" className="generalInfoRichColorYellow" onMouseDown={(e) => e.preventDefault()} onClick={() => handleDiaryRichCommand("foreColor", "#facc15")}>● 노랑</button>
            <button type="button" className="generalInfoRichColorBlue" onMouseDown={(e) => e.preventDefault()} onClick={() => handleDiaryRichCommand("foreColor", "#60a5fa")}>● 파랑</button>
            <button type="button" className="generalInfoRichColorGreen" onMouseDown={(e) => e.preventDefault()} onClick={() => handleDiaryRichCommand("foreColor", "#4ade80")}>● 초록</button>
          </div>
          <div
            key={`diary-rich-${currentYear}-${currentMonth}-${currentDay}`}
            ref={(el) => {
              diaryRichTextRef.current = el;
              if (el && el.innerHTML === "") el.innerHTML = diaryText || "";
            }}
            className="generalInfoRichTextEditor"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            tabIndex={0}
            data-placeholder="오늘의 기록을 남겨보세요...."
            onInput={() => {
              const html = diaryRichTextRef.current?.innerHTML || "";
              saveDiary(html, voiceText);
              checkDiaryTextImageTrigger();
            }}
            onKeyUp={checkDiaryTextImageTrigger}
            onBlur={() => {
              const html = diaryRichTextRef.current?.innerHTML || "";
              saveDiary(html, voiceText);
              checkDiaryTextImageTrigger();
            }}
            onPaste={(e) => {
              const items = Array.from(e.clipboardData?.items || []);
              const imageFiles = items
                .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file));
              if (imageFiles.length > 0 && showDiaryTextImageInsert) {
                e.preventDefault();
                insertDiaryImageFilesFromTextTrigger(imageFiles);
                return;
              }
              e.preventDefault();
              const pastedText = e.clipboardData.getData("text/plain");
              if (pastedText) document.execCommand("insertText", false, pastedText);
              requestAnimationFrame(checkDiaryTextImageTrigger);
            }}
            style={{
              display: "block",
              width: "100%",
              minHeight: 220,
              maxHeight: 520,
              overflowY: "auto",
              boxSizing: "border-box",
              borderRadius: 14,
              border: "1px solid rgba(56, 189, 248, 0.45)",
              background: "#020617",
              color: "#e2e8f0",
              padding: "14px 15px",
              fontSize: 15,
              lineHeight: 1.8,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          />

          {showDiaryTextImageInsert && (
            <div className="generalInfoTextImageInsertPanel">
              <div className="generalInfoTextImageInsertHead">
                <strong>이미지 붙여넣기</strong>
                <span>문자 끝 S 감지 · 본문 TEXT 안에 이미지가 들어갑니다</span>
                <button
                  type="button"
                  className="secondaryButton smallActionButton"
                  onClick={() => {
                    removeDiaryTrailingImageTrigger();
                    setShowDiaryTextImageInsert(false);
                  }}
                >
                  닫기
                </button>
              </div>
              <div className="generalInfoTextImageInsertActions">
                <label className="primaryLabel generalInfoTextImageFileLabel soft-btn compact-photo-btn" style={{ margin: 0, cursor: "pointer" }}>
                  🖼 사진첩 · 파일 선택
                  <input
                    ref={diaryTextImageFileRef}
                    className="hidden-input"
                    type="file"
                    accept=".heic,.heif,.jpg,.jpeg,.png,image/heic,image/heif,image/jpeg,image/png,image/*"
                    multiple
                    onChange={(e) => {
                      insertDiaryImageFilesFromTextTrigger(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <div
                  className="generalInfoTextImagePasteZone"
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  tabIndex={0}
                  onPaste={handleDiaryTextImageInsertPaste}
                >
                  📋 아이폰·PC 이미지 여기 붙여넣기 (Ctrl+V / ⌘V)
                </div>
              </div>
            </div>
          )}

          <p className="generalInfoRichTextNote">
            문장 끝에 <strong>S</strong>를 붙이면 이미지 붙여넣기(사진첩·복사 붙여넣기·파일 선택)가 열리고, 선택한 사진은 본문 TEXT 안에 들어갑니다.
          </p>
        </div>
        <HyperlinkPreview text={diaryText} />

        <div className="diary-photo-section" onPaste={handlePhotoPaste} tabIndex={0}>
          {dayPhotos.length === 0 && <div className="empty-photo diary-empty-photo">사진을 찍거나 가져오면 여기에 저장됩니다.<br />아이폰에서 붙여넣기가 안 되면 사진 가져오기를 사용하세요.</div>}
          <div className={`diary-photo-grid-safe diary-photo-gallery ${diaryPhotoCountClass}`}>
            {dayPhotos.map((photo, index) => {
              const isRepPhoto = calendarPhotoIndexes[k] === index || 
                (calendarPhotos[k] && (calendarPhotos[k] === photo.url || calendarPhotos[k] === photo.storagePath));
              return (
                <div
                  className={`diary-photo-card-safe diary-gallery-photo diary-photo-item-with-delete ${isRepPhoto ? "diary-photo-representative" : ""}`}
                  key={`${photo.name}-${index}`}
                  style={{ position: "relative" }}
                >
                  <button
                    type="button"
                    className="diary-photo-open-btn"
                    onClick={() => openDiaryOriginalPhoto(k, index)}
                    aria-label="일기 사진 원본 크게 보기"
                  >
                    <img src={photo.url} alt={`일기 사진 ${index + 1}`} />
                  </button>
                  {isRepPhoto ? (
                    <span className="diary-photo-rep-badge">★ 대표 사진</span>
                  ) : (
                    <button
                      type="button"
                      className="diary-photo-set-rep-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void setCalendarPhoto(k, index);
                      }}
                      title="캘린더 대표 사진으로 설정"
                    >
                      ★ 대표로 설정
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="box voice-box">
          <div className="box-head compact-box-head voice-head-safe">
            <h3>음성 메모 / 받아쓰기</h3>
            <div className="button-row voice-main-actions">
              <button type="button" className="soft-btn" onClick={startRecording}>🎙 녹음 시작</button>
              <button type="button" className="soft-btn" onClick={stopRecording}>⏹ 녹음 정지</button>
              <button type="button" className="soft-btn delete-btn" onClick={deleteVoiceMemo}>🗑 녹음 삭제</button>
              <button type="button" className="soft-btn" onClick={saveVoiceMemoFile}>💾 파일 저장</button>
              <button type="button" className="soft-btn" onClick={shareVoiceMemoToIphoneMemo}>📝 아이폰 메모로 보내기</button>
              <label className="soft-btn">
                🎧 음성파일 가져오기
                <input className="hidden-input" type="file" accept="audio/m4a,audio/mp4,audio/mpeg,audio/mp3,.m4a,.mp3,.mp4,.aac,.webm" onChange={importVoiceFile} />
              </label>
              <span className="voice-status">{voiceStatus}</span>
            </div>
          </div>
          {audioUrl && <audio src={audioUrl} controls style={{ width: "100%", marginTop: 12 }} />}
          <textarea value={voiceText} onFocus={e => focusDiaryTextarea(e.currentTarget)} onChange={e => saveDiary(diaryText, e.target.value)} style={{ minHeight: 140, marginTop: 12 }} placeholder="음성 받아쓰기 또는 녹음 내용을 정리해 보세요." />
        </div>
      </section>
    );
  }

  function ScheduleView() {
    const k = key(currentMonth, currentDay, currentYear);
    const daySchedules = schedules[k] || [];

    return (
      <section>
        <div className="schedule-page box">
          <div className="schedule-head">
            <h2>+ 일정 기록 ({currentYear}.{pad(currentMonth)}.{pad(currentDay)})</h2>
            <div className="head-actions schedule-actions">
              <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>📅 캘린더</button>
              <button type="button" className="pill-btn" onClick={() => openDiary(currentMonth, currentDay)}>✍️ 일기</button>
            </div>
          </div>

          <div className="schedule-form">
            <label>
              <span>제목</span>
              <input value={scheduleTitle} onChange={e => setScheduleTitle(e.target.value)} placeholder="일정 제목" />
            </label>
            <label>
              <span>시작일</span>
              <input type="date" value={scheduleStartDate} onChange={e => setScheduleStartDate(e.target.value)} />
            </label>
            <label>
              <span>시작시간</span>
              <input type="time" value={scheduleStartTime} onChange={e => setScheduleStartTime(e.target.value)} />
            </label>
            <label>
              <span>종료일</span>
              <input type="date" value={scheduleEndDate} onChange={e => setScheduleEndDate(e.target.value)} />
            </label>
            <label>
              <span>종료시간</span>
              <input
                type="text"
                value={scheduleEndTime}
                onChange={e => setScheduleEndTime(e.target.value)}
                placeholder="24:00"
                inputMode="numeric"
              />
            </label>
            <label>
              <span>반복</span>
              <select value={scheduleRepeat} onChange={e => setScheduleRepeat(e.target.value)}>
                <option>없음</option>
                <option>매일</option>
                <option>매주</option>
                <option>매월</option>
                <option>매년</option>
              </select>
            </label>
          </div>

          <div className="color-picker">
            <span>색깔 선택</span>
            <div className="color-options">
              {(Object.keys(scheduleColorLabels) as ScheduleColor[]).map(color => (
                <button
                  type="button"
                  key={color}
                  className={`color-option schedule-${color} ${scheduleColor === color ? "active" : ""}`}
                  onClick={() => setScheduleColor(color)}
                >
                  {scheduleColorLabels[color]}
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="save-schedule-btn" onClick={addSchedule}>
            {editingScheduleId ? "일정 수정 저장" : "일정 저장"}
          </button>
          {editingScheduleId && (
            <button type="button" className="cancel-schedule-edit-btn" onClick={cancelScheduleEdit}>
              수정 취소
            </button>
          )}

          <div className="saved-schedules">
            <h3>저장된 일정</h3>
            {daySchedules.length === 0 && <p className="muted">아직 저장된 일정이 없습니다.</p>}
            {daySchedules.map(item => (
              <div className={`saved-schedule schedule-${item.color}`} key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>시작일 {item.startDate || "미지정"} · {item.startTime || "08:00"} ~ {item.endTime || "24:00"} · 종료일 {item.endDate || "미지정"} · 반복 {item.repeat}</span>
                </div>
                <div className="saved-schedule-actions">
                  <button type="button" onClick={() => editSchedule(item)}>수정</button>
                  <button type="button" onClick={() => deleteSchedule(item.id)}>삭제</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

function MarkDateView() {
    const monthMarkEntries = Object.entries(calendarMarks)
      .filter(([markKey]) => markKey.startsWith(`${currentMonth}-`))
      .flatMap(([markKey, items]) => {
        const day = Number(markKey.split("-")[1]);
        return items.map(item => ({ day, item }));
      })
      .sort((a, b) => a.day - b.day || a.item.type.localeCompare(b.item.type));

    return (
      <section>
        <div className="box mark-date-page">
          <div className="schedule-head">
            <h2>근무/표시 입력 ({currentMonth}월)</h2>
            <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>📅 캘린더</button>
          </div>

          <div className="mark-type-options">
            {(Object.keys(calendarMarkLabels) as CalendarMarkType[]).map(type => (
              <button
                type="button"
                key={type}
                className={`mark-type-btn mark-type-${calendarMarkClassSuffix(type)} ${markType === type ? "active" : ""}`}
                onClick={() => {
                  setMarkType(type);
                  if (type === "노조") setMarkPlus(false);
                }}
              >
                {calendarMarkLabels[type]}
              </button>
            ))}
          </div>

          <label className="mark-plus-option">
            <input
              type="checkbox"
              checked={markPlus && markType !== "노조"}
              onChange={event => setMarkPlus(event.target.checked)}
              disabled={markType === "노조"}
            />
            <span>+ 표시 추가 {markType === "노조" ? "(노조는 + 제외)" : `→ ${markType}+`}</span>
          </label>

          <p className="muted">날짜를 쉼표로 여러 개 입력하세요. 예: 1, 3, 15</p>
          <input
            className="red-date-input"
            value={markDateInput}
            onChange={event => setMarkDateInput(event.target.value)}
            placeholder="예: 1, 3, 15"
            inputMode="text"
            autoComplete="off"
          />

          <button type="button" className="save-schedule-btn" onClick={addCalendarMarks}>
            {markType}{markType !== "노조" && markPlus ? "+" : ""} 표시 저장
          </button>

          <div className="saved-marks">
            <h3>이번 달 저장 표시</h3>
            {monthMarkEntries.length === 0 && <p className="muted">아직 저장된 표시가 없습니다.</p>}
            {monthMarkEntries.map(({ day, item }) => (
              <div className="saved-mark-row" key={`${day}-${item.type}-${item.plus}`}>
                <span>{currentMonth}/{day}</span>
                <span className={`calendar-mark calendar-mark-${calendarMarkClassSuffix(item.type)}`}>
                  {calendarMarkLabels[item.type]}{item.plus ? "+" : ""}
                </span>
                <button type="button" className="soft-btn delete-btn" onClick={() => deleteCalendarMark(currentMonth, day, item)}>삭제</button>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
  function RedDateView() {
    return (
      <section>
        <div className="box red-date-page">
          <div className="schedule-head">
            <h2>빨간 날짜 표시 ({currentMonth}월)</h2>
            <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>📅 캘린더</button>
          </div>
          <p className="muted">빨간색으로 표시할 날짜를 쉼표로 여러 개 입력하세요. 예: 6, 25, 30</p>
          <input
            className="red-date-input"
            value={redDateInput}
            onChange={e => setRedDateInput(e.target.value)}
            placeholder="예: 6, 25"
            inputMode="text"
            autoComplete="off"
          />
          <button type="button" className="save-schedule-btn" onClick={saveRedDateInput}>빨간 날짜 저장</button>
        </div>
      </section>
    );
  }

  // Load all Instagram Info cards from Supabase (all dates)
  async function loadAllInfoTextCardsFromSupabase() {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from("info_text_cards")
      .select("card_id, content, entry_date, created_at, sort_order")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Supabase all info text card load error:", error.message);
      return [];
    }
    return (data || []).map((row: any) => ({
      id: String(row.card_id || row.id || `${Date.now()}`),
      content: String(row.content || ""),
      createdAt: row.created_at || new Date().toISOString(),
      entryDate: row.entry_date
    }));
  }

  // Load all Photo Book items from Supabase (all dates)
  async function loadAllInfoPhotosFromSupabase() {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from("info_photos")
      .select("id, storage_path, public_url, caption, entry_date, sort_order, created_at")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Supabase all info photo load error:", error.message);
      return [];
    }
    return (data || []).filter(row => !String(row.storage_path || "").includes("general-info/")).map(row => ({
      id: String(row.id || ""),
      url: row.public_url || "",
      name: row.storage_path?.split("/").pop() || "photo.jpg",
      tag: row.entry_date, // entry_date
      extraTag: "",
      memo: row.caption || "",
      size: "360",
      memoWidth: "360",
      memoHeight: "110",
      storagePath: row.storage_path,
    }));
  }

  // Synchronize and refresh all global notes catalog
  async function refreshAllInfoData() {
    let localCards: InstaInfoCard[] = [];
    let localPhotos: PhotoItem[] = [];
    const groupedCards: Record<string, InfoTextCard[]> = {};
    const groupedPhotos: Record<string, PhotoItem[]> = {};

    try {
      const parsedCards: InstaInfoCard[] = [];
      const parsedPhotos: PhotoItem[] = [];
      const cardRegex = /^iphone-diary-(\d{4})-infoTextCards[-_](\d{2})-(\d{2})$/;
      const photoRegex = /^iphone-diary-(\d{4})-infoPhotos[-_](\d{2})-(\d{2})$/;

      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || "";
        const cardMatch = k.match(cardRegex);
        if (cardMatch) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const list = JSON.parse(raw) as InfoTextCard[];
            const y = Number(cardMatch[1]);
            const m = Number(cardMatch[2]);
            const d = Number(cardMatch[3]);
            const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            list.forEach(c => {
              parsedCards.push(parseInstaCardContent(c.content, c.id, dateStr, c.createdAt || new Date().toISOString()));
            });
            const kStr = key(m, d, y);
            groupedCards[kStr] = list;
          }
        }
        const photoMatch = k.match(photoRegex);
        if (photoMatch) {
          const raw = localStorage.getItem(k);
          if (raw) {
            const list = JSON.parse(raw) as PhotoItem[];
            const y = Number(photoMatch[1]);
            const m = Number(photoMatch[2]);
            const d = Number(photoMatch[3]);
            const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            list.forEach(p => {
              p.tag = dateStr;
            });
            parsedPhotos.push(...list);
            const kStr = key(m, d, y);
            groupedPhotos[kStr] = list;
          }
        }
      }
      localCards = parsedCards;
      localPhotos = parsedPhotos;
    } catch (e) {
      console.warn("Failed to load local info", e);
    }

    if (isSupabaseConfigured && supabase) {
      const [remoteCards, remotePhotos] = await Promise.all([
        loadAllInfoTextCardsFromSupabase(),
        loadAllInfoPhotosFromSupabase()
      ]);
      
      const parsedRemoteCards = remoteCards.map(c => 
        parseInstaCardContent(c.content, c.id, c.entryDate, c.createdAt)
      );

      setAllInstaCards(parsedRemoteCards);
      setAllPhotoBookItems(remotePhotos);
      
      const remoteGroupedCards: Record<string, InfoTextCard[]> = {};
      const remoteGroupedPhotos: Record<string, PhotoItem[]> = {};

      remoteCards.forEach(c => {
        const dateParts = c.entryDate.split("-");
        const year = Number(dateParts[0]);
        const month = Number(dateParts[1]);
        const day = Number(dateParts[2]);
        const kStr = key(month, day, year);
        if (!remoteGroupedCards[kStr]) remoteGroupedCards[kStr] = [];
        remoteGroupedCards[kStr].push({ id: c.id, content: c.content, createdAt: c.createdAt });
      });

      remotePhotos.forEach(p => {
        let kStr = p.tag;
        if (kStr.includes("-")) {
          const dateParts = kStr.split("-");
          if (dateParts.length === 3) {
            const year = Number(dateParts[0]);
            const month = Number(dateParts[1]);
            const day = Number(dateParts[2]);
            kStr = key(month, day, year);
          }
        }
        if (!remoteGroupedPhotos[kStr]) remoteGroupedPhotos[kStr] = [];
        remoteGroupedPhotos[kStr].push(p);
      });

      setInfoTextCards(remoteGroupedCards);
      setInfoPhotos(remoteGroupedPhotos);
    } else {
      setAllInstaCards(localCards);
      setAllPhotoBookItems(localPhotos);
      setInfoTextCards(groupedCards);
      setInfoPhotos(groupedPhotos);
    }
  }

  // Helper to load external scripts (html2canvas, jsPDF)
  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.body.appendChild(script);
    });
  }

  // Helper to convert File to base64
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  }

  // Helper to convert Image URL to base64
  async function imageUrlToBase64(url: string): Promise<string> {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn("imageUrlToBase64 failed", e);
      return "";
    }
  }

  // Parse markdown formatting for PDF generation
  function parseMarkdownToHtml(md: string): string {
    if (!md) return "";
    return md
      .replace(/### (.*)/g, '<h4 style="font-size:14px; margin:12px 0 4px 0; color:#111; font-weight:bold;">$1</h4>')
      .replace(/## (.*)/g, '<h3 style="font-size:15px; margin:16px 0 6px 0; color:#111; font-weight:bold; border-bottom:1px solid #eee; padding-bottom:3px;">$1</h3>')
      .replace(/# (.*)/g, '<h2 style="font-size:16px; margin:18px 0 8px 0; color:#111; font-weight:bold;">$1</h2>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^- (.*)/gm, '<li style="margin-left:15px; font-size:13px; color:#333; list-style-type:disc;">$1</li>')
      .replace(/\n/g, '<br />');
  }

  function renderHtmlContent(text: string) {
    if (!text) return "";
    let html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br />');
    return html;
  }

  // Parse Instagram Card content from serialized JSON

  function parseInstaCardContent(content: string, id: string, entryDate: string, createdAt: string): InstaInfoCard {
    if (content.startsWith("{")) {
      try {
        const parsed = JSON.parse(content);
        if (parsed.type === "insta_info" || parsed.category) {
          const legacyUrl = parsed.imageUrl || "";
          const legacyPath = parsed.imageStoragePath || "";
          return {
            id,
            title: parsed.title || "",
            category: parsed.category || "기타",
            keyword: parsed.keyword || "일반",
            entryDate: parsed.entryDate || entryDate,
            imageUrl: legacyUrl,
            imageStoragePath: legacyPath,
            imageUrls: parsed.imageUrls || (legacyUrl ? [legacyUrl] : []),
            imageStoragePaths: parsed.imageStoragePaths || (legacyPath ? [legacyPath] : []),
            originalText: parsed.originalText || parsed.content || "",
            extractedText: parsed.extractedText || "",
            factCheckResult: parsed.factCheckResult || "",
            createdAt
          };
        }
      } catch (e) {}
    }
    // Fallback for legacy text cards
    return {
      id,
      category: "기타",
      keyword: "일반",
      entryDate,
      originalText: content,
      createdAt
    };
  }

  function parsePhotoBookMemo(memo: string): {
    keyword: string;
    category2: string;
    memo: string;
    imageMemos: string[];
    imageExifs?: PhotoBookImageExif[];
    additionalImages?: Array<{url: string; storagePath: string}>;
    isPinned?: boolean;
  } {
    let cleanMemo = memo || "";

    // 2. Check standard JSON structure first, or if it starts with {
    if (cleanMemo.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(cleanMemo);
        if (parsed.type === "photobook" || parsed.keyword || parsed.category2) {
          return {
            keyword: parsed.keyword || "일반",
            category2: parsed.category2 || "기타",
            memo: parsed.memo || "",
            imageMemos: Array.isArray(parsed.imageMemos) ? parsed.imageMemos : [],
            imageExifs: Array.isArray(parsed.imageExifs) ? parsed.imageExifs : [],
            additionalImages: parsed.additionalImages || [],
            isPinned: parsed.isPinned || false
          };
        }
      } catch (e) {}
    }

    // 1. Check if memo contains serialized JSON within hashtag format
    const startIndex = cleanMemo.indexOf('{"type":"photobook"');
    if (startIndex !== -1) {
      for (let i = cleanMemo.length; i > startIndex; i--) {
        const subStr = cleanMemo.substring(startIndex, i);
        if (subStr.endsWith("}")) {
          try {
            const parsed = JSON.parse(subStr);
            return {
              keyword: parsed.keyword || "일반",
              category2: parsed.category2 || "기타",
              memo: parsed.memo || cleanMemo.replace(subStr, "").replace(/^[#\s]+|[#\s]+$/g, ""),
              imageMemos: Array.isArray(parsed.imageMemos) ? parsed.imageMemos : [],
              imageExifs: Array.isArray(parsed.imageExifs) ? parsed.imageExifs : [],
              additionalImages: parsed.additionalImages || []
            };
          } catch (e) {}
        }
      }
    }

    // Fallback for legacy info photos
    let keyword = "일반";
    let category2 = "기타";
    if (cleanMemo.startsWith("#")) {
      const parts = cleanMemo.split("#").filter(Boolean);
      if (parts.length >= 2) {
        keyword = parts[0];
        category2 = parts[1];
        const match = cleanMemo.match(/^#[^\s#]+#[^\s#]+/);
        if (match) {
          cleanMemo = cleanMemo.replace(/^#[^\s#]+#[^\s#]+\s*/, "");
        }
      } else if (parts.length === 1) {
        keyword = parts[0];
        const match = cleanMemo.match(/^#[^\s#]+/);
        if (match) {
          cleanMemo = cleanMemo.replace(/^#[^\s#]+\s*/, "");
        }
      }
    }
    return { keyword, category2, memo: cleanMemo, imageMemos: [], imageExifs: [], additionalImages: [] };
  }

  // API Call: AI OCR & Classification for Image Upload
  async function handleInstaImageUpload(file: File) {
    setInstaLoading(true);
    try {
      const item = await uploadPhotoToSupabase(file, "info-photos", currentMonth, currentDay, 999, currentYear);
      if (item) {
        setInstaInputImageUrl(prev => prev || item.url);
        setInstaInputImageStoragePath(prev => prev || item.storagePath || "");
        setInstaInputImageUrls(prev => [...prev, item.url]);
        setInstaInputImageStoragePaths(prev => [...prev, item.storagePath || ""]);
        
        // Convert to Base64 for OCR
        const base64 = await fileToBase64(file);
        const mimeType = file.type || "image/jpeg";
        
        // Call OCR
        const ocrRes = await fetch("/api/gemini", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-gemini-api-key": geminiApiKey || ""
          },
          body: JSON.stringify({
            action: "ocr",
            imageBase64: base64,
            mimeType
          })
        });
        
        const ocrData = await ocrRes.json();
        if (ocrData.error) {
          console.warn("OCR API Error:", ocrData.error);
          return;
        }
        
        const extracted = ocrData.result || "";
        setInstaInputExtractedText(extracted);
        setInstaInputText(prev => prev ? `${prev}\n${extracted}` : extracted);
        
        if (extracted.trim()) {
          // Auto classify
          await runAIClassification(extracted);
        }
      } else {
        alert("이미지 업로드에 실패했습니다.");
      }
    } catch (e) {
      console.error(e);
      alert("이미지 분석 중 오류가 발생했습니다: " + e);
    } finally {
      setInstaLoading(false);
    }
  }

  // Text formatter helper (B, color red, color yellow)
  function insertFormatting(type: "bold" | "red" | "yellow") {
    const textareaId = editingInstaCardId ? "insta-textarea-edit" : "insta-textarea-create";
    const textarea = document.getElementById(textareaId) as HTMLTextAreaElement | null;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);

    let replacement = "";
    if (type === "bold") {
      replacement = `**${selectedText}**`;
    } else if (type === "red") {
      replacement = `<span style="color:#ff0000">${selectedText}</span>`;
    } else if (type === "yellow") {
      replacement = `<span style="color:#ffff00">${selectedText}</span>`;
    }

    const newText = text.substring(0, start) + replacement + text.substring(end);
    setInstaInputText(newText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + replacement.length, start + replacement.length);
    }, 0);
  }

  // Manual OCR trigger for currently uploaded images
  async function extractTextFromCurrentImages() {
    if (instaInputImageUrls.length === 0) {
      alert("추출할 이미지가 없습니다.");
      return;
    }
    setInstaLoading(true);
    try {
      let combinedText = "";
      for (let i = 0; i < instaInputImageUrls.length; i++) {
        const url = instaInputImageUrls[i];
        const base64 = await imageUrlToBase64(url);
        if (!base64) continue;
        
        const res = await fetch("/api/gemini", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-gemini-api-key": geminiApiKey || ""
          },
          body: JSON.stringify({
            action: "ocr",
            imageBase64: base64,
            mimeType: "image/jpeg"
          })
        });
        
        const data = await res.json();
        if (data.result) {
          combinedText += (combinedText ? "\n" : "") + data.result;
        }
      }
      
      if (combinedText.trim()) {
        setInstaInputExtractedText(combinedText);
        setInstaInputText(prev => prev ? `${prev}\n${combinedText}` : combinedText);
        alert("이미지에서 텍스트가 정상 추출되어 본문에 추가되었습니다.");
        await runAIClassification(combinedText);
      } else {
        alert("이미지에서 텍스트를 추출할 수 없었습니다.");
      }
    } catch (error) {
      console.error(error);
      alert("텍스트 추출 중 에러가 발생했습니다: " + error);
    } finally {
      setInstaLoading(false);
    }
  }

  // API Call: Auto Classify Text
  async function runAIClassification(text: string) {
    if (!text.trim()) return;
    setInstaLoading(true);
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-api-key": geminiApiKey || ""
        },
        body: JSON.stringify({
          action: "classify",
          text
        })
      });
      const data = await res.json();
      if (data.error) {
        console.warn("Classification API Error:", data.error);
        return;
      }
      
      try {
        const parsed = JSON.parse(data.result);
        if (parsed.category) setInstaInputCategory(parsed.category);
        if (parsed.keyword) setInstaInputKeyword(parsed.keyword);
        if (parsed.title) setInstaInputTitle(parsed.title);
      } catch (e) {
        console.warn("Failed to parse classification JSON:", data.result, e);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setInstaLoading(false);
    }
  }

  // API Call: Fact Check
  async function performFactCheck(cardId: string) {
    const cardKey = key(currentMonth, currentDay, currentYear);
    const previousCards = infoTextCards[cardKey] || [];
    const cardRow = previousCards.find(c => c.id === cardId);
    if (!cardRow) return;
    
    const card = parseInstaCardContent(cardRow.content, cardRow.id, entryDate(currentMonth, currentDay, currentYear), cardRow.createdAt);
    
    setInstaLoading(true);
    try {
      let imageBase64 = "";
      if (card.imageUrl) {
        imageBase64 = await imageUrlToBase64(card.imageUrl);
      }
      
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-api-key": geminiApiKey || ""
        },
        body: JSON.stringify({
          action: "fact-check",
          text: card.originalText,
          imageBase64: imageBase64 || undefined
        })
      });
      
      const data = await res.json();
      if (data.error) {
        alert("팩트체크 실패: " + data.error);
        return;
      }
      
      const factCheckResult = data.result || "";
      
      const nextCards = previousCards.map(c => {
        if (c.id === cardId) {
          const parsed = JSON.parse(c.content);
          parsed.factCheckResult = factCheckResult;
          return { ...c, content: JSON.stringify(parsed) };
        }
        return c;
      });
      
      saveInfoTextCards(currentMonth, currentDay, nextCards);
    } catch (e) {
      console.error(e);
      alert("팩트체크 수행 중 오류 발생: " + e);
    } finally {
      setInstaLoading(false);
    }
  }

  // PDF Export
  async function downloadFactCheckPDF(card: InstaInfoCard) {
    try {
      setInstaLoading(true);
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");

      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.top = "-9999px";
      container.style.left = "-9999px";
      container.style.width = "794px";
      container.style.padding = "50px";
      container.style.background = "#ffffff";
      container.style.color = "#333333";
      container.style.fontFamily = "Apple SD Gothic Neo, Malgun Gothic, sans-serif";
      container.style.boxSizing = "border-box";

      container.innerHTML = `
        <div style="border-bottom: 3px solid #333; padding-bottom: 20px; margin-bottom: 25px;">
          <h1 style="font-size: 26px; margin: 0; color: #111; font-weight: bold; letter-spacing: -0.5px;">🔍 AI Fact Check Report</h1>
          <p style="font-size: 13px; color: #666; margin: 8px 0 0 0;">인스타 주요 정보 검증 리포트 | 작성일자: ${card.entryDate}</p>
        </div>
        
        <div style="margin-bottom: 25px; padding: 18px; background: #f8f9fa; border-left: 5px solid #0070f3; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-size: 13px; font-weight: 600; color: #666; margin-bottom: 6px; text-transform: uppercase;">Index 정보</div>
          <div style="font-size: 18px; font-weight: 700; color: #111;">${card.category} / ${card.keyword} / ${card.entryDate}</div>
        </div>

        ${card.imageUrl ? `
        <div style="margin-bottom: 25px; text-align: center; background: #fafafa; padding: 15px; border-radius: 6px; border: 1px solid #eaeaea;">
          <img src="${card.imageUrl}" style="max-width: 100%; max-height: 280px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" crossorigin="anonymous" />
        </div>
        ` : ""}

        <div style="margin-bottom: 30px;">
          <h2 style="font-size: 17px; border-bottom: 1.5px solid #eaeaea; padding-bottom: 6px; color: #222; font-weight: 700; margin: 0 0 12px 0;">📝 원본 정보 및 수집 본문</h2>
          <p style="font-size: 14px; line-height: 1.6; white-space: pre-wrap; color: #444; margin: 0;">${card.originalText}</p>
        </div>

        <div style="margin-bottom: 30px;">
          <h2 style="font-size: 17px; border-bottom: 1.5px solid #eaeaea; padding-bottom: 6px; color: #222; font-weight: 700; margin: 0 0 12px 0;">🤖 Gemini 팩트체크 판정 결과</h2>
          <div style="font-size: 14px; line-height: 1.6; color: #333;">
            ${parseMarkdownToHtml(card.factCheckResult || "")}
          </div>
        </div>

        <div style="border-top: 1.5px solid #eee; padding-top: 18px; text-align: center; font-size: 11px; color: #999; margin-top: 40px;">
          본 보고서는 Google Gemini AI 모델의 분석 결과를 기초로 작성되었으며 실시간 정보와 차이가 있을 수 있습니다.
        </div>
      `;

      document.body.appendChild(container);
      await new Promise(resolve => setTimeout(resolve, 850));

      const canvas = await (window as any).html2canvas(container, {
        scale: 2.2,
        useCORS: true,
        allowTaint: true,
        logging: false
      });

      document.body.removeChild(container);

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdf = new (window as any).jspdf.jsPDF("p", "mm", "a4");
      const imgWidth = 210;
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`AI_팩트체크_${card.category}_${card.keyword}_${card.entryDate}.pdf`);
    } catch (error) {
      console.error("PDF download error:", error);
      alert("PDF 리포트 생성에 실패했습니다: " + error);
    } finally {
      setInstaLoading(false);
    }
  }

  // CRUD: Save/Update Instagram Card
  // CRUD: Save/Update Instagram Card
  async function saveInstaCard() {
    if (!instaInputText.trim() && !instaInputImageUrl) {
      alert("인스타 글 또는 이미지를 추가해주세요.");
      return;
    }

    const dateStr = instaInputDate || entryDate(currentMonth, currentDay, currentYear);
    const [tYear, tMonth, tDay] = dateStr.split("-").map(Number);
    const targetKey = key(tMonth, tDay, tYear);

    const targetPreviousCards = infoTextCards[targetKey] || [];
    registerUndo({
      label: editingInstaCardId ? "정보보관소 글 카드 수정" : "정보보관소 글 카드 추가",
      target: "infoTextCards",
      year: tYear,
      month: tMonth,
      day: tDay,
      previousData: JSON.stringify(targetPreviousCards),
    });

    let originalCard = allInstaCards.find(c => c.id === editingInstaCardId);
    let originalDate = originalCard ? originalCard.entryDate : dateStr;

    if (editingInstaCardId && originalDate !== dateStr) {
      const [oYear, oMonth, oDay] = originalDate.split("-").map(Number);
      const oldKey = key(oMonth, oDay, oYear);
      const oldPreviousCards = infoTextCards[oldKey] || [];
      const updatedOldCards = oldPreviousCards.filter(c => c.id !== editingInstaCardId);
      saveInfoTextCards(oMonth, oDay, updatedOldCards, oYear);
    }

    let nextCards: InfoTextCard[] = [];
    const content = JSON.stringify({
      type: "insta_info",
      title: instaInputTitle.trim(),
      category: instaInputCategory || "기타",
      keyword: instaInputKeyword.trim() || "일반",
      entryDate: dateStr,
      imageUrl: instaInputImageUrl,
      imageStoragePath: instaInputImageStoragePath,
      imageUrls: instaInputImageUrls,
      imageStoragePaths: instaInputImageStoragePaths,
      originalText: instaInputText.trim(),
      extractedText: instaInputExtractedText,
      factCheckResult: originalCard?.factCheckResult || ""
    });

    if (editingInstaCardId) {
      const destinationCards = infoTextCards[targetKey] || [];
      const exists = destinationCards.some(c => c.id === editingInstaCardId);
      if (exists) {
        nextCards = destinationCards.map(c => c.id === editingInstaCardId ? { ...c, content } : c);
      } else {
        nextCards = [...destinationCards, { id: editingInstaCardId, content, createdAt: originalCard?.createdAt || new Date().toISOString() }];
      }
      setEditingInstaCardId(null);
    } else {
      const destinationCards = infoTextCards[targetKey] || [];
      const newCard: InfoTextCard = {
        id: `insta-${Date.now()}`,
        content,
        createdAt: new Date().toISOString()
      };
      nextCards = [...destinationCards, newCard];
    }

    saveInfoTextCards(tMonth, tDay, nextCards, tYear);

    // Sync global states
    await refreshAllInfoData();

    // Reset Form
    setInstaInputTitle("");
    setInstaInputText("");
    setInstaInputImageUrl("");
    setInstaInputImageStoragePath("");
    setInstaInputImageUrls([]);
    setInstaInputImageStoragePaths([]);
    setInstaInputCategory("기타");
    setInstaInputKeyword("");
    setInstaInputExtractedText("");
    setInstaInputImage(null);
    setInstaInputDate(entryDate(currentMonth, currentDay));
    setActiveItem(null);
  }

  // CRUD: Edit Instagram Card Trigger
  function triggerEditInstaCard(card: InstaInfoCard) {
    setEditingInstaCardId(card.id);
    setInstaInputText(card.originalText);
    setInstaInputImageUrl(card.imageUrl || "");
    setInstaInputImageStoragePath(card.imageStoragePath || "");
    setInstaInputImageUrls(card.imageUrls || (card.imageUrl ? [card.imageUrl] : []));
    setInstaInputImageStoragePaths(card.imageStoragePaths || (card.imageStoragePath ? [card.imageStoragePath] : []));
    setInstaInputCategory(card.category);
    setInstaInputKeyword(card.keyword);
    setInstaInputExtractedText(card.extractedText || "");
    setInstaInputDate(card.entryDate);
    setActiveItem({ type: "insta", id: card.id });
  }

  // CRUD: Cancel Edit Instagram Card
  function cancelEditInstaCard() {
    setEditingInstaCardId(null);
    setInstaInputText("");
    setInstaInputImageUrl("");
    setInstaInputImageStoragePath("");
    setInstaInputImageUrls([]);
    setInstaInputImageStoragePaths([]);
    setInstaInputCategory("기타");
    setInstaInputKeyword("");
    setInstaInputExtractedText("");
    setInstaInputImage(null);
    setInstaInputDate(entryDate(currentMonth, currentDay));
  }

  // CRUD: Delete Instagram Card
  async function deleteInstaCard(cardId: string) {
    const targetCard = allInstaCards.find(c => c.id === cardId);
    if (!targetCard) return;

    if (!window.confirm("이 인스타 정보를 삭제할까요?")) return;

    const [tYear, tMonth, tDay] = targetCard.entryDate.split("-").map(Number);
    const cardKey = key(tMonth, tDay, tYear);
    const previousCards = infoTextCards[cardKey] || [];

    registerUndo({
      label: "정보보관소 글 카드 삭제",
      target: "infoTextCards",
      year: tYear,
      month: tMonth,
      day: tDay,
      previousData: JSON.stringify(previousCards),
    });

    if (targetCard.imageStoragePath) {
      void deleteSupabasePhoto("info-photos", "info_photos", targetCard.imageStoragePath);
    }

    const nextCards = previousCards.filter(c => c.id !== cardId);
    saveInfoTextCards(tMonth, tDay, nextCards, tYear);

    // Sync global states
    await refreshAllInfoData();
    if (activeItem?.id === cardId) {
      setActiveItem(null);
    }
  }

  // CRUD: Save/Update Photo Book Item
  async function savePhotoBookItemForm() {
    if (photoBookInputImageUrls.length === 0) {
      alert("포토북에 업로드할 이미지를 추가해주세요.");
      return;
    }

    const primaryUrl = photoBookInputImageUrls[0] || "";
    const primaryStoragePath = photoBookInputImageStoragePaths[0] || "";

    const additionalImages = photoBookInputImageUrls.slice(1).map((url, i) => ({
      url,
      storagePath: photoBookInputImageStoragePaths[i + 1] || ""
    }));

    const dateStr = photoBookInputDate || entryDate(currentMonth, currentDay, currentYear);
    const [tYear, tMonth, tDay] = dateStr.split("-").map(Number);
    const targetKey = key(tMonth, tDay, tYear);

    const targetPreviousItems = infoPhotos[targetKey] || [];

    registerUndo({
      label: editingPhotoBookItemId ? "정보보관소 사진 수정" : "정보보관소 사진 추가",
      target: "infoPhotos",
      photoKey: targetKey,
      year: tYear,
      previousData: JSON.stringify(targetPreviousItems),
    });

    let originalItem = allPhotoBookItems.find(p => p.id === editingPhotoBookItemId);
    const parsedOriginal = originalItem ? parsePhotoBookMemo(originalItem.memo || "") : null;
    const isPinned = parsedOriginal ? (parsedOriginal.isPinned || false) : false;

    const serializedCaption = JSON.stringify({
      type: "photobook",
      keyword: photoBookInputKeyword.trim() || "일반",
      category2: photoBookInputCategory2.trim() || "기타",
      memo: photoBookInputMemo,
      imageMemos: photoBookInputImageMemos,
      imageExifs: photoBookInputImageExifs,
      additionalImages,
      isPinned
    });

    let originalDate = originalItem ? originalItem.tag : dateStr;
    const originalStoragePath = originalItem?.storagePath || photoBookInputImageStoragePath;

    if (editingPhotoBookItemId && originalDate !== dateStr) {
      const [oYear, oMonth, oDay] = originalDate.split("-").map(Number);
      const oldKey = key(oMonth, oDay, oYear);
      const oldPreviousItems = infoPhotos[oldKey] || [];
      const updatedOldItems = oldPreviousItems.filter(p => p.id !== editingPhotoBookItemId);
      setInfoPhotos(prev => ({ ...prev, [oldKey]: updatedOldItems }));
      saveInfoPhotos(oMonth, oDay, updatedOldItems, oYear);
    }

    let nextPhotosForDay: PhotoItem[] = [];

    if (editingPhotoBookItemId) {
      const destinationItems = infoPhotos[targetKey] || [];
      const exists = destinationItems.some(p => p.id === editingPhotoBookItemId);
      if (exists) {
        nextPhotosForDay = destinationItems.map(item => {
          if (item.id === editingPhotoBookItemId || (item.storagePath && item.storagePath === originalStoragePath)) {
            return { 
              ...item, 
              url: primaryUrl,
              name: primaryStoragePath.split("/").pop() || "photo.jpg",
              storagePath: primaryStoragePath,
              memo: serializedCaption, 
              tag: dateStr,
              isPinned
            };
          }
          return item;
        });
      } else {
        const itemObj: PhotoItem = {
          url: primaryUrl,
          name: primaryStoragePath.split("/").pop() || "photo.jpg",
          tag: dateStr,
          extraTag: "",
          memo: serializedCaption,
          size: "360",
          memoWidth: "360",
          memoHeight: "110",
          storagePath: primaryStoragePath,
          id: editingPhotoBookItemId,
          isPinned
        };
        nextPhotosForDay = [...destinationItems, itemObj];
      }

      if (isSupabaseConfigured && supabase) {
        if (editingPhotoBookItemId.startsWith("temp-")) {
          await supabase.from("info_photos").update({ 
            caption: serializedCaption, 
            entry_date: dateStr,
            public_url: primaryUrl,
            storage_path: primaryStoragePath
          }).eq("storage_path", originalStoragePath);
        } else {
          await supabase.from("info_photos").update({ 
            caption: serializedCaption, 
            entry_date: dateStr,
            public_url: primaryUrl,
            storage_path: primaryStoragePath
          }).eq("id", editingPhotoBookItemId);
        }
      }
      setEditingPhotoBookItemId(null);
    } else {
      const destinationItems = infoPhotos[targetKey] || [];
      const sortOrder = destinationItems.length;
      const uploadedItem: PhotoItem = {
        url: primaryUrl,
        name: primaryStoragePath.split("/").pop() || "photo.jpg",
        tag: dateStr,
        extraTag: "",
        memo: serializedCaption,
        size: "360",
        memoWidth: "360",
        memoHeight: "110",
        storagePath: primaryStoragePath,
        id: `temp-${Date.now()}`
      };

      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase.from("info_photos").insert({
          entry_date: dateStr,
          storage_path: uploadedItem.storagePath,
          public_url: uploadedItem.url,
          caption: serializedCaption,
          sort_order: sortOrder,
        }).select("id").maybeSingle();

        if (data?.id) {
          uploadedItem.id = data.id;
        }
      }
      nextPhotosForDay = [...destinationItems, uploadedItem];
    }

    setInfoPhotos(prev => ({ ...prev, [targetKey]: nextPhotosForDay }));
    saveInfoPhotos(tMonth, tDay, nextPhotosForDay, tYear);

    // Sync global states
    await refreshAllInfoData();

    // Reset Form
    setPhotoBookInputImageUrl("");
    setPhotoBookInputImageStoragePath("");
    setPhotoBookInputImageUrls([]);
    setPhotoBookInputImageStoragePaths([]);
    setPhotoBookInputKeyword("");
    setPhotoBookInputCategory2("");
    setPhotoBookInputMemo("");
    setPhotoBookInputImage(null);
    setPhotoBookInputDate(entryDate(currentMonth, currentDay));
    setPhotoBookInputImageMemos([]);
    setPhotoBookInputImageExifs([]);
    setPbMemoEditIdx(null);
    setActiveItem(null);
    setPhotoBookTab("index");
  }

  function makePhotoBookRepresentative(index: number) {
    if (index <= 0 || index >= photoBookInputImageUrls.length) return;
    const nextUrls = [...photoBookInputImageUrls];
    const nextPaths = [...photoBookInputImageStoragePaths];
    const nextMemos = [...photoBookInputImageMemos];
    const nextExifs = [...photoBookInputImageExifs];
    
    const tempUrl = nextUrls[0];
    nextUrls[0] = nextUrls[index];
    nextUrls[index] = tempUrl;
    
    const tempPath = nextPaths[0];
    nextPaths[0] = nextPaths[index];
    nextPaths[index] = tempPath;
    
    const tempMemo = nextMemos[0];
    nextMemos[0] = nextMemos[index];
    nextMemos[index] = tempMemo;

    const tempExif = nextExifs[0];
    nextExifs[0] = nextExifs[index];
    nextExifs[index] = tempExif;
    
    setPhotoBookInputImageUrls(nextUrls);
    setPhotoBookInputImageStoragePaths(nextPaths);
    setPhotoBookInputImageMemos(nextMemos);
    setPhotoBookInputImageExifs(nextExifs);
    
    setPhotoBookInputImageUrl(nextUrls[0] || "");
    setPhotoBookInputImageStoragePath(nextPaths[0] || "");
  }

  // CRUD: Edit Photo Book Trigger
  async function togglePhotoBookPin(item: PhotoItem) {
    const parsed = parsePhotoBookMemo(item.memo || "");
    const newIsPinned = !parsed.isPinned;
    const newCaption = JSON.stringify({
      type: "photobook",
      keyword: parsed.keyword,
      category2: parsed.category2,
      memo: parsed.memo,
      imageMemos: parsed.imageMemos,
      imageExifs: parsed.imageExifs || [],
      additionalImages: parsed.additionalImages || [],
      isPinned: newIsPinned
    });

    // 로컬 상태 즉시 업데이트
    setAllPhotoBookItems(prev => prev.map(p =>
      p.id === item.id ? { ...p, memo: newCaption, isPinned: newIsPinned } : p
    ));

    // Supabase 동기화
    if (isSupabaseConfigured && supabase && item.id && !item.id.startsWith("temp-")) {
      await supabase.from("info_photos").update({ caption: newCaption }).eq("id", item.id);
    }
  }

  function triggerEditPhotoBook(item: PhotoItem) {
    const parsed = parsePhotoBookMemo(item.memo || "");
    setEditingPhotoBookItemId(item.id || `temp-${Date.now()}`);
    
    const mainUrl = item.url || "";
    const mainStorage = item.storagePath || "";
    const additionalUrls = parsed.additionalImages?.map(img => img.url) || [];
    const additionalStorages = parsed.additionalImages?.map(img => img.storagePath) || [];

    setPhotoBookInputImageUrl(mainUrl);
    setPhotoBookInputImageStoragePath(mainStorage);
    setPhotoBookInputImageUrls(mainUrl ? [mainUrl, ...additionalUrls] : additionalUrls);
    setPhotoBookInputImageStoragePaths(mainStorage ? [mainStorage, ...additionalStorages] : additionalStorages);

    setPhotoBookInputKeyword(parsed.keyword);
    setPhotoBookInputCategory2(parsed.category2);
    setPhotoBookInputMemo(parsed.memo);
    setPhotoBookInputDate(item.tag);
    setPhotoBookInputImageMemos(parsed.imageMemos || []);
    setPhotoBookInputImageExifs(parsed.imageExifs || []);
    setPbMemoEditIdx(null);
    setPhotoBookTab("register");

    // 기존에 좌표만 저장된 EXIF는 장소명으로 변환
    void enrichPhotoBookImageExifs(parsed.imageExifs || []).then((exifs) => {
      setPhotoBookInputImageExifs(exifs);
    });
  }

  // CRUD: Cancel Edit Photo Book
  function cancelEditPhotoBook() {
    setEditingPhotoBookItemId(null);
    setPhotoBookInputImageUrl("");
    setPhotoBookInputImageStoragePath("");
    setPhotoBookInputImageUrls([]);
    setPhotoBookInputImageStoragePaths([]);
    setPhotoBookInputKeyword("");
    setPhotoBookInputCategory2("");
    setPhotoBookInputMemo("");
    setPhotoBookInputImage(null);
    setPhotoBookInputDate(entryDate(currentMonth, currentDay));
    setPhotoBookInputImageMemos([]);
    setPhotoBookInputImageExifs([]);
    setPbMemoEditIdx(null);
    setPhotoBookTab("index");
  }

  // CRUD: Delete Photo Book Item
  async function deletePhotoBookItem(itemId: string) {
    let targetItem = allPhotoBookItems.find(p => p.id === itemId);
    if (!targetItem) return;

    if (!window.confirm("이 포토북 카드를 삭제할까요?")) return;

    const dateStr = targetItem.tag;
    const [tYear, tMonth, tDay] = dateStr.split("-").map(Number);
    const photoKey = key(tMonth, tDay, tYear);
    const previousItems = infoPhotos[photoKey] || [];

    registerUndo({
      label: "정보보관소 사진 삭제",
      target: "infoPhotos",
      photoKey,
      year: tYear,
      previousData: JSON.stringify(previousItems),
    });

    if (targetItem.storagePath) {
      await deleteSupabasePhoto("info-photos", "info_photos", targetItem.storagePath);
    }

    // Delete any additional images from storage
    if (isSupabaseConfigured && supabase) {
      const parsed = parsePhotoBookMemo(targetItem.memo || "");
      if (parsed.additionalImages && parsed.additionalImages.length > 0) {
        for (const img of parsed.additionalImages) {
          if (img.storagePath) {
            const { error: storageError } = await supabase.storage.from("info-photos").remove([img.storagePath]);
            if (storageError) console.warn("Supabase additional photo storage delete error:", storageError.message);
          }
        }
      }
    }

    const nextPhotosForDay = previousItems.filter(p => p.id !== itemId && p.storagePath !== targetItem?.storagePath);
    setInfoPhotos(prev => ({ ...prev, [photoKey]: nextPhotosForDay }));
    saveInfoPhotos(tMonth, tDay, nextPhotosForDay, tYear);

    // Sync global states
    await refreshAllInfoData();
    if (activeItem?.id === itemId) {
      setActiveItem(null);
    }
  }

  // Image upload handler for Photo book
  async function handlePhotoBookImageUpload(files: File | File[]) {
    setInstaLoading(true);
    try {
      const rawList = (Array.isArray(files) ? files : [files]).filter(Boolean) as File[];
      if (rawList.length === 0) {
        alert("업로드할 이미지를 읽을 수 없습니다.");
        return;
      }

      const uploadedItems: PhotoItem[] = [];
      const extractedExifs: PhotoBookImageExif[] = [];
      for (const original of rawList) {
        // iOS가 복제/변환하기 전 원본에서 EXIF(특히 GPS)를 먼저 읽습니다.
        const exif = await extractPhotoExif(original);
        const durableList = await makeDurableImageFiles([original]);
        const file = durableList[0] || original;

        let item = await uploadPhotoToSupabase(file, "info-photos", currentMonth, currentDay, 999, currentYear);
        if (!item) {
          // Supabase 실패 시에도 등록 화면에 표시되도록 로컬 미리보기 사용
          try {
            const dataUrl = await readImageFileAsDataUrl(file);
            if (dataUrl) {
              item = {
                url: dataUrl,
                name: file.name || original.name || "photo.jpg",
                tag: tag(currentMonth, currentDay, currentYear),
                extraTag: "",
                memo: "",
                size: "360",
                memoWidth: "360",
                memoHeight: "110",
                storagePath: "",
              };
            }
          } catch (error) {
            console.warn("local photobook preview fallback failed", error);
          }
        }
        if (item) {
          uploadedItems.push(item);
          extractedExifs.push(exif);
        }
      }

      if (uploadedItems.length > 0) {
        setPhotoBookInputImageUrls(prev => {
          const next = [...prev, ...uploadedItems.map(item => item.url)];
          return next;
        });

        setPhotoBookInputImageStoragePaths(prev => {
          const next = [...prev, ...uploadedItems.map(item => item.storagePath || "")];
          return next;
        });

        setPhotoBookInputImageExifs(prev => [...prev, ...extractedExifs]);
        setPhotoBookInputImageMemos(prev => [...prev, ...uploadedItems.map(() => "")]);

        // Set primary fallback images if not already set
        setPhotoBookInputImageUrl(prev => prev || uploadedItems[0].url);
        setPhotoBookInputImageStoragePath(prev => prev || uploadedItems[0].storagePath || "");

        // Auto classify photo book using AI!
        await runPhotoBookAIClassification(rawList[0]);
      } else {
        alert("이미지 업로드에 실패했습니다.");
      }
    } catch (e) {
      console.error(e);
      alert("이미지 업로드 중 오류 발생: " + e);
    } finally {
      setInstaLoading(false);
    }
  }

  // Drag & Drop handlers for Photo book
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function handlePhotoBookDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith("image/"));
    if (imageFiles.length > 0) {
      await handlePhotoBookImageUpload(imageFiles);
    }
  }

  // Clipboard Paste for Photo book
  async function handlePhotoBookPasteZone(event: ClipboardEvent<HTMLDivElement>) {
    const pastedFiles = (Array.from(event.clipboardData.items) as DataTransferItem[])
      .filter(item => item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (pastedFiles.length > 0) {
      event.preventDefault();
      await handlePhotoBookImageUpload(pastedFiles);
    }
  }

  // Clipboard Paste for Instagram Info Management
  async function handleInstaPasteZone(event: ClipboardEvent<HTMLDivElement>) {
    const pastedFiles = (Array.from(event.clipboardData.items) as DataTransferItem[])
      .filter(item => item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (pastedFiles.length > 0) {
      event.preventDefault();
      await handleInstaImageUpload(pastedFiles[0]);
      return;
    }

    const text = event.clipboardData.getData("text");
    if (text) {
      setInstaInputText(prev => prev ? `${prev}\n${text}` : text);
      await runAIClassification(text);
    }
  }

  // Clipboard Paste button handler for Instagram Info Management
  async function pasteInstaImageFromClipboard() {
    try {
      const clipboard = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };
      if (!clipboard.read) {
        alert("이 브라우저에서는 클립보드 붙여넣기를 지원하지 않습니다. '사진 가져오기'를 사용해 주세요.");
        return;
      }

      const clipboardItems = await clipboard.read();
      let file: File | null = null;

      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        file = new File([blob], `insta_pasted_${Date.now()}.png`, { type: imageType });
        break;
      }

      if (!file) {
        alert("클립보드에 이미지 데이터가 없습니다. 이미지를 복사한 후 다시 시도해 주세요.");
        return;
      }

      await handleInstaImageUpload(file);
    } catch (e) {
      console.error(e);
      alert("클립보드 접근 권한이 없거나 지원되지 않는 브라우저입니다. 복사한 이미지를 입력 창에 직접 붙여넣거나(Ctrl+V) '사진 가져오기'를 사용해 주세요.");
    }
  }

  // Clipboard Paste button handler for Photo book
  async function pastePhotoBookImageFromClipboard() {
    try {
      const clipboard = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };
      if (!clipboard.read) {
        alert("이 브라우저에서는 클립보드 붙여넣기를 지원하지 않습니다. '사진 가져오기'를 사용해 주세요.");
        return;
      }

      const clipboardItems = await clipboard.read();
      let file: File | null = null;

      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        file = new File([blob], `photobook_pasted_${Date.now()}.png`, { type: imageType });
        break;
      }

      if (!file) {
        alert("클립보드에 이미지 데이터가 없습니다. 이미지를 복사한 후 다시 시도해 주세요.");
        return;
      }

      await handlePhotoBookImageUpload(file);
    } catch (e) {
      console.error(e);
      alert("클립보드 접근 권한이 없거나 지원되지 않는 브라우저입니다. 복사한 이미지를 입력 창에 직접 붙여넣거나(Ctrl+V) '사진 가져오기'를 사용해 주세요.");
    }
  }

  // API Call: Auto Classify Photo book
  async function runPhotoBookAIClassification(file?: File, memoText?: string) {
    setInstaLoading(true);
    try {
      let imageBase64 = "";
      let mimeType = "";
      if (file) {
        imageBase64 = await fileToBase64(file);
        mimeType = file.type;
      } else if (photoBookInputImageUrl) {
        try {
          imageBase64 = await imageUrlToBase64(photoBookInputImageUrl);
          mimeType = "image/jpeg";
        } catch (e) {
          console.warn("Failed to fetch image base64 for classification:", e);
        }
      }

      const textContext = memoText || photoBookInputMemo;

      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gemini-api-key": geminiApiKey || ""
        },
        body: JSON.stringify({
          action: "photobook-classify",
          text: textContext,
          imageBase64,
          mimeType
        })
      });

      const data = await res.json();
      if (data.error) {
        console.warn("Photobook Classification API Error:", data.error);
        return;
      }

      try {
        const parsed = JSON.parse(data.result);
        if (parsed.keyword) setPhotoBookInputKeyword(parsed.keyword);
        if (parsed.category2) setPhotoBookInputCategory2(parsed.category2);
      } catch (e) {
        console.warn("Failed to parse photobook classification JSON:", data.result, e);
      }
    } catch (e) {
      console.error("Photobook classification error:", e);
    } finally {
      setInstaLoading(false);
    }
  }

  // PC share helper: Copy Card to clipboard
  function copyCardToClipboard(card: InstaInfoCard) {
    const text = `[인스타 주요 정보 리포트]
분류: ${card.category}
키워드: ${card.keyword}
작성일자: ${card.entryDate}
상세내용:
${card.originalText}

${card.factCheckResult ? `[Gemini AI 팩트체크]\n${card.factCheckResult}` : ""}`;

    navigator.clipboard.writeText(text).then(() => {
      alert("클립보드에 인스타 정보가 복사되었습니다.");
    }).catch(err => {
      console.error("복사 실패:", err);
      alert("복사 실패했습니다.");
    });
  }

  // PC share helper: Copy Photo Book to clipboard
  function copyPhotoBookToClipboard(photo: any) {
    let text = `[포토북 이미지 정보]
키워드: ${photo.keyword}
2차분류: ${photo.category2}
작성일자: ${photo.tag}
메모:
${photo.memoText}
대표 이미지: ${photo.url}`;

    if (photo.additionalImages && photo.additionalImages.length > 0) {
      text += `\n추가 이미지 목록:\n` + photo.additionalImages.map((img: any, i: number) => `${i + 1}. ${img.url}`).join("\n");
    }

    navigator.clipboard.writeText(text).then(() => {
      alert("클립보드에 포토북 정보가 복사되었습니다.");
    }).catch(err => {
      console.error("복사 실패:", err);
      alert("복사 실패했습니다.");
    });
  }

  function getPhotoBookImageUrls(photo: PhotoItem | { url?: string; memo?: string; additionalImages?: Array<{ url: string }> }) {
    const parsed = "additionalImages" in photo && Array.isArray(photo.additionalImages)
      ? { additionalImages: photo.additionalImages, imageMemos: (photo as { imageMemos?: string[] }).imageMemos }
      : parsePhotoBookMemo(photo.memo || "");
    return [photo.url || "", ...(parsed.additionalImages?.map((img) => img.url) || [])].filter(Boolean);
  }

  function getPhotoBookImageMemos(
    photo: PhotoItem | { url?: string; memo?: string; imageMemos?: string[]; additionalImages?: Array<{ url: string }> },
    urlCount?: number
  ) {
    const directMemos = "imageMemos" in photo && Array.isArray(photo.imageMemos) ? photo.imageMemos : null;
    const parsed = directMemos
      ? { imageMemos: directMemos }
      : parsePhotoBookMemo(photo.memo || "");
    const count = urlCount ?? getPhotoBookImageUrls(photo).length;
    return Array.from({ length: count }, (_, i) => String(parsed.imageMemos?.[i] || ""));
  }

  function getPhotoBookImageExifs(
    photo: PhotoItem | { url?: string; memo?: string; imageExifs?: PhotoBookImageExif[]; additionalImages?: Array<{ url: string }> },
    urlCount?: number
  ): PhotoBookImageExif[] {
    const directExifs = "imageExifs" in photo && Array.isArray(photo.imageExifs) ? photo.imageExifs : null;
    const parsed = directExifs
      ? { imageExifs: directExifs }
      : parsePhotoBookMemo(photo.memo || "");
    const count = urlCount ?? getPhotoBookImageUrls(photo).length;
    return Array.from({ length: count }, (_, i) => parsed.imageExifs?.[i] || {});
  }

  function updatePhotoBookImageMemoAt(idx: number, value: string) {
    setPhotoBookInputImageMemos((prev) => {
      const next = [...prev];
      while (next.length <= idx) next.push("");
      next[idx] = value;
      return next;
    });
  }

  function openPhotoAlbumViewer(
    photo: PhotoItem & {
      keyword?: string;
      additionalImages?: Array<{ url: string }>;
      imageMemos?: string[];
      imageExifs?: PhotoBookImageExif[];
    },
    startIndex = 0
  ) {
    const urls = getPhotoBookImageUrls(photo);
    if (urls.length === 0) {
      alert("사진첩에 표시할 이미지가 없습니다.");
      return;
    }
    const memos = getPhotoBookImageMemos(photo, urls.length);
    const rawExifs = getPhotoBookImageExifs(photo, urls.length);
    setPhotoAlbumViewer({
      photoBookId: photo.id || "",
      keyword: photo.keyword || parsePhotoBookMemo(photo.memo || "").keyword || "포토북",
      urls,
      memos,
      exifs: rawExifs,
      index: Math.max(0, Math.min(startIndex, urls.length - 1)),
    });
    void enrichPhotoBookImageExifs(rawExifs).then((exifs) => {
      setPhotoAlbumViewer((prev) => (prev && prev.photoBookId === (photo.id || "") ? { ...prev, exifs } : prev));
    });
  }

  function movePhotoAlbumViewer(direction: -1 | 1) {
    setPhotoAlbumViewer((prev) => {
      if (!prev || prev.urls.length === 0) return prev;
      const nextIndex = (prev.index + direction + prev.urls.length) % prev.urls.length;
      return { ...prev, index: nextIndex };
    });
  }

  function closePhotoAlbumViewer() {
    setPhotoAlbumViewer(null);
  }

  // PhotoBook batch sharing helper
  async function shareSelectedPhotoBookItems() {
    const selectedPhotos = allPhotoBookItems.filter(p => p.id && selectedPhotoBookIds.includes(p.id)).map(photo => {
      const parsed = parsePhotoBookMemo(photo.memo || "");
      return {
        ...photo,
        keyword: parsed.keyword,
        category2: parsed.category2,
        memoText: parsed.memo,
        additionalImages: parsed.additionalImages || []
      };
    });
    if (selectedPhotos.length === 0) {
      alert("선택된 포토북 항목이 없습니다.");
      return;
    }

    let text = `[에어제타 포토북 공유]\n총 ${selectedPhotos.length}개의 사진 기록:\n\n`;
    selectedPhotos.forEach((p, idx) => {
      text += `${idx + 1}. #${p.keyword} #${p.category2} (작성일자: ${p.tag})\n`;
      if (p.memoText) text += `메모: ${p.memoText}\n`;
      if (p.url) text += `이미지: ${p.url}\n`;
      if (p.additionalImages && p.additionalImages.length > 0) {
        p.additionalImages.forEach((img, i) => {
          text += `추가 이미지 ${i + 1}: ${img.url}\n`;
        });
      }
      text += `\n`;
    });

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "에어제타 포토북 앨범",
          text: text,
        });
      } catch (e) {
        console.error("Web Share failed:", e);
      }
    } else {
      navigator.clipboard.writeText(text).then(() => {
        alert("선택한 포토북 정보가 클립보드에 복사되었습니다. 다른 기기나 PC로 공유해 보세요!");
      }).catch(err => {
        console.error("공유 텍스트 복사 실패:", err);
        alert("공유에 실패했습니다.");
      });
    }
  }

  // Instagram batch sharing helper
  async function shareSelectedInstaCards() {
    const selectedCards = allInstaCards.filter(c => selectedInstaCardIds.includes(c.id));
    if (selectedCards.length === 0) {
      alert("선택된 인스타 정보가 없습니다.");
      return;
    }

    let text = `[에어제타 인스타 주요 정보 공유]\n총 ${selectedCards.length}개의 정보 기록:\n\n`;
    selectedCards.forEach((c, idx) => {
      text += `${idx + 1}. [${c.category}] ${c.keyword} (작성일자: ${c.entryDate})\n`;
      text += `본문:\n${c.originalText}\n`;
      if (c.imageUrls && c.imageUrls.length > 0) {
        text += `이미지 목록:\n` + c.imageUrls.map(url => `- ${url}`).join("\n") + "\n";
      }
      if (c.factCheckResult) {
        text += `\n[Gemini AI 팩트체크]\n${c.factCheckResult}\n`;
      }
      text += `\n-------------------\n\n`;
    });

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "에어제타 인스타 주요 정보 정보북",
          text: text,
        });
      } catch (e) {
        console.error("Web Share failed:", e);
      }
    } else {
      navigator.clipboard.writeText(text).then(() => {
        alert("선택한 인스타 정보가 클립보드에 복사되었습니다. 다른 기기나 PC로 공유해 보세요!");
      }).catch(err => {
        console.error("공유 텍스트 복사 실패:", err);
        alert("공유에 실패했습니다.");
      });
    }
  }

  // PC share helper: Download Card as TXT
  function downloadCardAsTxt(card: InstaInfoCard) {
    const text = `[인스타 주요 정보 리포트]
분류: ${card.category}
키워드: ${card.keyword}
작성일자: ${card.entryDate}
상세내용:
${card.originalText}

${card.factCheckResult ? `[Gemini AI 팩트체크]\n${card.factCheckResult}` : ""}`;

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `insta_info_${card.category}_${card.keyword}_${card.entryDate}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // PC share helper: Download Photo Book as TXT
  function downloadPhotoBookAsTxt(photo: any) {
    let text = `[포토북 이미지 정보]
키워드: ${photo.keyword}
2차분류: ${photo.category2}
작성일자: ${photo.tag}
메모:
${photo.memoText}
대표 이미지: ${photo.url}`;

    if (photo.additionalImages && photo.additionalImages.length > 0) {
      text += `\n추가 이미지 목록:\n` + photo.additionalImages.map((img: any, i: number) => `${i + 1}. ${img.url}`).join("\n");
    }

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `photobook_${photo.keyword}_${photo.category2}_${photo.tag}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function InfoView() {
    const photoCategories2 = [
      "여행", "일상", "음식", "기억", "풍경", "인물", "취미", "She", "기타"
    ];

    // Filter Photo Book list
    const filteredPhotoBookItems = allPhotoBookItems.map(photo => {
      const parsed = parsePhotoBookMemo(photo.memo || "");
      return {
        ...photo,
        keyword: parsed.keyword,
        category2: parsed.category2,
        memoText: parsed.memo,
        additionalImages: parsed.additionalImages || [],
        imageMemos: parsed.imageMemos || [],
        imageExifs: parsed.imageExifs || [],
        isPinned: parsed.isPinned || photo.isPinned || false
      };
    }).filter(photo => {
      if (!photoSearchKey.trim()) return true;
      const query = photoSearchKey.toLowerCase();
      return (
        photo.keyword.toLowerCase().includes(query) ||
        photo.category2.toLowerCase().includes(query) ||
        photo.tag.toLowerCase().includes(query) ||
        photo.memoText.toLowerCase().includes(query)
      );
    }).sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return 0;
    });

    const selectedPhotoBookItems = allPhotoBookItems.map(photo => {
      const parsed = parsePhotoBookMemo(photo.memo || "");
      return {
        ...photo,
        keyword: parsed.keyword,
        category2: parsed.category2,
        memoText: parsed.memo,
        additionalImages: parsed.additionalImages || []
      };
    }).filter(photo => selectedPhotoBookIds.includes(photo.id || ""));

    // Find active photobook item details
    let activePhoto: any | undefined;
    if (activeItem && activeItem.type === "photobook") {
      const rawPhoto = allPhotoBookItems.find(p => p.id === activeItem.id);
      if (rawPhoto) {
        const parsed = parsePhotoBookMemo(rawPhoto.memo || "");
        activePhoto = {
          ...rawPhoto,
          keyword: parsed.keyword,
          category2: parsed.category2,
          memoText: parsed.memo,
          imageMemos: parsed.imageMemos || [],
          imageExifs: parsed.imageExifs || [],
          additionalImages: parsed.additionalImages || []
        };
      }
    }

    return (
      <section>
        <div className="box info-box" style={{ border: "2px solid var(--deep)", minHeight: 740 }} tabIndex={0}>
          {/* Header */}
          <div className="info-head info-head-one-line" style={{ marginBottom: "20px" }}>
            <div className="info-title-one-line">
              <h2 className="info-title">📂 정보보관소 지식 Wiki</h2>
              <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>📅 월간 캘린더</button>
            </div>

            <div className="info-action-one-line">
              <button type="button" className="pill-btn" onClick={() => openDiary(currentMonth, currentDay)}>✍️ 일기</button>
              <button type="button" className="undo-btn" onClick={applyUndo} disabled={!undoHistory.length}>↩ 되돌리기</button>
            </div>
          </div>

          {/* Tab Selector */}
          <div className="info-subview-tabs" style={{ marginBottom: "20px", display: "flex", gap: "10px" }}>
            <button
              type="button"
              className={`info-subview-tab ${infoSubView === "generalInfo" ? "active" : ""}`}
              onClick={() => {
                setInfoSubView("generalInfo");
                setActiveItem(null);
              }}
              style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: infoSubView === "generalInfo" ? "rgba(122,184,255,0.15)" : "transparent", color: infoSubView === "generalInfo" ? "#7ab8ff" : "#ccc", cursor: "pointer" }}
            >
              📂 일반 정보 저장함
            </button>
            <button
              type="button"
              className={`info-subview-tab ${infoSubView === "photobook" ? "active" : ""}`}
              onClick={() => {
                setInfoSubView("photobook");
                setActiveItem(null);
                setEditingPhotoBookItemId(null);
              }}
              style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: infoSubView === "photobook" ? "rgba(122,184,255,0.15)" : "transparent", color: infoSubView === "photobook" ? "#7ab8ff" : "#ccc", cursor: "pointer" }}
            >
              📖 포토북 (Photo Book)
            </button>
          </div>

          {infoSubView === "generalInfo" ? (
            /* Render Chapter 3 Component */
            <Chapter3Info
              geminiApiKey={geminiApiKey}
              setGeminiApiKey={setGeminiApiKey}
              isGeneralInfoMobileLayout={infoState.isGeneralInfoMobileLayout}
              generalInfoDraft={infoState.generalInfoDraft}
              setGeneralInfoDraft={infoState.setGeneralInfoDraft}
              generalInfoDraftBackup={infoState.generalInfoDraftBackup}
              generalInfoEditingId={infoState.generalInfoEditingId}
              generalInfoImageLoadFailed={infoState.generalInfoImageLoadFailed}
              setGeneralInfoImageLoadFailed={infoState.setGeneralInfoImageLoadFailed}
              generalInfoKeywordText={infoState.generalInfoKeywordText}
              setGeneralInfoKeywordText={infoState.setGeneralInfoKeywordText}
              generalInfoRichTextEditorKey={infoState.generalInfoRichTextEditorKey}
              generalInfoRichTextRef={infoState.generalInfoRichTextRef}
              generalInfoRichTextInitialHtml={infoState.generalInfoRichTextInitialHtml}
              syncGeneralInfoRichTextToDraft={infoState.syncGeneralInfoRichTextToDraft}
              handleGeneralInfoRichPaste={infoState.handleGeneralInfoRichPaste}
              handleGeneralInfoRichCommand={infoState.handleGeneralInfoRichCommand}
              getGeneralInfoToolbarButtonStyle={infoState.getGeneralInfoToolbarButtonStyle}
              makeGeneralInfoHtmlFromText={infoState.makeGeneralInfoHtmlFromText}
              handleUndoGeneralInfoDraft={infoState.handleUndoGeneralInfoDraft}
              handleResetGeneralInfoDraft={infoState.handleResetGeneralInfoDraft}
              handleCollectGeneralInfoFromClipboard={infoState.handleCollectGeneralInfoFromClipboard}
              isCollectingGeneralInfoClipboard={infoState.isCollectingGeneralInfoClipboard}
              handleExtractGeneralInfoUrl={infoState.handleExtractGeneralInfoUrl}
              isExtractingGeneralInfoUrl={infoState.isExtractingGeneralInfoUrl}
              handleGeneralInfoFileUpload={infoState.handleGeneralInfoFileUpload}
              handleGeneralInfoIphonePasteZonePaste={infoState.handleGeneralInfoIphonePasteZonePaste}
              handleClearGeneralInfoCoverImage={infoState.handleClearGeneralInfoCoverImage}
              handleRemoveGeneralInfoMediaItem={infoState.handleRemoveGeneralInfoMediaItem}
              handleAnalyzeGeneralInfoDraft={infoState.handleAnalyzeGeneralInfoDraft}
              isAnalyzingGeneralInfo={infoState.isAnalyzingGeneralInfo}
              handleFactCheckGeneralInfoDraft={infoState.handleFactCheckGeneralInfoDraft}
              isRunningGeneralInfoFactCheck={infoState.isRunningGeneralInfoFactCheck}
              geminiApiPacketStatus={infoState.geminiApiPacketStatus}
              handleConfirmGeneralInfo={infoState.handleConfirmGeneralInfo}
              handleCancelEditGeneralInfo={infoState.handleCancelEditGeneralInfo}
              generalInfoItems={infoState.generalInfoItems}
              filteredGeneralInfoItems={infoState.filteredGeneralInfoItems}
              generalInfoSearchTerm={infoState.generalInfoSearchTerm}
              setGeneralInfoSearchTerm={infoState.setGeneralInfoSearchTerm}
              setGeneralInfoDetailId={infoState.setGeneralInfoDetailId}
              generalInfoDetailId={infoState.generalInfoDetailId}
              generalInfoActiveTab={infoState.generalInfoActiveTab}
              setGeneralInfoActiveTab={infoState.setGeneralInfoActiveTab}
              handleTogglePinGeneralInfo={infoState.handleTogglePinGeneralInfo}
              loadGeneralInfoItemsFromSupabase={infoState.loadGeneralInfoItemsFromSupabase}
              generalInfoSupabaseStatus={infoState.generalInfoSupabaseStatus}
              generalInfoCategories={infoState.generalInfoCategories}
              normalizeGeneralInfoMediaItems={infoState.normalizeGeneralInfoMediaItems}
              getGeneralInfoDisplayMediaItems={infoState.getGeneralInfoDisplayMediaItems}
              handleSaveTemporaryGeneralInfoDraft={infoState.handleSaveTemporaryGeneralInfoDraft}
              onOpenStorageImage={openStorageImage}
            />
          ) : (
            /* Photo Book Tab-based Layout */
            <div style={{ width: "100%" }}>
              {/* Tab buttons */}
              <div className="ch3TabBar">
                <button
                  className={`ch3TabBtn ${photoBookTab === "index" ? "active" : ""}`}
                  onClick={() => setPhotoBookTab("index")}
                >📖 포토북 인덱스</button>
                <button
                  className={`ch3TabBtn ${photoBookTab === "register" ? "active" : ""}`}
                  onClick={() => {
                    setActiveItem(null);
                    setEditingPhotoBookItemId(null);
                    setPhotoBookInputKeyword("");
                    setPhotoBookInputCategory2("여행");
                    setPhotoBookInputMemo("");
                    setPhotoBookInputImageUrl("");
                    setPhotoBookInputImageStoragePath("");
                    setPhotoBookInputImageUrls([]);
                    setPhotoBookInputImageStoragePaths([]);
                    setPhotoBookInputImageMemos([]);
                    setPhotoBookInputImageExifs([]);
                    setPhotoBookInputDate(entryDate(currentMonth, currentDay));
                    setPhotoBookTab("register");
                  }}
                >📖 포토북 등록</button>
              </div>

              {/* Register Tab: edit / create / detail forms */}
              {photoBookTab === "register" && (
              <div style={{ position: "relative" }}>
                {/* Scroll to Top Button */}
                <button
                  type="button"
                  className="scroll-to-top-btn"
                  onClick={(e) => {
                    if (window.innerWidth <= 900) {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    } else {
                      e.currentTarget.parentElement?.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  title="맨위로"
                >맨 위로 ↑</button>
{/* 선택 액션 바는 인덱스 탭으로 이동 */}

                {activeItem ? (
                  /* Detail/Edit View */
                  activeItem.type === "photobook" && activePhoto ? (
                    editingPhotoBookItemId === activePhoto.id ? (
                      /* Photo Book Edit Form */
                      <div className="insta-input-card" style={{ background: "transparent", border: "none", padding: 0 }}>
                        <h3 className="form-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "nowrap", gap: "10px" }}>
                          <span>📝 포토북 메모 수정</span>
                          <span style={{ fontSize: "13px", color: "#ccc", fontWeight: "normal", display: "inline-flex", alignItems: "center", gap: "5px", whiteSpace: "nowrap" }}>
                            작성일자:
                            <input
                              type="date"
                              className="info-date-input"
                              min="2026-05-01"
                              max="2036-12-31"
                              value={photoBookInputDate}
                              onChange={e => setPhotoBookInputDate(e.target.value)}
                            />
                          </span>
                        </h3>

                        <div 
                          className="insta-paste-zone" 
                          onPaste={handlePhotoBookPasteZone} 
                          onDragOver={handleDragOver}
                          onDrop={handlePhotoBookDrop}
                          tabIndex={0}
                          style={{ minHeight: "120px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", border: "2px dashed rgba(255,255,255,0.15)", borderRadius: "10px", padding: "15px", background: "rgba(0,0,0,0.15)", outline: "none" }}
                        >
                          {photoBookInputImageUrls.length > 0 ? (
                            <div className="pbRegImageGrid">
                              {photoBookInputImageUrls.map((url, idx) => (
                                <div key={idx} className="pbRegImageCell">
                                  <div className={`pbRegImageThumb ${idx === 0 ? "is-primary" : ""} ${pbMemoEditIdx === idx ? "is-editing" : ""}`}>
                                    <img
                                      src={url}
                                      alt={`미리보기 ${idx + 1}`}
                                      style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const pbId = editingPhotoBookItemId || activePhoto?.id || "";
                                        if (pbId) {
                                          openPhotoBookImageResize({
                                            url,
                                            photoBookId: pbId,
                                            imageIndex: idx,
                                            fileName: `photobook_preview_${idx + 1}.jpg`,
                                          });
                                        } else {
                                          openStorageImage(url, `photobook_preview_${idx + 1}.jpg`);
                                        }
                                      }}
                                    />
                                    {photoBookInputImageMemos[idx] && pbMemoEditIdx !== idx && (
                                      <span className="pbRegThumbMemoBadge">{photoBookInputImageMemos[idx]}</span>
                                    )}
                                    <button 
                                      type="button" 
                                      className="remove-preview-btn" 
                                      title="이미지 삭제" 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const nextUrls = [...photoBookInputImageUrls];
                                        const nextPaths = [...photoBookInputImageStoragePaths];
                                        const nextMemos = [...photoBookInputImageMemos];
                                        const nextExifs = [...photoBookInputImageExifs];
                                        nextUrls.splice(idx, 1);
                                        nextPaths.splice(idx, 1);
                                        nextMemos.splice(idx, 1);
                                        nextExifs.splice(idx, 1);
                                        setPhotoBookInputImageUrls(nextUrls);
                                        setPhotoBookInputImageStoragePaths(nextPaths);
                                        setPhotoBookInputImageMemos(nextMemos);
                                        setPhotoBookInputImageExifs(nextExifs);
                                        setPhotoBookInputImageUrl(nextUrls[0] || "");
                                        setPhotoBookInputImageStoragePath(nextPaths[0] || "");
                                        if (pbMemoEditIdx === idx) setPbMemoEditIdx(null);
                                      }}
                                      style={{ position: "absolute", top: "2px", right: "2px", background: "rgba(239, 68, 68, 0.8)", color: "#fff", border: "none", borderRadius: "50%", width: "18px", height: "18px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", cursor: "pointer" }}
                                    >×</button>
                                  </div>
                                  <button
                                    type="button"
                                    className="pbRegMemoToggle"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPbMemoEditIdx(pbMemoEditIdx === idx ? null : idx);
                                    }}
                                  >
                                    {photoBookInputImageMemos[idx] ? "📝 메모" : "＋ 메모"}
                                  </button>
                                  {idx === 0 ? (
                                    <span style={{ fontSize: "10px", color: "#eab308", fontWeight: "bold", marginTop: "3px" }}>★ 대표</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        makePhotoBookRepresentative(idx);
                                      }}
                                      style={{
                                        marginTop: "3px",
                                        background: "rgba(234, 179, 8,.15)",
                                        color: "#facc15",
                                        border: "1px solid rgba(234, 179, 8, 0.4)",
                                        borderRadius: "4px",
                                        fontSize: "9px",
                                        padding: "1px 4px",
                                        cursor: "pointer",
                                        fontWeight: "bold"
                                      }}
                                    >
                                      ★ 대표 설정
                                    </button>
                                  )}
                                  {hasPhotoBookExif(photoBookInputImageExifs[idx]) && (
                                    <div className="pbPhotoExifCaption">
                                      {getPhotoBookExifViewLines(photoBookInputImageExifs[idx]).map((line) => (
                                        <span key={line}>{line}</span>
                                      ))}
                                    </div>
                                  )}
                                  {pbMemoEditIdx === idx && (
                                    <div
                                      className="pbRegMemoEditor"
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onPaste={(e) => e.stopPropagation()}
                                    >
                                      <input
                                        type="text"
                                        className="pbRegMemoInput"
                                        value={photoBookInputImageMemos[idx] || ""}
                                        onChange={(e) => updatePhotoBookImageMemoAt(idx, e.target.value)}
                                        placeholder="개별 사진 메모 (최대 약 15자)"
                                        maxLength={40}
                                        autoFocus
                                      />
                                      <div className="pbRegMemoEditorActions">
                                        <button type="button" className="generalInfoMediaMemoBtnOk" onClick={() => setPbMemoEditIdx(null)}>✓ 완료</button>
                                        {photoBookInputImageMemos[idx] && (
                                          <button
                                            type="button"
                                            className="generalInfoMediaMemoBtnDelete"
                                            onClick={() => {
                                              updatePhotoBookImageMemoAt(idx, "");
                                              setPbMemoEditIdx(null);
                                            }}
                                          >✕ 삭제</button>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  {pbMemoEditIdx !== idx && photoBookInputImageMemos[idx] && (
                                    <div
                                      className="pbRegMemoDisplay"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPbMemoEditIdx(idx);
                                      }}
                                    >
                                      {photoBookInputImageMemos[idx]}
                                    </div>
                                  )}
                                </div>
                              ))}
                              <label className="pbRegAddTile">
                                <span>➕ 추가</span>
                                <input
                                  type="file"
                                  accept=".heic,.heif,.jpg,.jpeg,.png,image/heic,image/heif,image/jpeg,image/png"
                                  multiple
                                  className="hidden-input"
                                  style={{ display: "none" }}
                                  onChange={async e => {
                                    const files = Array.from(e.target.files || []) as File[];
                                    if (files.length > 0) await handlePhotoBookImageUpload(files);
                                  }}
                                />
                              </label>
                            </div>
                          ) : (
                            <div className="paste-placeholder">
                              <span className="icon">📖</span>
                              <p>여기에 이미지를 드롭하거나 복사-붙여넣기(Ctrl+V) 하세요. (여러 장 가능)</p>
                            </div>
                          )}
                        </div>

                        <div className="info-image-actions" style={{ display: "flex", gap: "10px", marginTop: "10px", flexWrap: "wrap" }}>
                          <label className="file-select-btn" style={{ margin: 0 }}>
                            📸 사진 가져오기
                            <input
                              type="file"
                              accept=".heic,.heif,.jpg,.jpeg,.png,image/heic,image/heif,image/jpeg,image/png"
                              multiple
                              className="hidden-input"
                              onChange={async e => {
                                const files = Array.from(e.target.files || []) as File[];
                                if (files.length > 0) await handlePhotoBookImageUpload(files);
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="file-select-btn"
                            onClick={pastePhotoBookImageFromClipboard}
                            style={{ margin: 0 }}
                          >
                            📋 클립보드 붙여넣기
                          </button>
                        </div>

                        {/* 📱 아이폰 이미지/인스타 붙여넣기 존 */}
                        <div
                          className="generalInfoIphonePasteZone"
                          contentEditable
                          suppressContentEditableWarning
                          role="textbox"
                          tabIndex={0}
                          onPaste={async (e) => {
                            e.preventDefault();
                            const items = Array.from(e.clipboardData.items);
                            const files: File[] = [];
                            for (const item of items) {
                              if (item.kind === "file" && item.type.startsWith("image/")) {
                                const f = item.getAsFile();
                                if (f) files.push(f);
                              }
                            }
                            if (files.length > 0) {
                              await handlePhotoBookImageUpload(files);
                            } else {
                              const text = e.clipboardData.getData("text/plain") || e.clipboardData.getData("text/uri-list");
                              if (text.trim()) alert(`붙여넣기된 텍스트:\n${text.trim().slice(0, 100)}`);
                            }
                          }}
                          style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", padding: "12px", cursor: "pointer", marginTop: "8px" }}
                        >
                          <strong>📱 아이폰 이미지 / 인스타 링크 붙여넣기</strong>
                        </div>

                        <div className="input-group" style={{ marginTop: "15px" }}>
                          <label className="field-label">키워드 (1-2단어):</label>
                          <input
                            type="text"
                            className="info-title-input"
                            style={{
                              width: "100%",
                              padding: "10px",
                              borderRadius: "8px",
                              border: "1px solid rgba(255,255,255,0.15)",
                              background: "rgba(0,0,0,0.2)",
                              color: "#fff",
                              boxSizing: "border-box",
                              fontSize: "14px"
                            }}
                            placeholder="예: 가족, 바다, 일상"
                            value={photoBookInputKeyword}
                            onChange={e => setPhotoBookInputKeyword(e.target.value)}
                          />
                        </div>

                        <div className="input-group" style={{ marginTop: "15px" }}>
                          <label className="field-label">2차 분류 선택:</label>
                          <select
                            className="info-category-select"
                            style={{
                              width: "100%",
                              padding: "10px",
                              borderRadius: "8px",
                              border: "1px solid rgba(255,255,255,0.15)",
                              background: "rgba(0,0,0,0.2)",
                              color: "#fff",
                              fontSize: "14px"
                            }}
                            value={photoBookInputCategory2}
                            onChange={e => setPhotoBookInputCategory2(e.target.value)}
                          >
                            {photoCategories2.map(cat => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                        </div>

                        <div className="input-group" style={{ marginTop: "15px" }}>
                          <label className="field-label">메모 내용:</label>
                          <textarea
                            className="info-text-textarea generalInfoFormattedTextView"
                            style={{
                              width: "100%",
                              minHeight: "200px",
                              maxHeight: "480px",
                              boxSizing: "border-box",
                              resize: "vertical"
                            }}
                            placeholder="사진에 관련된 메모나 일기 내용을 입력하세요."
                            value={photoBookInputMemo}
                            onChange={e => setPhotoBookInputMemo(e.target.value)}
                          />
                        </div>

                        <div className="index-preview-box" style={{ margin: "15px 0" }}>
                          <span className="preview-label">생성될 Index 형식:</span>
                          <span className="preview-value">#{photoBookInputKeyword.trim() || "keyword"}#{photoBookInputCategory2.trim() || "분류"}#{photoBookInputDate}</span>
                        </div>

                        <div style={{ position: "sticky", bottom: "70px", zIndex: 10, background: "rgba(10,18,32,0.92)", borderTop: "1px solid rgba(255,255,255,0.1)", padding: "12px 0", marginTop: "24px", marginBottom: "20px", display: "flex", gap: "10px", flexWrap: "wrap", backdropFilter: "blur(6px)" }}>
                          <button type="button" className="pill-btn save-btn" onClick={savePhotoBookItemForm} style={{ fontSize: "15px", padding: "12px 28px", fontWeight: "bold" }}>💾 수정 완료</button>
                          <button type="button" className="pill-btn cancel-btn" onClick={cancelEditPhotoBook} style={{ background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: "14px", padding: "12px 22px" }}>✕ 취소</button>
                        </div>
                      </div>
                    ) : (
                      /* Photo Book Detail View */
                      <div className="info-detail-view" style={{ color: "#fff" }}>
                        <h3 className="detail-title" style={{ fontSize: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "10px" }}>
                          <span>📖 포토북 상세 보기</span>
                          <span style={{ fontSize: "14px", fontWeight: "normal", color: "#aaa" }}>작성일: {activePhoto.tag}</span>
                        </h3>

                        {activePhoto.url && (() => {
                          const allImgUrls: string[] = [activePhoto.url, ...(activePhoto.additionalImages?.map((img: any) => img.url) || [])];
                          const curUrl = activePreviewPhotoUrl || activePhoto.url;
                          const curIdx = allImgUrls.indexOf(curUrl) === -1 ? 0 : allImgUrls.indexOf(curUrl);
                          const hasPrev = curIdx > 0;
                          const hasNext = curIdx < allImgUrls.length - 1;
                          const imgMemo = (activePhoto.imageMemos || [])[curIdx];
                          const arrowBtnStyle: React.CSSProperties = {
                            position: "absolute",
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: "rgba(0,0,0,0.52)",
                            border: "1px solid rgba(255,255,255,0.18)",
                            borderRadius: "50%",
                            width: 44,
                            height: 44,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                            fontSize: 22,
                            cursor: "pointer",
                            zIndex: 10,
                            userSelect: "none",
                            lineHeight: 1,
                            transition: "background 0.15s",
                            flexShrink: 0,
                          };
                          return (
                            <div className="detail-media-container" style={{ textAlign: "center", margin: "15px 0", background: "rgba(0,0,0,0.15)", borderRadius: "10px", padding: "12px", minHeight: "65vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                              {/* 이미지 + 좌우 화살표 */}
                              <div style={{ position: "relative", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                {allImgUrls.length > 1 && (
                                  <button
                                    type="button"
                                    style={{ ...arrowBtnStyle, left: 0, opacity: hasPrev ? 1 : 0.25, pointerEvents: hasPrev ? "auto" : "none" }}
                                    onClick={() => setActivePreviewPhotoUrl(allImgUrls[curIdx - 1])}
                                    aria-label="이전 이미지"
                                  >
                                    ‹
                                  </button>
                                )}
                                <img
                                  src={curUrl}
                                  alt="포토북 상세 사진"
                                  style={{ width: "100%", height: "auto", minHeight: "60vh", maxWidth: "100%", borderRadius: "8px", cursor: "zoom-in", objectFit: "contain", display: "block" }}
                                  onClick={() => {
                                    if (activePhoto.id) {
                                      openPhotoBookImageResize({
                                        url: curUrl,
                                        photoBookId: activePhoto.id,
                                        imageIndex: curIdx,
                                        fileName: `photobook_${activePhoto.keyword || "photo"}_${curIdx + 1}.jpg`,
                                      });
                                    } else {
                                      openStorageImage(curUrl, `photobook_${activePhoto.keyword || "photo"}_${curIdx + 1}.jpg`);
                                    }
                                  }}
                                />
                                {allImgUrls.length > 1 && (
                                  <button
                                    type="button"
                                    style={{ ...arrowBtnStyle, right: 0, opacity: hasNext ? 1 : 0.25, pointerEvents: hasNext ? "auto" : "none" }}
                                    onClick={() => setActivePreviewPhotoUrl(allImgUrls[curIdx + 1])}
                                    aria-label="다음 이미지"
                                  >
                                    ›
                                  </button>
                                )}
                              </div>

                              {/* 이미지 인덱스 표시 + 썸네일 */}
                              {allImgUrls.length > 1 && (
                                <>
                                  <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "8px" }}>
                                    {curIdx + 1} / {allImgUrls.length}
                                  </div>
                                  <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                                    {allImgUrls.map((imgUrl, idx) => (
                                      <div
                                        key={idx}
                                        onClick={() => setActivePreviewPhotoUrl(imgUrl)}
                                        style={{
                                          width: "56px", height: "56px", borderRadius: "4px", overflow: "hidden",
                                          border: idx === curIdx ? "2px solid #62b19b" : "2px solid transparent",
                                          cursor: "pointer",
                                          opacity: idx === curIdx ? 1 : 0.55,
                                          transition: "all 0.2s",
                                        }}
                                      >
                                        <img
                                          src={imgUrl}
                                          alt={`이미지 ${idx + 1}`}
                                          style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (activePhoto.id) {
                                              openPhotoBookImageResize({
                                                url: imgUrl,
                                                photoBookId: activePhoto.id,
                                                imageIndex: idx,
                                                fileName: `photobook_${activePhoto.keyword || "photo"}_${idx + 1}.jpg`,
                                              });
                                            } else {
                                              openStorageImage(imgUrl, `photobook_${activePhoto.keyword || "photo"}_${idx + 1}.jpg`);
                                            }
                                          }}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </>
                              )}

                              {/* 현재 이미지 메모 + EXIF */}
                              {imgMemo && (
                                <div className="generalInfoDetailMediaMemo" style={{ marginTop: "12px", padding: "12px 16px", borderRadius: "10px", background: "rgba(98,177,155,0.12)", border: "1px solid rgba(98,177,155,0.3)" }}>
                                  <span className="generalInfoDetailMediaMemoIcon" style={{ fontSize: "22px", marginRight: "8px" }}>📝</span>
                                  <span className="generalInfoDetailMediaMemoText" style={{ fontSize: "18px", lineHeight: "1.7", fontWeight: "500" }}>{imgMemo}</span>
                                </div>
                              )}
                              {hasPhotoBookExif((activePhotoResolvedExifs || activePhoto.imageExifs || [])[curIdx]) && (
                                <div className="pbDetailExifInfo">
                                  {getPhotoBookExifViewLines((activePhotoResolvedExifs || activePhoto.imageExifs || [])[curIdx]).map((line) => (
                                    <span key={line}>{line}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        <div className="detail-meta-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", margin: "15px 0", background: "rgba(255,255,255,0.03)", padding: "10px", borderRadius: "8px" }}>
                          <div>
                            <strong style={{ color: "#62b19b" }}>🔑 키워드:</strong> <span style={{ fontSize: "15px", fontWeight: "bold" }}>#{activePhoto.keyword}</span>
                          </div>
                          <div>
                            <strong style={{ color: "#62b19b" }}>📂 2차 분류:</strong> <span style={{ fontSize: "15px", fontWeight: "bold" }}>{activePhoto.category2}</span>
                          </div>
                        </div>

                        <div className="detail-content-box" style={{ margin: "20px 0" }}>
                          <h4 style={{ margin: "0 0 8px 0", color: "#aaa", fontSize: "17px" }}>📝 메모 내용</h4>
                          <div style={{
                            background: "rgba(0,0,0,0.15)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: "8px",
                            padding: "18px",
                            fontSize: "22px",
                            lineHeight: "1.7",
                            wordBreak: "break-all",
                            whiteSpace: "pre-wrap",
                            maxHeight: isPhotoMemoExpanded ? "none" : "200px",
                            overflow: "hidden",
                            position: "relative"
                          }} className="infobook-card-memo">
                            {activePhoto.memoText || "입력된 메모가 없습니다."}
                            {!isPhotoMemoExpanded && activePhoto.memoText && activePhoto.memoText.length > 150 && (
                              <div style={{
                                position: "absolute",
                                bottom: 0,
                                left: 0,
                                right: 0,
                                height: "40px",
                                background: "linear-gradient(to top, rgba(15,23,42,0.95), transparent)",
                                pointerEvents: "none"
                              }} />
                            )}
                          </div>
                          {activePhoto.memoText && activePhoto.memoText.length > 150 && (
                            <button
                              type="button"
                              onClick={() => setIsPhotoMemoExpanded(!isPhotoMemoExpanded)}
                              style={{
                                width: "100%",
                                padding: "6px 0",
                                marginTop: "6px",
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: "6px",
                                color: "#62b19b",
                                fontSize: "12px",
                                fontWeight: "bold",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "4px"
                              }}
                            >
                              {isPhotoMemoExpanded ? "🔼 접기" : "🔽 메모 전체 보기 (펼치기)"}
                            </button>
                          )}
                        </div>

                        <div className="info-detail-actions no-print">
                          <button type="button" className="action-btn" onClick={() => { setActiveItem(null); setPhotoBookTab("index"); }} style={{ background: "rgba(255,255,255,0.08)", color: "#fff" }}>🏠 목록으로</button>
                          {(activePhoto.additionalImages?.length || 0) > 0 && (
                            <button
                              type="button"
                              className="action-btn"
                              onClick={() => openPhotoAlbumViewer(activePhoto, Math.max(0, [activePhoto.url, ...(activePhoto.additionalImages?.map((img: any) => img.url) || [])].indexOf(activePreviewPhotoUrl || activePhoto.url)))}
                            >
                              🖼️ 사진첩 보기
                            </button>
                          )}
                          <button type="button" className="action-btn" onClick={() => triggerEditPhotoBook(activePhoto!)}>✏️ 수정</button>
                          <button type="button" className="action-btn delete-btn" onClick={() => deletePhotoBookItem(activePhoto!.id!)}>🗑️ 삭제</button>
                          <button type="button" className="action-btn" onClick={() => copyPhotoBookToClipboard(activePhoto!)}>📋 복사</button>
                          <button type="button" className="action-btn" onClick={() => downloadPhotoBookAsTxt(activePhoto!)}>📥 TXT 다운로드</button>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="empty-state">정보를 불러올 수 없습니다.</div>
                  )
                ) : (
                  /* Creation Mode Form */
                  <div className="insta-view-container">
                    {/* Photo Book Create Form */}
                    <div className="insta-input-card" style={{ background: "transparent", border: "none", padding: 0 }}>
                      <h3 className="form-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "nowrap", gap: "10px" }}>
                        <span>📖 포토북 (Photo Book) 등록</span>
                        <span style={{ fontSize: "13px", color: "#ccc", fontWeight: "normal", display: "inline-flex", alignItems: "center", gap: "5px", whiteSpace: "nowrap" }}>
                          작성일자:
                          <input
                            type="date"
                            className="info-date-input"
                            min="2026-05-01"
                            max="2036-12-31"
                            value={photoBookInputDate}
                            onChange={e => setPhotoBookInputDate(e.target.value)}
                          />
                        </span>
                      </h3>

                      <div 
                        className="insta-paste-zone" 
                        onPaste={handlePhotoBookPasteZone} 
                        onDragOver={handleDragOver}
                        onDrop={handlePhotoBookDrop}
                        tabIndex={0}
                        style={{ minHeight: "120px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", border: "2px dashed rgba(255,255,255,0.15)", borderRadius: "10px", padding: "15px", background: "rgba(0,0,0,0.15)", outline: "none" }}
                      >
                        {photoBookInputImageUrls.length > 0 ? (
                          <div className="pbRegImageGrid">
                            {photoBookInputImageUrls.map((url, idx) => (
                              <div key={idx} className="pbRegImageCell">
                                <div className={`pbRegImageThumb ${idx === 0 ? "is-primary" : ""} ${pbMemoEditIdx === idx ? "is-editing" : ""}`}>
                                  <img
                                    src={url}
                                    alt={`미리보기 ${idx + 1}`}
                                    style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const pbId = editingPhotoBookItemId || "";
                                      if (pbId) {
                                        openPhotoBookImageResize({
                                          url,
                                          photoBookId: pbId,
                                          imageIndex: idx,
                                          fileName: `photobook_preview_${idx + 1}.jpg`,
                                        });
                                      } else {
                                        openStorageImage(url, `photobook_preview_${idx + 1}.jpg`);
                                      }
                                    }}
                                  />
                                  {photoBookInputImageMemos[idx] && pbMemoEditIdx !== idx && (
                                    <span className="pbRegThumbMemoBadge">{photoBookInputImageMemos[idx]}</span>
                                  )}
                                  <button 
                                    type="button" 
                                    className="remove-preview-btn" 
                                    title="이미지 삭제" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const nextUrls = [...photoBookInputImageUrls];
                                      const nextPaths = [...photoBookInputImageStoragePaths];
                                      const nextMemos = [...photoBookInputImageMemos];
                                      const nextExifs = [...photoBookInputImageExifs];
                                      nextUrls.splice(idx, 1);
                                      nextPaths.splice(idx, 1);
                                      nextMemos.splice(idx, 1);
                                      nextExifs.splice(idx, 1);
                                      setPhotoBookInputImageUrls(nextUrls);
                                      setPhotoBookInputImageStoragePaths(nextPaths);
                                      setPhotoBookInputImageMemos(nextMemos);
                                      setPhotoBookInputImageExifs(nextExifs);
                                      setPhotoBookInputImageUrl(nextUrls[0] || "");
                                      setPhotoBookInputImageStoragePath(nextPaths[0] || "");
                                      if (pbMemoEditIdx === idx) setPbMemoEditIdx(null);
                                    }}
                                    style={{ position: "absolute", top: "2px", right: "2px", background: "rgba(239, 68, 68, 0.8)", color: "#fff", border: "none", borderRadius: "50%", width: "18px", height: "18px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", cursor: "pointer" }}
                                  >×</button>
                                </div>
                                <button
                                  type="button"
                                  className="pbRegMemoToggle"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPbMemoEditIdx(pbMemoEditIdx === idx ? null : idx);
                                  }}
                                >
                                  {photoBookInputImageMemos[idx] ? "📝 메모" : "＋ 메모"}
                                </button>
                                {idx === 0 ? (
                                  <span style={{ fontSize: "10px", color: "#eab308", fontWeight: "bold", marginTop: "3px" }}>★ 대표</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      makePhotoBookRepresentative(idx);
                                    }}
                                    style={{
                                      marginTop: "3px",
                                      background: "rgba(234, 179, 8, 0.15)",
                                      color: "#facc15",
                                      border: "1px solid rgba(234, 179, 8, 0.4)",
                                      borderRadius: "4px",
                                      fontSize: "9px",
                                      padding: "1px 4px",
                                      cursor: "pointer",
                                      fontWeight: "bold"
                                    }}
                                  >
                                    ★ 대표 설정
                                  </button>
                                )}
                                {hasPhotoBookExif(photoBookInputImageExifs[idx]) && (
                                  <div className="pbPhotoExifCaption">
                                    {getPhotoBookExifViewLines(photoBookInputImageExifs[idx]).map((line) => (
                                      <span key={line}>{line}</span>
                                    ))}
                                  </div>
                                )}
                                {pbMemoEditIdx === idx && (
                                  <div
                                    className="pbRegMemoEditor"
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onPaste={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="text"
                                      className="pbRegMemoInput"
                                      value={photoBookInputImageMemos[idx] || ""}
                                      onChange={(e) => updatePhotoBookImageMemoAt(idx, e.target.value)}
                                      placeholder="개별 사진 메모 (최대 약 15자)"
                                      maxLength={40}
                                      autoFocus
                                    />
                                    <div className="pbRegMemoEditorActions">
                                      <button type="button" className="generalInfoMediaMemoBtnOk" onClick={() => setPbMemoEditIdx(null)}>✓ 완료</button>
                                      {photoBookInputImageMemos[idx] && (
                                        <button
                                          type="button"
                                          className="generalInfoMediaMemoBtnDelete"
                                          onClick={() => {
                                            updatePhotoBookImageMemoAt(idx, "");
                                            setPbMemoEditIdx(null);
                                          }}
                                        >✕ 삭제</button>
                                      )}
                                    </div>
                                  </div>
                                )}
                                {pbMemoEditIdx !== idx && photoBookInputImageMemos[idx] && (
                                  <div
                                    className="pbRegMemoDisplay"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPbMemoEditIdx(idx);
                                    }}
                                  >
                                    {photoBookInputImageMemos[idx]}
                                  </div>
                                )}
                              </div>
                            ))}
                            <label className="pbRegAddTile">
                              <span>➕ 추가</span>
                              <input
                                type="file"
                                accept=".heic,.heif,.jpg,.jpeg,.png,image/heic,image/heif,image/jpeg,image/png"
                                multiple
                                className="hidden-input"
                                style={{ display: "none" }}
                                onChange={async e => {
                                  const files = Array.from(e.target.files || []) as File[];
                                  if (files.length > 0) await handlePhotoBookImageUpload(files);
                                }}
                              />
                            </label>
                          </div>
                        ) : (
                          <div className="paste-placeholder">
                            <span className="icon">📖</span>
                            <p>여기에 이미지를 드롭하거나 복사-붙여넣기(Ctrl+V) 하세요. (여러 장 가능)</p>
                          </div>
                        )}
                      </div>

                      <div className="info-image-actions" style={{ display: "flex", gap: "10px", marginTop: "10px", flexWrap: "wrap" }}>
                        <label className="file-select-btn" style={{ margin: 0 }}>
                          📸 사진 가져오기
                          <input
                            type="file"
                            accept=".heic,.heif,.jpg,.jpeg,.png,image/heic,image/heif,image/jpeg,image/png"
                            multiple
                            className="hidden-input"
                            onChange={async e => {
                              const files = Array.from(e.target.files || []) as File[];
                              if (files.length > 0) await handlePhotoBookImageUpload(files);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="file-select-btn"
                          onClick={pastePhotoBookImageFromClipboard}
                          style={{ margin: 0 }}
                        >
                          📋 클립보드 붙여넣기
                        </button>
                      </div>

                      {/* 📱 아이폰 이미지/인스타 붙여넣기 존 */}
                      <div
                        className="generalInfoIphonePasteZone"
                        contentEditable
                        suppressContentEditableWarning
                        role="textbox"
                        tabIndex={0}
                        onPaste={async (e) => {
                          e.preventDefault();
                          const items = Array.from(e.clipboardData.items);
                          const files: File[] = [];
                          for (const item of items) {
                            if (item.kind === "file" && item.type.startsWith("image/")) {
                              const f = item.getAsFile();
                              if (f) files.push(f);
                            }
                          }
                          if (files.length > 0) {
                            await handlePhotoBookImageUpload(files);
                          } else {
                            const text = e.clipboardData.getData("text/plain") || e.clipboardData.getData("text/uri-list");
                            if (text.trim()) alert(`붙여넣기된 텍스트:\n${text.trim().slice(0, 100)}`);
                          }
                        }}
                        style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", padding: "12px", cursor: "pointer", marginTop: "8px" }}
                      >
                        <strong>📱 아이폰 이미지 / 인스타 링크 붙여넣기</strong>
                      </div>

                      <div className="input-group" style={{ marginTop: "15px" }}>
                        <label className="field-label">키워드 (1-2단어):</label>
                        <input
                          type="text"
                          className="info-title-input"
                          style={{
                            width: "100%",
                            padding: "10px",
                            borderRadius: "8px",
                            border: "1px solid rgba(255,255,255,0.15)",
                            background: "rgba(0,0,0,0.2)",
                            color: "#fff",
                            boxSizing: "border-box",
                            fontSize: "14px"
                          }}
                          placeholder="예: 가족, 바다, 일상"
                          value={photoBookInputKeyword}
                          onChange={e => setPhotoBookInputKeyword(e.target.value)}
                        />
                      </div>

                      <div className="input-group" style={{ marginTop: "15px" }}>
                        <label className="field-label">2차 분류 선택:</label>
                        <select
                          className="info-category-select"
                          style={{
                            width: "100%",
                            padding: "10px",
                            borderRadius: "8px",
                            border: "1px solid rgba(255,255,255,0.15)",
                            background: "rgba(0,0,0,0.2)",
                            color: "#fff",
                            fontSize: "14px"
                          }}
                          value={photoBookInputCategory2}
                          onChange={e => setPhotoBookInputCategory2(e.target.value)}
                        >
                          {photoCategories2.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>

                      <div className="input-group" style={{ marginTop: "15px" }}>
                        <label className="field-label">메모 내용:</label>
                        <textarea
                          className="info-text-textarea generalInfoFormattedTextView"
                          style={{
                            width: "100%",
                            minHeight: "200px",
                            maxHeight: "480px",
                            boxSizing: "border-box",
                            resize: "vertical"
                          }}
                          placeholder="사진에 관련된 메모나 일기 내용을 입력하세요."
                          value={photoBookInputMemo}
                          onChange={e => setPhotoBookInputMemo(e.target.value)}
                        />
                      </div>

                      <div className="index-preview-box" style={{ margin: "15px 0" }}>
                        <span className="preview-label">생성될 Index 형식:</span>
                        <span className="preview-value">#{photoBookInputKeyword.trim() || "keyword"}#{photoBookInputCategory2.trim() || "분류"}#{photoBookInputDate}</span>
                      </div>

                      <div style={{ position: "sticky", bottom: "70px", zIndex: 10, background: "rgba(10,18,32,0.92)", borderTop: "1px solid rgba(255,255,255,0.1)", padding: "12px 0", marginTop: "24px", marginBottom: "20px", backdropFilter: "blur(6px)" }}>
                        <button type="button" className="pill-btn save-btn" onClick={savePhotoBookItemForm} style={{ fontSize: "15px", padding: "12px 28px", fontWeight: "bold" }}>📖 포토북 저장</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* Index Tab: search + list */}
              {photoBookTab === "index" && (
              <div style={{ position: "relative" }}>
              {/* (Index tab content below — replaces right sidebar) */}
              <div style={{ position: "relative" }}>
                {/* Scroll to Top Button */}
                <button
                  type="button"
                  className="scroll-to-top-btn"
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  title="맨위로"
                >맨 위로 ↑</button>
                <input
                  type="text"
                  className="info-sidebar-search"
                  placeholder="키워드/분류/메모 검색..."
                  value={photoSearchKey}
                  onChange={e => setPhotoSearchKey(e.target.value)}
                />
                {/* 선택 액션 바 — 항목 선택 시 표시 */}
                {selectedPhotoBookIds.length > 0 && (
                  <div style={{
                    background: "rgba(98, 177, 155, 0.12)",
                    border: "1px solid rgba(98, 177, 155, 0.3)",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    marginBottom: "10px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "8px"
                  }}>
                    <span style={{ fontSize: "13px", fontWeight: "bold", color: "#62b19b" }}>
                      ☑️ 선택된 항목: {selectedPhotoBookIds.length}개
                    </span>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="pill-btn compact-pill"
                        style={{ background: "#62b19b", color: "#fff", border: "none", fontSize: "11px", padding: "4px 10px", borderRadius: "6px", cursor: "pointer" }}
                        onClick={() => setIsPhotoAlbumModalOpen(true)}
                      >🖼️ 포토앨범 & PDF</button>
                      <button
                        type="button"
                        className="pill-btn compact-pill"
                        style={{ background: "rgba(255,255,255,0.08)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.15)", fontSize: "11px", padding: "4px 10px", borderRadius: "6px", cursor: "pointer" }}
                        onClick={shareSelectedPhotoBookItems}
                      >🔗 공유하기</button>
                      <button
                        type="button"
                        className="pill-btn compact-pill"
                        style={{ background: "rgba(239, 68, 68, 0.12)", color: "#ef4444", border: "1px solid rgba(239, 68, 68, 0.3)", fontSize: "11px", padding: "4px 10px", borderRadius: "6px", cursor: "pointer" }}
                        onClick={() => setSelectedPhotoBookIds([])}
                      >✕ 선택 해제</button>
                    </div>
                  </div>
                )}
                {/* 체크박스 안내 */}
                <div style={{ fontSize: "10px", color: "#64748b", textAlign: "right", marginBottom: "6px", paddingRight: "4px" }}>
                  ☑️ 체크박스: 여러 항목 선택 후 포토앨범 보기 / PDF 저장 / 공유
                </div>
                <div className="pbIndexList">
                  {filteredPhotoBookItems.length === 0 ? (
                    <div className="empty-state">포토북 목록이 비어 있습니다.</div>
                  ) : (
                    filteredPhotoBookItems.map((photo, idx) => {
                      const isActive = activeItem?.type === "photobook" && activeItem?.id === photo.id;
                      const isSelected = selectedPhotoBookIds.includes(photo.id || "");
                      const isPinned = photo.isPinned || false;
                      const albumCount = 1 + (photo.additionalImages?.length || 0);
                      return (
                        <div
                          key={photo.id || idx}
                          className={`pbIndexCard ${isActive ? "active" : ""} ${isPinned ? "pbIndexCardPinned" : ""}`}
                        >
                          {/* ── 이미지 — 2fr (generalInfoCardThumbnail과 동일) ── */}
                          <div
                            className="pbIndexCardPhoto"
                            onClick={() => {
                              if (albumCount > 1) {
                                openPhotoAlbumViewer(photo, 0);
                              } else {
                                setActiveItem({ type: "photobook", id: photo.id || "" });
                                setPhotoBookTab("register");
                              }
                            }}
                          >
                            {isPinned && (
                              <div className="pbIndexCardPinBadge">📌</div>
                            )}
                            {albumCount > 1 && (
                              <div className="pbIndexCardAlbumBadge">🖼️ {albumCount}</div>
                            )}
                            {photo.url ? (
                              <img src={photo.url} alt={photo.keyword} />
                            ) : (
                              <div className="pbIndexCardPlaceholder">📖</div>
                            )}
                          </div>
                          {/* ── 키워드/날짜/분류 — 2fr (generalInfoCardContent와 동일) ── */}
                          <div
                            className="pbIndexCardInfo"
                            onClick={() => { setActiveItem({ type: "photobook", id: photo.id || "" }); setPhotoBookTab("register"); }}
                          >
                            <strong className="pbIndexCardKeyword">#{photo.keyword}</strong>
                            <p className="pbIndexCardDate">{photo.tag}</p>
                            <p className="pbIndexCardCategory">{photo.category2}</p>
                          </div>
                          {/* ── 버튼 — 1fr (generalInfoCardActions와 동일) ── */}
                          <div className="pbIndexCardActions">
                            <div className="pbIndexCardCheckbox">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  if (e.target.checked) {
                                    setSelectedPhotoBookIds([...selectedPhotoBookIds, photo.id || ""]);
                                  } else {
                                    setSelectedPhotoBookIds(selectedPhotoBookIds.filter(id => id !== photo.id));
                                  }
                                }}
                              />
                            </div>
                            {albumCount > 1 && (
                              <button
                                className="pbIndexCardBtnAlbum"
                                title="사진첩 보기"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPhotoAlbumViewer(photo, 0);
                                }}
                              >🖼️ 사진첩 보기</button>
                            )}
                            <button
                              className={`pbIndexCardBtnPin ${isPinned ? "active" : ""}`}
                              title={isPinned ? "상단 고정 해제" : "상단 고정"}
                              onClick={(e) => { e.stopPropagation(); togglePhotoBookPin(photo); }}
                            >{isPinned ? "📌 고정됨" : "📌 고정"}</button>
                            <button
                              className="pbIndexCardBtnEdit"
                              onClick={(e) => { e.stopPropagation(); triggerEditPhotoBook(photo); }}
                            >✏️ 수정</button>
                            <button
                              className="pbIndexCardBtnDetail"
                              onClick={(e) => { e.stopPropagation(); setActiveItem({ type: "photobook", id: photo.id || "" }); setPhotoBookTab("register"); }}
                            >상세보기</button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              </div>
              )}
            </div>
          )}
        </div>
      </section>
    );
  }


  return (
    <main className="app">
      {view === "calendar" && CalendarView()}
      {view === "diary" && DiaryView()}
      {view === "info" && InfoView()}
      {view === "schedule" && ScheduleView()}
      {view === "redDate" && RedDateView()}
      {view === "markDate" && MarkDateView()}
      {datePickerMode && (
        <div className="date-picker-modal" role="dialog" aria-modal="true" onClick={() => setDatePickerMode(null)}>
          <div className="date-picker-panel" onClick={event => event.stopPropagation()}>
            <h3>{datePickerMode === "diary" ? "일기장 날짜 선택" : "정보보관소 날짜 선택"}</h3>
            <input
              type="date"
              min="2026-05-01"
              max="2036-12-31"
              value={datePickerValue}
              onChange={event => setDatePickerValue(event.target.value)}
            />
            <div className="date-picker-actions">
              <button type="button" className="soft-btn" onClick={() => setDatePickerMode(null)}>취소</button>
              <button type="button" className="pill-btn" onClick={applyDatePicker}>이동</button>
            </div>
          </div>
        </div>
      )}
      {editingInfoTextCard && (
        <div className="info-text-card-edit-overlay" role="dialog" aria-modal="true" onClick={() => setEditingInfoTextCard(null)}>
          <div className="info-text-card-edit-panel" onClick={event => event.stopPropagation()}>
            <h3>글 카드 수정</h3>
            <textarea
              className="info-text-card-edit-textarea"
              value={editingInfoTextCard.content}
              onChange={event => setEditingInfoTextCard({ ...editingInfoTextCard, content: event.target.value })}
              placeholder="글 카드 내용을 수정하세요."
            />
            <div className="info-text-card-edit-actions">
              <button type="button" className="soft-btn" onClick={() => setEditingInfoTextCard(null)}>취소</button>
              <button type="button" className="pill-btn" onClick={saveEditingInfoTextCard}>수정 저장</button>
            </div>
          </div>
        </div>
      )}
      {selectedInfoPhotoMenu && (
        <div className="info-photo-menu-overlay" role="dialog" aria-modal="true" onClick={() => setSelectedInfoPhotoMenu(null)}>
          <div className="info-photo-menu-panel" onClick={event => event.stopPropagation()}>
            <h3>사진 작업 선택</h3>
            <p>{selectedInfoPhotoMenu.index + 1}번 사진</p>
            <div className="info-photo-menu-actions">
              <button
                type="button"
                className="soft-btn"
                onClick={() => void handleInfoPhotoMenuAction("view")}
              >
                전체화면 보기
              </button>
              
              <button
                type="button"
                className="soft-btn delete-btn"
                onClick={() => void handleInfoPhotoMenuAction("delete")}
              >
                사진 삭제
              </button>
              <button
                type="button"
                className="soft-btn"
                onClick={() => void handleInfoPhotoMenuAction("clearMemo")}
              >
                메모 삭제
              </button>
              <button
                type="button"
                className="soft-btn"
                onClick={() => void handleInfoPhotoMenuAction("editMemo")}
              >
                메모 입력/수정
              </button>
              <button
                type="button"
                className="soft-btn"
                onClick={() => void handleInfoPhotoMenuAction("prev")}
                disabled={selectedInfoPhotoMenu.index === 0}
              >
                ← 이전
              </button>
              <button
                type="button"
                className="soft-btn"
                onClick={() => void handleInfoPhotoMenuAction("next")}
                disabled={selectedInfoPhotoMenu.index >= ((infoPhotos[selectedInfoPhotoMenu.photoKey] || []).length - 1)}
              >
                다음 →
              </button>
              <button type="button" className="pill-btn" onClick={() => setSelectedInfoPhotoMenu(null)}>취소</button>
            </div>
          </div>
        </div>
      )}
      {photoAlbumViewer && (
        <div
          className="photo-album-viewer-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="사진첩 보기"
          onClick={closePhotoAlbumViewer}
        >
          <div className="photo-album-viewer-panel" onClick={(event) => event.stopPropagation()}>
            <div className="photo-album-viewer-header">
              <div>
                <strong>🖼️ 사진첩 보기</strong>
                <span>#{photoAlbumViewer.keyword}</span>
              </div>
              <div className="photo-album-viewer-header-actions">
                <span className="photo-album-viewer-counter">
                  {photoAlbumViewer.index + 1} / {photoAlbumViewer.urls.length}
                </span>
                <button type="button" className="original-close-btn" onClick={closePhotoAlbumViewer}>닫기</button>
              </div>
            </div>

            <div className="photo-album-viewer-stage">
              {photoAlbumViewer.urls.length > 1 && (
                <button
                  type="button"
                  className="photo-album-nav-btn left"
                  onClick={() => movePhotoAlbumViewer(-1)}
                  aria-label="이전 사진"
                >
                  ‹
                </button>
              )}
              <img
                src={photoAlbumViewer.urls[photoAlbumViewer.index]}
                alt={`사진첩 ${photoAlbumViewer.index + 1}`}
                className="photo-album-viewer-image"
                onClick={() => {
                  const url = photoAlbumViewer.urls[photoAlbumViewer.index];
                  if (photoAlbumViewer.photoBookId) {
                    openPhotoBookImageResize({
                      url,
                      photoBookId: photoAlbumViewer.photoBookId,
                      imageIndex: photoAlbumViewer.index,
                      fileName: `photobook_${photoAlbumViewer.keyword}_${photoAlbumViewer.index + 1}.jpg`,
                    });
                  } else {
                    openStorageImage(url, `photobook_${photoAlbumViewer.keyword}_${photoAlbumViewer.index + 1}.jpg`);
                  }
                }}
              />
              {photoAlbumViewer.urls.length > 1 && (
                <button
                  type="button"
                  className="photo-album-nav-btn right"
                  onClick={() => movePhotoAlbumViewer(1)}
                  aria-label="다음 사진"
                >
                  ›
                </button>
              )}
            </div>

            {photoAlbumViewer.memos[photoAlbumViewer.index] ? (
              <p className="photo-album-viewer-memo">📝 {photoAlbumViewer.memos[photoAlbumViewer.index]}</p>
            ) : null}

            {hasPhotoBookExif(photoAlbumViewer.exifs[photoAlbumViewer.index]) && (
              <div className="photo-album-viewer-exif">
                {getPhotoBookExifViewLines(photoAlbumViewer.exifs[photoAlbumViewer.index]).map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            )}

            <p className="photo-album-viewer-hint">사진을 클릭하면 확대하여 볼 수 있습니다 · ← → 키로 이동</p>

            {photoAlbumViewer.urls.length > 1 && (
              <div className="photo-album-viewer-thumbs">
                {photoAlbumViewer.urls.map((url, idx) => (
                  <button
                    key={`${url}-${idx}`}
                    type="button"
                    className={`photo-album-thumb ${idx === photoAlbumViewer.index ? "active" : ""}`}
                    onClick={() => setPhotoAlbumViewer((prev) => (prev ? { ...prev, index: idx } : prev))}
                    aria-label={`${idx + 1}번째 사진`}
                  >
                    <img src={url} alt={`썸네일 ${idx + 1}`} />
                    {photoAlbumViewer.memos[idx] ? (
                      <span className="photo-album-thumb-memo">{photoAlbumViewer.memos[idx]}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {originalImageUrl && (
        <div className="original-image-modal" role="dialog" aria-modal="true" onClick={closeOriginalImage}>
          <div className="original-image-panel" onClick={event => event.stopPropagation()}>
            <div className="original-modal-actions">
              {originalImageTarget?.type === "diary" && (
                <>
                  <button
                    type="button"
                    className="original-primary-btn"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (originalImageTarget) {
                        await setCalendarPhoto(originalImageTarget.photoKey, originalImageTarget.index);
                        closeOriginalImage();
                      }
                    }}
                  >
                    ★ 캘린더 대표 설정
                  </button>
                  <button type="button" className="original-delete-btn" onClick={deleteOriginalDiaryPhoto}>사진 삭제</button>
                </>
              )}
              {originalImageTarget?.type === "storage-image" && (
                <>
                  <button
                    type="button"
                    className="original-primary-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void downloadStorageImage();
                    }}
                  >
                    📥 사진 저장
                  </button>
                  <button type="button" className="original-close-btn" onClick={closeOriginalImage}>닫기</button>
                </>
              )}
              {originalImageTarget?.type === "photobook-resize" && (
                <>
                  {!photoCropMode ? (
                    <>
                      <div className="photo-resize-controls" onClick={(e) => e.stopPropagation()}>
                        <span className="photo-resize-label">크기 선택</span>
                        {([800, 1200, 1600, 2400] as const).map((size) => (
                          <button
                            key={size}
                            type="button"
                            className={`photo-resize-size-btn ${photoResizeMaxSide === size ? "active" : ""}`}
                            disabled={photoResizeBusy}
                            onClick={() => void previewPhotoBookResize(size)}
                          >
                            {size === 800 ? "작게" : size === 1200 ? "보통" : size === 1600 ? "크게" : "원본급"} ({size})
                          </button>
                        ))}
                      </div>
                      {photoResizeInfo && <p className="photo-resize-info">{photoResizeInfo}</p>}
                      <button
                        type="button"
                        className="original-primary-btn"
                        disabled={photoResizeBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          beginPhotoCropMode();
                        }}
                      >
                        ✂️ 잘라내기
                      </button>
                      <button
                        type="button"
                        className="original-primary-btn"
                        disabled={photoResizeBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void resizeAndResavePhotoBookImage();
                        }}
                      >
                        {photoResizeBusy ? "처리 중..." : "📖 크기 변경 후 포토북 저장"}
                      </button>
                      <button
                        type="button"
                        className="original-primary-btn"
                        disabled={photoResizeBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void downloadStorageImage();
                        }}
                      >
                        📥 사진 저장
                      </button>
                      <button type="button" className="original-close-btn" onClick={closeOriginalImage}>닫기</button>
                    </>
                  ) : (
                    <>
                      <div className="photo-resize-controls" onClick={(e) => e.stopPropagation()}>
                        <span className="photo-resize-label">비율</span>
                        {([
                          ["free", "자유"],
                          ["1:1", "1:1"],
                          ["4:3", "4:3"],
                          ["16:9", "16:9"],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={`photo-resize-size-btn ${photoCropAspect === value ? "active" : ""}`}
                            disabled={photoResizeBusy}
                            onClick={() => applyPhotoCropAspect(value)}
                          >
                            {label}
                          </button>
                        ))}
                        <span className="photo-resize-label">확대</span>
                        <button
                          type="button"
                          className="photo-resize-size-btn"
                          disabled={photoResizeBusy}
                          onClick={() => nudgePhotoCropZoom(-1)}
                        >
                          −
                        </button>
                        <button
                          type="button"
                          className="photo-resize-size-btn"
                          disabled={photoResizeBusy}
                          onClick={() => nudgePhotoCropZoom(1)}
                        >
                          +
                        </button>
                      </div>
                      {photoResizeInfo && <p className="photo-resize-info">{photoResizeInfo}</p>}
                      <button
                        type="button"
                        className="original-primary-btn"
                        disabled={photoResizeBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void cropAndResavePhotoBookImage();
                        }}
                      >
                        {photoResizeBusy ? "처리 중..." : "✂️ 잘라낸 후 포토북 저장"}
                      </button>
                      <button
                        type="button"
                        className="original-close-btn"
                        disabled={photoResizeBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPhotoCropMode(false);
                          setPhotoCropScale(1);
                          setPhotoCropPan({ x: 0, y: 0 });
                          setPhotoResizeInfo("");
                        }}
                      >
                        잘라내기 취소
                      </button>
                    </>
                  )}
                </>
              )}
              {originalImageTarget?.type !== "diary" && originalImageTarget?.type !== "storage-image" && originalImageTarget?.type !== "photobook-resize" && (
                <button type="button" className="original-close-btn" onClick={closeOriginalImage}>닫기</button>
              )}
              {originalImageTarget?.type === "diary" && (
                <button type="button" className="original-close-btn" onClick={closeOriginalImage}>닫기</button>
              )}
            </div>
            {photoCropMode && originalImageTarget?.type === "photobook-resize" ? (
              <div
                className="photo-crop-stage"
                ref={photoCropStageRef}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={onPhotoCropStagePointerDown}
                onWheel={onPhotoCropWheel}
              >
                <img
                  ref={photoCropImageRef}
                  src={originalImageUrl}
                  alt="잘라내기 원본"
                  className="photo-crop-source"
                  draggable={false}
                  onLoad={onPhotoCropImageLoad}
                  style={(() => {
                    const fit = getPhotoCropBaseFit(
                      photoCropStageSize.w > 0 ? photoCropStageSize : { w: 1, h: 1 },
                      photoCropNatural.w > 0 ? photoCropNatural : { w: 1, h: 1 }
                    );
                    return {
                      width: photoCropNatural.w > 0 ? fit.displayW : undefined,
                      height: photoCropNatural.w > 0 ? fit.displayH : undefined,
                      transform: `translate(-50%, -50%) translate(${photoCropPan.x}px, ${photoCropPan.y}px) scale(${photoCropScale})`,
                    };
                  })()}
                />
                {photoCropStageSize.w > 0 && (
                  <div className="photo-crop-layer">
                    <div
                      className="photo-crop-box"
                      style={{
                        left: `${photoCropRect.x * 100}%`,
                        top: `${photoCropRect.y * 100}%`,
                        width: `${photoCropRect.w * 100}%`,
                        height: `${photoCropRect.h * 100}%`,
                      }}
                      onPointerDown={(e) => {
                        if (e.pointerType === "touch") return;
                        startPhotoCropBoxDrag("crop-move", e);
                      }}
                    >
                      <span
                        className="photo-crop-handle nw"
                        onPointerDown={(e) => startPhotoCropBoxDrag("nw", e)}
                      />
                      <span
                        className="photo-crop-handle ne"
                        onPointerDown={(e) => startPhotoCropBoxDrag("ne", e)}
                      />
                      <span
                        className="photo-crop-handle sw"
                        onPointerDown={(e) => startPhotoCropBoxDrag("sw", e)}
                      />
                      <span
                        className="photo-crop-handle se"
                        onPointerDown={(e) => startPhotoCropBoxDrag("se", e)}
                      />
                    </div>
                  </div>
                )}
                <p className="photo-crop-hint">틀 드래그 · 바깥은 사진 이동 · 핀치/+− 로 확대</p>
              </div>
            ) : (
              <img src={photoResizePreviewUrl || originalImageUrl} alt="원본 사진" />
            )}
          </div>
        </div>
      )}
    
      {infoState.selectedGeneralInfoItem && (
        <GeneralInfoDetailModal
          item={infoState.selectedGeneralInfoItem}
          onClose={infoState.handleCloseGeneralInfoDetail}
          onGenerateReport={infoState.handleGenerateGeneralInfoReport}
          onDownloadPdfReport={infoState.handleDownloadGeneralInfoPdfReport}
          onEdit={infoState.handleStartEditGeneralInfo}
          onDelete={(item) => infoState.handleDeleteGeneralInfo(item.id)}
          onShareReport={infoState.handleShareGeneralInfoReport}
          onOpenStorageImage={openStorageImage}
          isGeneratingReport={infoState.isGeneratingGeneralInfoReport}
          isExportingPdf={infoState.isExportingGeneralInfoPdf}
          needsManualFactCheck={
            infoState.generalInfoManualFactCheckId === infoState.selectedGeneralInfoItem.id
          }
          startInEditMode={infoState.generalInfoDetailEditMode}
          onSaveItemEdit={infoState.handleSaveGeneralInfoDetailEdit}
          onSaveManualFactCheck={infoState.handleSaveManualFactCheck}
          onUploadInlineImage={infoState.uploadGeneralInfoInlineImageFile}
        />
      )}
  
</main>
  );
}
