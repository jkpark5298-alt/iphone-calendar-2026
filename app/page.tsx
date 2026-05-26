"use client";

import { ChangeEvent, ClipboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient";

type View = "calendar" | "diary" | "info" | "schedule" | "redDate";
type PhotoItem = {
  url: string;
  name: string;
  tag: string;
  extraTag?: string;
  memo?: string;
  size?: string;
  memoWidth?: string;
  memoHeight?: string;
  storagePath?: string;
  id?: string;
  isCalendarPhoto?: boolean;
};
type ScheduleColor = "yellow" | "blue" | "red" | "green" | "lightGreen" | "orange" | "navy" | "purple";
type OriginalImageTarget = { type: "diary"; photoKey: string; index: number } | null;
type ScheduleItem = {
  id: string;
  title: string;
  startTime: string;
  endDate: string;
  repeat: string;
  color: ScheduleColor;
};
type SearchResult = {
  type: "diary" | "info";
  entryDate: string;
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

const weekdays = ["??, "??, "??, "??, "紐?, "湲?, "??];
const weekdayLabels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const monthDays: Record<number, number> = { 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 };
const scheduleColorLabels: Record<ScheduleColor, string> = {
  yellow: "?몃???,
  blue: "?뚮???,
  red: "鍮④컙??,
  green: "珥덈줉??,
  lightGreen: "?뱀깋",
  orange: "二쇳솴??,
  navy: "?⑥깋",
  purple: "蹂대씪??,
};

const holidays: Record<string, string> = {
  "5-5": "?대┛?대궇",
  "5-24": "遺泥섎떂?ㅼ떊??,
  "5-25": "?泥닿났?댁씪",
  "6-3": "吏諛⑹꽑嫄?,
  "6-6": "?꾩땐??,
  "8-15": "愿묐났??,
  "8-17": "?泥닿났?댁씪",
  "9-24": "異붿꽍",
  "9-25": "異붿꽍",
  "9-26": "異붿꽍",
  "10-3": "媛쒖쿇??,
  "10-5": "?泥닿났?댁씪",
  "10-9": "?쒓???,
  "12-25": "?깊깂??,
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function key(month: number, day: number) {
  return `${month}-${day}`;
}

function tag(month: number, day: number) {
  return `#${pad(month)}/${pad(day)}#`;
}

function infoTag(month: number, day: number) {
  return `#?좎쭨(${pad(month)}/${pad(day)})#`;
}

function memoWithDateTag(memo: string | undefined, month: number, day: number) {
  const dateTag = tag(month, day);
  const currentMemo = memo || "";
  if (currentMemo.startsWith("#")) return currentMemo;
  if (currentMemo.trim()) return `${dateTag}${currentMemo}`;
  return dateTag;
}

function getWeekday(month: number, day: number) {
  return weekdays[new Date(2026, month - 1, day).getDay()];
}

function isSunday(month: number, day: number) {
  return new Date(2026, month - 1, day).getDay() === 0;
}

function isHoliday(month: number, day: number) {
  return Boolean(holidays[key(month, day)]);
}

function storageKey(type: string, month: number, day: number) {
  return `iphone-diary-2026-${type}-${pad(month)}-${pad(day)}`;
}

function weatherStorageKey(month: number, day: number) {
  return `iphone-diary-2026-weather-${pad(month)}-${pad(day)}`;
}

function entryDate(month: number, day: number) {
  return `2026-${pad(month)}-${pad(day)}`;
}

function monthDayFromEntryDate(value: string) {
  const match = String(value || "").match(/^2026-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 5 || month > 12 || day < 1 || day > (monthDays[month] || 31)) return null;
  return { month, day };
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
      <div className="auto-link-title">?뵕 ?먮룞 ?앹꽦 留곹겕</div>
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

function getSafeToday() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  if (year === 2026 && month >= 5 && month <= 12) {
    return { month, day };
  }

  return { month: 5, day: 24 };
}

export default function HomePage() {
  const todayDefault = useMemo(() => getSafeToday(), []);
  const [view, setView] = useState<View>("calendar");
  const [currentMonth, setCurrentMonth] = useState(todayDefault.month);
  const [currentDay, setCurrentDay] = useState(todayDefault.day);
  const [diaryText, setDiaryText] = useState("");
  const [voiceText, setVoiceText] = useState("");
  const [infoText, setInfoText] = useState("");
  const [photos, setPhotos] = useState<Record<string, PhotoItem[]>>({});
  const [infoPhotos, setInfoPhotos] = useState<Record<string, PhotoItem[]>>({});
  const [calendarPhotos, setCalendarPhotos] = useState<Record<string, string>>({});
  const [calendarPhotoIndexes, setCalendarPhotoIndexes] = useState<Record<string, number>>({});
  const [schedules, setSchedules] = useState<Record<string, ScheduleItem[]>>({});
  const [redDates, setRedDates] = useState<Record<number, number[]>>({});
  const [redDateInput, setRedDateInput] = useState("");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleStartTime, setScheduleStartTime] = useState("");
  const [scheduleEndDate, setScheduleEndDate] = useState("");
  const [scheduleRepeat, setScheduleRepeat] = useState("?놁쓬");
  const [scheduleColor, setScheduleColor] = useState<ScheduleColor>("yellow");
  const [audioUrl, setAudioUrl] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("?뱀쓬 ?뚯씪 ?놁쓬");
  const [lastAudioFile, setLastAudioFile] = useState<File | null>(null);
  const [weather, setWeather] = useState("議고쉶 以?);
  const [temp, setTemp] = useState("-");
  const [weatherTime, setWeatherTime] = useState("-");
  const [weatherSource, setWeatherSource] = useState("湲곗긽泥??곌껐 ?湲?);
  const [originalImageUrl, setOriginalImageUrl] = useState("");
  const [originalImageTarget, setOriginalImageTarget] = useState<OriginalImageTarget>(null);
  const [datePickerMode, setDatePickerMode] = useState<"diary" | "info" | null>(null);
  const [datePickerValue, setDatePickerValue] = useState(`2026-${pad(todayDefault.month)}-${pad(todayDefault.day)}`);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState("寃?됱뼱瑜??낅젰?섏꽭??");
  const [googleSchedules, setGoogleSchedules] = useState<GoogleScheduleItem[]>([]);
  const [googleScheduleStatus, setGoogleScheduleStatus] = useState("援ш? ?쇱젙 ?湲?);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const diaryTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const infoTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  function resizeTextareaToContent(element: HTMLTextAreaElement | null) {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight, 180)}px`;
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
        alert("?대┰蹂대뱶??遺숈씪 湲???놁뒿?덈떎.");
        return;
      }
      const nextText = diaryText ? `${diaryText}\n${text}` : text;
      saveDiary(nextText, voiceText);
      requestAnimationFrame(() => resizeTextareaToContent(diaryTextareaRef.current));
    } catch {
      alert("釉뚮씪?곗??먯꽌 ?대┰蹂대뱶 ?쎄린瑜??덉슜?섏? ?딆븯?듬땲?? ?낅젰移몄쓣 湲멸쾶 ?뚮윭 遺숈뿬?ｌ뼱 二쇱꽭??");
    }
  }

  async function pasteCopiedTextToInfo() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        alert("?대┰蹂대뱶??遺숈씪 湲???놁뒿?덈떎.");
        return;
      }
      const nextText = infoText ? `${infoText}\n${text}` : text;
      saveInfo(nextText);
      requestAnimationFrame(() => resizeTextareaToContent(infoTextareaRef.current));
    } catch {
      alert("釉뚮씪?곗??먯꽌 ?대┰蹂대뱶 ?쎄린瑜??덉슜?섏? ?딆븯?듬땲?? ?낅젰移몄쓣 湲멸쾶 ?뚮윭 遺숈뿬?ｌ뼱 二쇱꽭??");
    }
  }

  async function loadDiaryEntryFromSupabase(month: number, day: number) {
    if (!isSupabaseConfigured || !supabase) return null;

    const { data, error } = await supabase
      .from("diary_entries")
      .select("diary_text, voice_text, weather")
      .eq("entry_date", entryDate(month, day))
      .maybeSingle();

    if (error) {
      console.warn("Supabase diary load error:", error.message);
      return null;
    }

    return data as { diary_text?: string | null; voice_text?: string | null; weather?: any } | null;
  }

  async function loadInfoEntryFromSupabase(month: number, day: number) {
    if (!isSupabaseConfigured || !supabase) return null;

    const { data, error } = await supabase
      .from("info_entries")
      .select("info_text")
      .eq("entry_date", entryDate(month, day))
      .maybeSingle();

    if (error) {
      console.warn("Supabase info load error:", error.message);
      return null;
    }

    return data as { info_text?: string | null } | null;
  }


  function photoItemFromSupabaseRow(row: any, month: number, day: number): PhotoItem {
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

  async function loadDiaryPhotosFromSupabase(month: number, day: number) {
    if (!isSupabaseConfigured || !supabase) return null;

    const { data, error } = await supabase
      .from("diary_photos")
      .select("id, storage_path, public_url, sort_order, is_calendar_photo")
      .eq("entry_date", entryDate(month, day))
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("Supabase diary photo load error:", error.message);
      return null;
    }

    return (data || []).map(row => photoItemFromSupabaseRow(row, month, day));
  }

  async function loadInfoPhotosFromSupabase(month: number, day: number) {
    if (!isSupabaseConfigured || !supabase) return null;

    const { data, error } = await supabase
      .from("info_photos")
      .select("id, storage_path, public_url, caption, sort_order")
      .eq("entry_date", entryDate(month, day))
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("Supabase info photo load error:", error.message);
      return null;
    }

    return (data || []).map(row => photoItemFromSupabaseRow(row, month, day));
  }

  async function loadCalendarPhotosFromSupabase() {
    if (!isSupabaseConfigured || !supabase) return;

    const { data, error } = await supabase
      .from("diary_photos")
      .select("entry_date, public_url, sort_order")
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
      const month = Number(parts[1]);
      const day = Number(parts[2]);
      const photoKey = key(month, day);
      nextCalendarPhotos[photoKey] = row.public_url;
      nextCalendarPhotoIndexes[photoKey] = Number(row.sort_order || 0);
    });

    // Supabase ?ъ슜 ??罹섎┛????쒖궗吏꾨룄 ?쒕쾭媛믪쓣 湲곗??쇰줈 留욎땅?덈떎.
    // ?덉쟾 localStorage ??쒖궗吏꾩씠 ?⑥븘??湲곌린留덈떎 ?ㅻⅤ寃?蹂댁씠??臾몄젣瑜?以꾩엯?덈떎.
    setCalendarPhotos(nextCalendarPhotos);
    setCalendarPhotoIndexes(nextCalendarPhotoIndexes);
    setLocalStorageSafely("iphone-diary-2026-calendar-photos", JSON.stringify(nextCalendarPhotos));
    setLocalStorageSafely("iphone-diary-2026-calendar-photo-indexes", JSON.stringify(nextCalendarPhotoIndexes));
  }

  function saveDiaryEntryToSupabase(month: number, day: number, nextDiaryText: string, nextVoiceText: string) {
    if (!isSupabaseConfigured || !supabase) return;

    void supabase
      .from("diary_entries")
      .upsert(
        {
          entry_date: entryDate(month, day),
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

  function saveInfoEntryToSupabase(month: number, day: number, nextInfoText: string) {
    if (!isSupabaseConfigured || !supabase) return;

    void supabase
      .from("info_entries")
      .upsert(
        {
          entry_date: entryDate(month, day),
          info_text: nextInfoText,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "entry_date" }
      )
      .then(({ error }) => {
        if (error) console.warn("Supabase info save error:", error.message);
      });
  }

  function saveWeatherToSupabase(month: number, day: number, weatherData: Record<string, string>) {
    if (!isSupabaseConfigured || !supabase) return;

    void supabase
      .from("diary_entries")
      .upsert(
        {
          entry_date: entryDate(month, day),
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
      setSearchStatus("寃?됱뼱瑜??낅젰?섏꽭??");
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setSearchResults([]);
      setSearchStatus("Supabase ?곌껐 ??寃?됲븷 ???덉뒿?덈떎.");
      return;
    }

    setSearchStatus("寃??以?..");
    const pattern = `%${keyword}%`;

    const [diaryRes, infoRes, infoMemoRes] = await Promise.all([
      supabase
        .from("diary_entries")
        .select("entry_date, diary_text, voice_text")
        .or(`diary_text.ilike.${pattern},voice_text.ilike.${pattern}`)
        .order("entry_date", { ascending: true }),
      supabase
        .from("info_entries")
        .select("entry_date, info_text")
        .ilike("info_text", pattern)
        .order("entry_date", { ascending: true }),
      supabase
        .from("info_photos")
        .select("entry_date, caption")
        .ilike("caption", pattern)
        .order("entry_date", { ascending: true }),
    ]);

    const errors = [diaryRes.error, infoRes.error, infoMemoRes.error].filter(Boolean);
    if (errors.length) {
      console.warn("Supabase search error:", errors.map(error => error?.message).join(" / "));
      setSearchResults([]);
      setSearchStatus("寃??以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
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
        month: date.month,
        day: date.day,
        text: text || "?쇨린??寃??寃곌낵",
      });
    });

    (infoRes.data || []).forEach((row: any) => {
      const date = monthDayFromEntryDate(row.entry_date);
      if (!date) return;
      nextResults.push({
        type: "info",
        entryDate: row.entry_date,
        month: date.month,
        day: date.day,
        text: row.info_text || "?뺣낫蹂닿???寃??寃곌낵",
      });
    });

    (infoMemoRes.data || []).forEach((row: any) => {
      const date = monthDayFromEntryDate(row.entry_date);
      if (!date) return;
      nextResults.push({
        type: "info",
        entryDate: row.entry_date,
        month: date.month,
        day: date.day,
        text: row.caption || "?뺣낫蹂닿????ъ쭊 硫붾え 寃??寃곌낵",
      });
    });

    Object.entries(schedules).forEach(([scheduleKey, items]) => {
      const [monthText, dayText] = scheduleKey.split("-");
      const month = Number(monthText);
      const day = Number(dayText);
      if (!month || !day) return;

      items.forEach(item => {
        const scheduleText = `${item.startTime ? `${item.startTime} ` : ""}${item.title}`;
        const searchText = [scheduleText, item.repeat, item.endDate].filter(Boolean).join(" / ");
        if (!searchText.toLowerCase().includes(keyword.toLowerCase())) return;

        nextResults.push({
          type: "diary",
          entryDate: entryDate(month, day),
          month,
          day,
          text: `罹섎┛???쇱젙 쨌 ${scheduleText}`,
        });
      });
    });

    googleSchedules.forEach(item => {
      const googleText = [item.title, item.start, item.end, item.allDay ? "醫낆씪" : ""].filter(Boolean).join(" / ");
      if (!googleText.toLowerCase().includes(keyword.toLowerCase())) return;

      nextResults.push({
        type: "diary",
        entryDate: entryDate(currentMonth, currentDay),
        month: currentMonth,
        day: currentDay,
        text: `援ш? ?쇱젙 쨌 ${item.allDay ? "醫낆씪" : item.start || "?쒓컙 ?놁쓬"} ${item.title}`,
      });
    });

    const unique = new Map<string, SearchResult>();
    nextResults.forEach(result => {
      const uniqueKey = `${result.type}-${result.entryDate}-${result.text.slice(0, 40)}`;
      if (!unique.has(uniqueKey)) unique.set(uniqueKey, result);
    });

    const results = Array.from(unique.values()).slice(0, 30);
    setSearchResults(results);
    setSearchStatus(results.length ? `${results.length}媛?寃??寃곌낵` : "寃??寃곌낵媛 ?놁뒿?덈떎.");
  }

  async function loadGoogleSchedulesForDay(month: number, day: number) {
    setGoogleScheduleStatus("援ш? ?쇱젙 議고쉶 以?);
    setGoogleSchedules([]);

    try {
      const response = await fetch(`/api/google-calendar?date=${entryDate(month, day)}`, { cache: "no-store" });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.message || "google calendar error");
      }

      const items = Array.isArray(data.items) ? data.items : [];
      setGoogleSchedules(items);
      setGoogleScheduleStatus(items.length ? `${items.length}媛??쇱젙` : "援ш? ?쇱젙 ?놁쓬");
    } catch (error) {
      console.warn("Google calendar load error:", error instanceof Error ? error.message : error);
      setGoogleSchedules([]);
      setGoogleScheduleStatus("援ш? ?쇱젙 ?곌껐 ?꾩슂");
    }
  }


  useEffect(() => {
    try {
      const rawCalendar = localStorage.getItem("iphone-diary-2026-calendar-photos");
      if (rawCalendar) setCalendarPhotos(JSON.parse(rawCalendar));
      const rawCalendarIndexes = localStorage.getItem("iphone-diary-2026-calendar-photo-indexes");
      if (rawCalendarIndexes) setCalendarPhotoIndexes(JSON.parse(rawCalendarIndexes));
      const rawSchedules = localStorage.getItem("iphone-calendar-2026-schedules");
      if (rawSchedules) setSchedules(JSON.parse(rawSchedules));
      const rawRedDates = localStorage.getItem("iphone-calendar-2026-red-dates");
      if (rawRedDates) setRedDates(JSON.parse(rawRedDates));
    } catch {
      setCalendarPhotos({});
    }

    void loadCalendarPhotosFromSupabase();
  }, []);

  useEffect(() => {
    if (view !== "diary") return;

    let isActive = true;
    const photoKey = key(currentMonth, currentDay);

    // Supabase媛 ?ㅼ젙???곹깭?먯꽌???쒕쾭 ?곗씠?곕? ?곗꽑?⑸땲??
    // ?덉쟾 localStorage ?곗씠?곌? 湲곌린留덈떎 ?щ씪???꾩씠??PC媛 ?ㅻⅤ寃?蹂댁씠??臾몄젣瑜?諛⑹??⑸땲??
    if (isSupabaseConfigured && supabase) {
      setDiaryText("");
      setVoiceText("");
      setPhotos(prev => ({ ...prev, [photoKey]: [] }));
    } else {
      try {
        const raw = localStorage.getItem(storageKey("diary", currentMonth, currentDay));
        const data = raw ? JSON.parse(raw) : {};
        setDiaryText(data.diaryText || "");
        setVoiceText(data.voiceText || "");

        const rawPhotos = localStorage.getItem(storageKey("photos", currentMonth, currentDay));
        const items = rawPhotos ? JSON.parse(rawPhotos) : [];
        setPhotos(prev => ({ ...prev, [photoKey]: items }));

        const rawWeather = localStorage.getItem(weatherStorageKey(currentMonth, currentDay));
        if (rawWeather) {
          const cachedWeather = JSON.parse(rawWeather);
          setWeather(cachedWeather.weather || "?뺤씤 ?꾩슂");
          setTemp(cachedWeather.temperature || "-");
          setWeatherTime(cachedWeather.observedAt || "-");
          setWeatherSource(cachedWeather.source || "湲곗긽泥?);
        }
      } catch {
        setDiaryText("");
        setVoiceText("");
      }
    }

    loadDiaryEntryFromSupabase(currentMonth, currentDay).then(remoteData => {
      if (!isActive) return;

      const remoteDiaryText = remoteData?.diary_text || "";
      const remoteVoiceText = remoteData?.voice_text || "";
      setDiaryText(remoteDiaryText);
      setVoiceText(remoteVoiceText);
      localStorage.setItem(
        storageKey("diary", currentMonth, currentDay),
        JSON.stringify({ diaryText: remoteDiaryText, voiceText: remoteVoiceText })
      );

      const remoteWeather = remoteData?.weather;
      if (remoteWeather && typeof remoteWeather === "object") {
        setWeather(remoteWeather.weather || "?뺤씤 ?꾩슂");
        setTemp(remoteWeather.temperature || "-");
        setWeatherTime(remoteWeather.observedAt || "-");
        setWeatherSource(remoteWeather.source || "湲곗긽泥?);
        localStorage.setItem(weatherStorageKey(currentMonth, currentDay), JSON.stringify(remoteWeather));
      }
    });

    loadDiaryPhotosFromSupabase(currentMonth, currentDay).then(remoteItems => {
      if (!isActive || !remoteItems) return;

      setPhotos(prev => ({ ...prev, [photoKey]: remoteItems }));
      setLocalStorageSafely(storageKey("photos", currentMonth, currentDay), JSON.stringify(remoteItems));

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
    void loadGoogleSchedulesForDay(currentMonth, currentDay);

    return () => {
      isActive = false;
    };
  }, [view, currentMonth, currentDay]);

  useEffect(() => {
    if (view !== "info") return;

    let isActive = true;
    const photoKey = key(currentMonth, currentDay);

    if (isSupabaseConfigured && supabase) {
      setInfoText("");
      setInfoPhotos(prev => ({ ...prev, [photoKey]: [] }));
    } else {
      try {
        const raw = localStorage.getItem(storageKey("info", currentMonth, currentDay));
        const data = raw ? JSON.parse(raw) : {};
        setInfoText(data.infoText || "");

        const rawInfoPhotos = localStorage.getItem(storageKey("infoPhotos", currentMonth, currentDay));
        const items = rawInfoPhotos ? JSON.parse(rawInfoPhotos) : [];
        setInfoPhotos(prev => ({ ...prev, [photoKey]: items }));
      } catch {
        setInfoText("");
      }
    }

    loadInfoEntryFromSupabase(currentMonth, currentDay).then(remoteData => {
      if (!isActive) return;

      const remoteInfoText = remoteData?.info_text || "";
      setInfoText(remoteInfoText);
      localStorage.setItem(storageKey("info", currentMonth, currentDay), JSON.stringify({ infoText: remoteInfoText }));
    });

    loadInfoPhotosFromSupabase(currentMonth, currentDay).then(remoteItems => {
      if (!isActive || !remoteItems) return;

      setInfoPhotos(prev => ({ ...prev, [photoKey]: remoteItems }));
      setLocalStorageSafely(storageKey("infoPhotos", currentMonth, currentDay), JSON.stringify(remoteItems));
    });

    return () => {
      isActive = false;
    };
  }, [view, currentMonth, currentDay]);

  useEffect(() => {
    if (view !== "diary") return;
    requestAnimationFrame(() => resizeTextareaToContent(diaryTextareaRef.current));
  }, [view, diaryText, currentMonth, currentDay]);

  useEffect(() => {
    if (view !== "info") return;
    requestAnimationFrame(() => resizeTextareaToContent(infoTextareaRef.current));
  }, [view, infoText, currentMonth, currentDay]);

  async function fetchWeatherFromKma() {
    setWeather("議고쉶 以?);
    setTemp("-");
    setWeatherSource("湲곗긽泥?議고쉶 以?);

    try {
      const response = await fetch("/api/weather", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.message || "weather error");
      }

      const nextTemperature = data.temperature
        ? String(data.temperature).includes("??)
          ? String(data.temperature)
          : `${data.temperature}??
        : "-";
      const nextWeather = data.weather || "?뺤씤 ?꾩슂";
      const nextObservedAt = data.observedAt || new Date().toLocaleString("ko-KR");

      setWeather(nextWeather);
      setTemp(nextTemperature);
      setWeatherTime(nextObservedAt);
      const weatherSnapshot = { weather: nextWeather, temperature: nextTemperature, observedAt: nextObservedAt, source: "湲곗긽泥? };

      setWeatherSource("湲곗긽泥?);
      localStorage.setItem(weatherStorageKey(currentMonth, currentDay), JSON.stringify(weatherSnapshot));
      saveWeatherToSupabase(currentMonth, currentDay, weatherSnapshot);
    } catch {
      setWeather("湲곗긽泥??곌껐 ?꾩슂");
      setTemp("-");
      setWeatherTime(new Date().toLocaleString("ko-KR"));
      setWeatherSource("KMA_SERVICE_KEY ?꾩슂");
    }
  }

  function openCalendar(month = currentMonth) {
    setCurrentMonth(month);
    setView("calendar");
  }

  function openDiary(month: number, day: number) {
    setCurrentMonth(month);
    setCurrentDay(day);
    setView("diary");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openInfo(month: number, day: number) {
    setCurrentMonth(month);
    setCurrentDay(day);
    setView("info");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openSchedule(month: number, day: number) {
    setCurrentMonth(month);
    setCurrentDay(day);
    setScheduleTitle("");
    setScheduleStartTime("");
    setScheduleEndDate(`2026-${pad(month)}-${pad(day)}`);
    setScheduleRepeat("?놁쓬");
    setScheduleColor("yellow");
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
      .filter(value => Number.isInteger(value) && value >= 1 && value <= monthDays[currentMonth]);

    const uniqueDays = Array.from(new Set<number>(parsedDays)).sort((a: number, b: number) => a - b);
    const nextRedDates = { ...redDates, [currentMonth]: uniqueDays };
    setRedDates(nextRedDates);
    setRedDateInput(uniqueDays.join(", "));
    localStorage.setItem("iphone-calendar-2026-red-dates", JSON.stringify(nextRedDates));
    alert(uniqueDays.length ? `${currentMonth}??${uniqueDays.join(", ")}?쇱쓣 鍮④컙 ?좎쭨濡???ν뻽?듬땲??` : `${currentMonth}??鍮④컙 ?좎쭨瑜?紐⑤몢 ?댁젣?덉뒿?덈떎.`);
    setView("calendar");
  }

  function moveToTodayOnCalendar() {
    const today = getSafeToday();
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
      openDiary(month, day);
      return;
    }

    openDiary(5, 24);
  }

  function openDatePicker(mode: "diary" | "info") {
    setDatePickerMode(mode);
    setDatePickerValue(`2026-${pad(currentMonth)}-${pad(currentDay)}`);
  }

  function applyDatePicker() {
    if (!datePickerMode) return;
    const match = datePickerValue.match(/^2026-(\d{2})-(\d{2})$/);
    if (!match) {
      alert("2026??5??12???좎쭨瑜??좏깮??二쇱꽭??");
      return;
    }

    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 5 || month > 12 || day < 1 || day > monthDays[month]) {
      alert("2026??5??12??踰붿쐞 ?덉쓽 ?좎쭨瑜??좏깮??二쇱꽭??");
      return;
    }

    setDatePickerMode(null);
    if (datePickerMode === "diary") openDiary(month, day);
    if (datePickerMode === "info") openInfo(month, day);
  }

  function saveDiary(nextDiaryText: string, nextVoiceText: string) {
    setDiaryText(nextDiaryText);
    setVoiceText(nextVoiceText);
    localStorage.setItem(
      storageKey("diary", currentMonth, currentDay),
      JSON.stringify({ diaryText: nextDiaryText, voiceText: nextVoiceText })
    );
    saveDiaryEntryToSupabase(currentMonth, currentDay, nextDiaryText, nextVoiceText);
  }

  function saveInfo(nextInfoText: string) {
    setInfoText(nextInfoText);
    localStorage.setItem(storageKey("info", currentMonth, currentDay), JSON.stringify({ infoText: nextInfoText }));
    saveInfoEntryToSupabase(currentMonth, currentDay, nextInfoText);
  }

  function saveInfoPhotos(month: number, day: number, nextPhotos: PhotoItem[]) {
    setLocalStorageSafely(storageKey("infoPhotos", month, day), JSON.stringify(nextPhotos));
  }


  function readImageFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("?대?吏 ?뚯씪???쎌? 紐삵뻽?듬땲??"));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("?대?吏瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??"));
      image.src = dataUrl;
    });
  }

  async function makeImageDataUrl(dataUrl: string, maxSide = 1000, quality = 0.68) {
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
      return optimized.length < dataUrl.length ? optimized : dataUrl;
    } catch {
      return dataUrl;
    }
  }

  async function makeOptimizedImageDataUrl(file: File) {
    const originalDataUrl = await readImageFileAsDataUrl(file);
    if (!file.type.startsWith("image/")) return originalDataUrl;
    return makeImageDataUrl(originalDataUrl, 720, 0.62);
  }

  async function makeCalendarThumbDataUrl(dataUrl: string) {
    return makeImageDataUrl(dataUrl, 420, 0.7);
  }

  function setLocalStorageSafely(storageName: string, value: string) {
    try {
      localStorage.setItem(storageName, value);
      return true;
    } catch {
      alert("?ъ쭊 ???怨듦컙??遺議깊빀?덈떎. ?ъ쭊 ?섎? 以꾩씠嫄곕굹 湲곗〈 ?ъ쭊????젣?????ㅼ떆 ?쒕룄??二쇱꽭??");
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

  async function uploadPhotoToSupabase(file: File, bucket: "diary-photos" | "info-photos", month: number, day: number, sortOrder: number) {
    if (!isSupabaseConfigured || !supabase) return null;

    try {
      const optimizedDataUrl = await makeOptimizedImageDataUrl(file);
      const blob = dataUrlToBlob(optimizedDataUrl);
      const folder = `${entryDate(month, day)}`;
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
        tag: tag(month, day),
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

  async function saveDiaryPhotoRecordToSupabase(month: number, day: number, item: PhotoItem, sortOrder: number, isCalendarPhoto = false) {
    if (!isSupabaseConfigured || !supabase || !item.storagePath) return;

    const { error } = await supabase.from("diary_photos").insert({
      entry_date: entryDate(month, day),
      storage_path: item.storagePath,
      public_url: item.url,
      sort_order: sortOrder,
      is_calendar_photo: isCalendarPhoto,
    });

    if (error) console.warn("Supabase diary photo record error:", error.message);
  }

  async function saveInfoPhotoRecordToSupabase(month: number, day: number, item: PhotoItem, sortOrder: number) {
    if (!isSupabaseConfigured || !supabase || !item.storagePath) return;

    const { error } = await supabase.from("info_photos").insert({
      entry_date: entryDate(month, day),
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

    const k = key(currentMonth, currentDay);
    const previousItems = infoPhotos[k] || [];
    const newItems: PhotoItem[] = [];

    for (const [offset, file] of files.entries()) {
      const sortOrder = previousItems.length + offset;
      const uploadedItem = await uploadPhotoToSupabase(file, "info-photos", currentMonth, currentDay, sortOrder);

      if (uploadedItem) {
        newItems.push(uploadedItem);
        await saveInfoPhotoRecordToSupabase(currentMonth, currentDay, uploadedItem, sortOrder);
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

  async function pasteInfoPhotoFromClipboard() {
    try {
      const clipboard = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };
      if (!clipboard.read) {
        alert("??釉뚮씪?곗??먯꽌???대?吏 遺숈뿬?ｊ린瑜?吏?먰븯吏 ?딆뒿?덈떎. ?ъ쭊 媛?몄삤湲곕? ?ъ슜??二쇱꽭??");
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
        alert("?대┰蹂대뱶??遺숈뿬?ｌ쓣 ?대?吏媛 ?놁뒿?덈떎.");
        return;
      }

      await saveInfoPhotoFiles(files);
    } catch {
      alert("?꾩씠??Safari?먯꽌???대?吏 遺숈뿬?ｊ린媛 ?쒗븳?????덉뒿?덈떎. ?ъ쭊 媛?몄삤湲곕? ?ъ슜??二쇱꽭??");
    }
  }

  async function deleteInfoPhoto(k: string, index: number) {
    const items = infoPhotos[k] || [];
    if (!items[index]) return;

    const deletingItem = items[index];
    const nextPhotosForDay = items.filter((_, itemIndex) => itemIndex !== index);
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const [month, day] = k.split("-").map(Number);
    saveInfoPhotos(month, day, nextPhotosForDay);
    await deleteSupabasePhoto("info-photos", "info_photos", deletingItem.storagePath);
  }

  function updateInfoPhotoExtraTag(k: string, index: number, extraTag: string) {
    const items = infoPhotos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, extraTag } : item
    );
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const [month, day] = k.split("-").map(Number);
    saveInfoPhotos(month, day, nextPhotosForDay);
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
    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, memo: normalizedMemo } : item
    );
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const [month, day] = k.split("-").map(Number);
    saveInfoPhotos(month, day, nextPhotosForDay);
    saveInfoPhotoMemoToSupabase(currentItem, normalizedMemo);
  }


  function updateInfoPhotoSize(k: string, index: number, size: string) {
    const items = infoPhotos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, size } : item
    );
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const [month, day] = k.split("-").map(Number);
    saveInfoPhotos(month, day, nextPhotosForDay);
  }


  function updateInfoPhotoMemoFrame(k: string, index: number, memoWidth: string, memoHeight: string) {
    const items = infoPhotos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, memoWidth, memoHeight } : item
    );
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const [month, day] = k.split("-").map(Number);
    saveInfoPhotos(month, day, nextPhotosForDay);
  }

  function updateDiaryPhotoExtraTag(k: string, index: number, extraTag: string) {
    const items = photos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, extraTag } : item
    );
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    setPhotos(nextPhotos);
    const [month, day] = k.split("-").map(Number);
    savePhotos(month, day, nextPhotosForDay, calendarPhotos);
  }

  function updateDiaryPhotoMemo(k: string, index: number, memo: string) {
    const items = photos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, memo } : item
    );
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    setPhotos(nextPhotos);
    const [month, day] = k.split("-").map(Number);
    savePhotos(month, day, nextPhotosForDay, calendarPhotos);
  }

  function updateDiaryPhotoSize(k: string, index: number, size: string) {
    const items = photos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, size } : item
    );
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    setPhotos(nextPhotos);
    const [month, day] = k.split("-").map(Number);
    savePhotos(month, day, nextPhotosForDay, calendarPhotos);
  }


  function updateDiaryPhotoMemoFrame(k: string, index: number, memoWidth: string, memoHeight: string) {
    const items = photos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, memoWidth, memoHeight } : item
    );
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    setPhotos(nextPhotos);
    const [month, day] = k.split("-").map(Number);
    savePhotos(month, day, nextPhotosForDay, calendarPhotos);
  }


  function updateDiaryPhotoCardFrame(k: string, index: number, size: string, memoHeight: string) {
    const items = photos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, size, memoWidth: size, memoHeight } : item
    );
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    setPhotos(nextPhotos);
    const [month, day] = k.split("-").map(Number);
    savePhotos(month, day, nextPhotosForDay, calendarPhotos);
  }

  function updateInfoPhotoCardFrame(k: string, index: number, size: string, memoHeight: string) {
    const items = infoPhotos[k] || [];
    if (!items[index]) return;

    const nextPhotosForDay = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, size, memoWidth: size, memoHeight } : item
    );
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const [month, day] = k.split("-").map(Number);
    saveInfoPhotos(month, day, nextPhotosForDay);
  }


  function moveDiaryPhoto(k: string, index: number, direction: -1 | 1) {
    const items = photos[k] || [];
    const targetIndex = index + direction;
    if (!items[index] || targetIndex < 0 || targetIndex >= items.length) return;

    const nextPhotosForDay = [...items];
    [nextPhotosForDay[index], nextPhotosForDay[targetIndex]] = [nextPhotosForDay[targetIndex], nextPhotosForDay[index]];
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    setPhotos(nextPhotos);
    const [month, day] = k.split("-").map(Number);
    savePhotos(month, day, nextPhotosForDay, calendarPhotos);
  }

  function moveInfoPhoto(k: string, index: number, direction: -1 | 1) {
    const items = infoPhotos[k] || [];
    const targetIndex = index + direction;
    if (!items[index] || targetIndex < 0 || targetIndex >= items.length) return;

    const nextPhotosForDay = [...items];
    [nextPhotosForDay[index], nextPhotosForDay[targetIndex]] = [nextPhotosForDay[targetIndex], nextPhotosForDay[index]];
    const nextInfoPhotos = { ...infoPhotos, [k]: nextPhotosForDay };
    setInfoPhotos(nextInfoPhotos);
    const [month, day] = k.split("-").map(Number);
    saveInfoPhotos(month, day, nextPhotosForDay);
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
  }

  function addSchedule() {
    const trimmedTitle = scheduleTitle.trim();
    if (!trimmedTitle) {
      alert("?쇱젙 ?쒕ぉ???낅젰??二쇱꽭??");
      return;
    }

    const k = key(currentMonth, currentDay);
    const newSchedule: ScheduleItem = {
      id: `${Date.now()}`,
      title: trimmedTitle,
      startTime: scheduleStartTime,
      endDate: scheduleEndDate,
      repeat: scheduleRepeat,
      color: scheduleColor,
    };
    const nextSchedules = { ...schedules, [k]: [...(schedules[k] || []), newSchedule] };
    saveSchedules(nextSchedules);
    setScheduleTitle("");
    setScheduleStartTime("");
    setScheduleRepeat("?놁쓬");
    alert("?쇱젙????λ릺?덉뒿?덈떎.");
  }

  function deleteSchedule(scheduleId: string) {
    const k = key(currentMonth, currentDay);
    const nextForDay = (schedules[k] || []).filter(item => item.id !== scheduleId);
    const nextSchedules = { ...schedules, [k]: nextForDay };
    saveSchedules(nextSchedules);
  }

  function savePhotos(month: number, day: number, nextPhotos: PhotoItem[], nextCalendarPhotos: Record<string, string>, nextCalendarPhotoIndexes = calendarPhotoIndexes) {
    const okPhotos = setLocalStorageSafely(storageKey("photos", month, day), JSON.stringify(nextPhotos));
    const okCalendar = setLocalStorageSafely("iphone-diary-2026-calendar-photos", JSON.stringify(nextCalendarPhotos));
    const okIndexes = setLocalStorageSafely("iphone-diary-2026-calendar-photo-indexes", JSON.stringify(nextCalendarPhotoIndexes));
    return okPhotos && okCalendar && okIndexes;
  }

  async function savePhotoFiles(files: File[]) {
    if (!files.length) return;

    const k = key(currentMonth, currentDay);
    const previousItems = photos[k] || [];
    const newItems: PhotoItem[] = [];

    for (const [offset, file] of files.entries()) {
      const sortOrder = previousItems.length + offset;
      const uploadedItem = await uploadPhotoToSupabase(file, "diary-photos", currentMonth, currentDay, sortOrder);

      if (uploadedItem) {
        newItems.push(uploadedItem);
        await saveDiaryPhotoRecordToSupabase(currentMonth, currentDay, uploadedItem, sortOrder, previousItems.length === 0 && offset === 0);
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
    savePhotos(currentMonth, currentDay, nextPhotosForDay, nextCalendarPhotos, nextCalendarPhotoIndexes);
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
    const [month, day] = k.split("-").map(Number);
    savePhotos(month, day, items, nextCalendarPhotos, nextCalendarPhotoIndexes);

    if (isSupabaseConfigured && supabase && items[index].storagePath) {
      const targetDate = entryDate(month, day);
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

    alert("?좏깮???ъ쭊???붽컙 罹섎┛?붿뿉 遺숈??듬땲??");
  }

  function openCalendarPhotoOriginal(k: string) {
    const [month, day] = k.split("-").map(Number);
    const dayItems = photos[k] || (() => {
      try {
        const raw = localStorage.getItem(storageKey("photos", month, day));
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

    setPhotos(nextPhotos);
    setCalendarPhotos(nextCalendarPhotos);
    setCalendarPhotoIndexes(nextCalendarPhotoIndexes);
    const [month, day] = k.split("-").map(Number);
    savePhotos(month, day, nextPhotosForDay, nextCalendarPhotos, nextCalendarPhotoIndexes);
    await deleteSupabasePhoto("diary-photos", "diary_photos", deletingItem.storagePath);
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
  }

  async function deleteOriginalDiaryPhoto() {
    if (!originalImageTarget) return;
    const itemNumber = originalImageTarget.index + 1;
    if (!window.confirm(`${itemNumber}踰덉㎏ ?ъ쭊????젣?좉퉴??`)) return;
    await deletePhoto(originalImageTarget.photoKey, originalImageTarget.index);
    closeOriginalImage();
  }


  function getDiaryPhotoIndexFromUser(k: string, actionName: string) {
    const items = photos[k] || [];
    if (!items.length) {
      alert("?좏깮???ъ쭊???놁뒿?덈떎.");
      return null;
    }

    const input = window.prompt(`${actionName}???ъ쭊 踰덊샇瑜??낅젰?섏꽭?? (1~${items.length})`);
    if (!input) return null;

    const index = Number(input.trim()) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= items.length) {
      alert("?ъ쭊 踰덊샇媛 ?щ컮瑜댁? ?딆뒿?덈떎.");
      return null;
    }

    return index;
  }

  async function attachDiaryPhotoToCalendar(k: string) {
    const index = getDiaryPhotoIndexFromUser(k, "罹섎┛?붿뿉 遺숈씠湲?);
    if (index === null) return;
    await setCalendarPhoto(k, index);
  }

  async function deleteDiaryPhotoBySelect(k: string) {
    const index = getDiaryPhotoIndexFromUser(k, "??젣");
    if (index === null) return;
    if (!window.confirm(`${index + 1}踰??ъ쭊????젣?좉퉴??`)) return;
    await deletePhoto(k, index);
  }

  async function pastePhotoFromClipboard() {
    try {
      const clipboard = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };
      if (!clipboard.read) {
        alert("??釉뚮씪?곗??먯꽌???대?吏 遺숈뿬?ｊ린瑜?吏?먰븯吏 ?딆뒿?덈떎. ?ъ쭊 媛?몄삤湲곕? ?ъ슜??二쇱꽭??");
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
        alert("?대┰蹂대뱶??遺숈뿬?ｌ쓣 ?대?吏媛 ?놁뒿?덈떎.");
        return;
      }

      await savePhotoFiles(files);
    } catch {
      alert("?꾩씠??Safari?먯꽌???대?吏 遺숈뿬?ｊ린媛 ?쒗븳?????덉뒿?덈떎. 蹂듭궗???대?吏媛 遺숈? ?딆쑝硫??ъ쭊 媛?몄삤湲곕? ?ъ슜??二쇱꽭??");
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
      alert("?꾩옱 釉뚮씪?곗??먯꽌???뱀빋 吏곸젒 ?뱀쓬??吏?먮릺吏 ?딆뒿?덈떎. ?꾩씠?곗쓽 ?뚯꽦硫붾え ?깆쑝濡??뱀쓬????'?뚯꽦?뚯씪 媛?몄삤湲?瑜??ъ슜??二쇱꽭??");
      setVoiceStatus("吏곸젒 ?뱀쓬 誘몄???- ?뚯꽦?뚯씪 媛?몄삤湲??ъ슜");
      return;
    }

    const currentRecorder = mediaRecorderRef.current;
    if (currentRecorder && currentRecorder.state === "recording") {
      setVoiceStatus("?대? ?뱀쓬 以?..");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl("");
      setLastAudioFile(null);
      setVoiceStatus("?뱀쓬 以?..");

      const mimeType = getSupportedAudioMimeType();
      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onerror = () => {
        stream.getTracks().forEach(track => track.stop());
        setVoiceStatus("?뱀쓬 ?ㅻ쪟 - ?뚯꽦?뚯씪 媛?몄삤湲?沅뚯옣");
        alert("?꾩씠??Safari?먯꽌 吏곸젒 ?뱀쓬 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎. ?뚯꽦硫붾え ?깆쑝濡??뱀쓬????'?뚯꽦?뚯씪 媛?몄삤湲?瑜??ъ슜??二쇱꽭??");
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());

        if (!audioChunksRef.current.length) {
          setVoiceStatus("?뱀쓬 ?곗씠???놁쓬 - ?ㅼ떆 ?쒕룄");
          return;
        }

        const finalType = mediaRecorder.mimeType || mimeType || "audio/mp4";
        const blob = new Blob(audioChunksRef.current, { type: finalType });
        const ext = getAudioExtension(finalType);
        const file = new File([blob], `diary_voice_${pad(currentMonth)}_${pad(currentDay)}.${ext}`, { type: finalType });
        setLastAudioFile(file);
        setAudioUrl(URL.createObjectURL(blob));
        setVoiceStatus(`${tag(currentMonth, currentDay)} ?뱀쓬 ?꾨즺`);
      };

      mediaRecorder.start(1000);
    } catch (error) {
      const message = error instanceof Error ? error.name : "UnknownError";
      alert(`留덉씠??沅뚰븳 ?먮뒗 釉뚮씪?곗? ?뱀쓬 ?ㅻ쪟?낅땲?? (${message})
?꾩씠???ㅼ젙?먯꽌 Safari 留덉씠??沅뚰븳???뺤씤?섍굅?? ?뚯꽦硫붾え ?깆쑝濡??뱀쓬 ??'?뚯꽦?뚯씪 媛?몄삤湲?瑜??ъ슜??二쇱꽭??`);
      setVoiceStatus("留덉씠??沅뚰븳/?뱀쓬 ?ㅻ쪟");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setVoiceStatus(lastAudioFile ? "?뱀쓬 ?꾨즺" : "?뱀쓬 以??꾨떂");
      return;
    }

    try {
      if (recorder.state === "recording") recorder.requestData();
      recorder.stop();
      setVoiceStatus("?뱀쓬 ?뺣━ 以?..");
    } catch {
      setVoiceStatus("?뱀쓬 ?뺤? ?ㅻ쪟");
    }
  }

  function importVoiceFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const supportedAudio = /\.(m4a|mp3|mp4|aac|webm)$/i.test(file.name) || ["audio/mp4", "audio/x-m4a", "audio/mpeg", "audio/mp3", "audio/aac", "audio/webm"].includes(file.type);
    if (!supportedAudio) {
      alert("m4a, mp3 ?뺤떇???뚯꽦?뚯씪??沅뚯옣?⑸땲?? ???뚯씪? ?쇰? 湲곌린?먯꽌 ?ъ깮?섏? ?딆쓣 ???덉뒿?덈떎.");
    }

    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const normalizedFile = new File([file], normalizeAudioFileName(file), { type: file.type || "audio/mp4" });
    const url = URL.createObjectURL(normalizedFile);
    setLastAudioFile(normalizedFile);
    setAudioUrl(url);
    setVoiceStatus(`${tag(currentMonth, currentDay)} ${normalizedFile.name} 媛?몄샂`);
    event.target.value = "";
  }

  function saveVoiceMemoFile() {
    if (!lastAudioFile) {
      alert("??ν븷 ?뚯꽦 ?뚯씪???놁뒿?덈떎. 癒쇱? ?뱀쓬?섍굅???뚯꽦?뚯씪??媛?몄? 二쇱꽭??");
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
    setVoiceStatus("?뚯꽦 ?뚯씪 ????ㅽ뻾");
  }

  function deleteVoiceMemo() {
    if (!audioUrl && !lastAudioFile) {
      alert("??젣???뱀쓬 ?뚯씪???놁뒿?덈떎.");
      return;
    }

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl("");
    setLastAudioFile(null);
    audioChunksRef.current = [];
    setVoiceStatus("?뱀쓬 ?뚯씪 ??젣??);
  }

  async function shareVoiceMemoToIphoneMemo() {
    if (!lastAudioFile) {
      alert("癒쇱? ?뚯꽦 硫붾え瑜??뱀쓬??二쇱꽭??");
      return;
    }

    const memoText = `${tag(currentMonth, currentDay)} 2026. ${pad(currentMonth)}. ${pad(currentDay)} (${getWeekday(currentMonth, currentDay)})\n\n?뚯꽦 硫붾え ?뚯씪??泥⑤??⑸땲??\n\n諛쏆븘?곌린 ?뺣━:\n${voiceText || ""}`;
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };

    if (nav.canShare?.({ files: [lastAudioFile] }) && navigator.share) {
      try {
        await navigator.share({ title: `${tag(currentMonth, currentDay)} ?뚯꽦 硫붾え`, text: memoText, files: [lastAudioFile] });
        setVoiceStatus("怨듭쑀李??대┝ - 硫붾え ?좏깮");
      } catch {
        setVoiceStatus("怨듭쑀 痍⑥냼 ?먮뒗 ?ㅽ뙣");
      }
      return;
    }

    saveVoiceMemoFile();
    setVoiceStatus("怨듭쑀 誘몄???- ?뚯씪 ????ㅽ뻾");
  }

  function CalendarView() {
    const first = new Date(2026, currentMonth - 1, 1).getDay();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(<div key={`empty-${i}`} className="day empty" />);

    for (let day = 1; day <= monthDays[currentMonth]; day++) {
      const k = key(currentMonth, day);
      const manuallyRed = (redDates[currentMonth] || []).includes(day);
      const redMarked = manuallyRed;
      const isToday = todayDefault.month === currentMonth && todayDefault.day === day;
      const daySchedules = schedules[k] || [];
      const isSelected = currentDay === day;
      cells.push(
        <div className={`day ${redMarked ? "holiday-day" : ""} ${isToday ? "today-day" : ""} ${isSelected ? "selected-day" : ""}`} key={k}>
          <button
            type="button"
            className="day-hit"
            onClick={() => openDiary(currentMonth, day)}
            aria-label={`${currentMonth}??${day}???쇨린?μ쑝濡??대룞`}
          />
          <div className="day-top">
            <span className={`num ${redMarked ? "num-red" : ""} ${isToday ? "today-num" : ""}`}>{day}</span>
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
                aria-label={`${currentMonth}??${day}??????ъ쭊 ?먮낯 蹂닿린`}
              >
                <img src={calendarPhotos[k]} alt="罹섎┛??????ъ쭊" />
              </button>
            ) : null}
          </div>
          {daySchedules.length > 0 && (
            <div className="schedule-chip-list">
              {daySchedules.slice(0, 3).map(item => (
                <div className={`schedule-chip schedule-${item.color}`} key={item.id}>
                  {item.startTime && <span>{item.startTime}</span>} {item.title}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <section>
        <div className="month-tabs">
          {Array.from({ length: 8 }, (_, i) => i + 5).map(month => (
            <button
              key={month}
              type="button"
              className={`month-tab ${month === currentMonth ? "active" : ""}`}
              onClick={() => openCalendar(month)}
            >
              {month}??            </button>
          ))}
        </div>

        <div className="section-title calendar-headline">
          <h1 className="calendar-title-line">
            <span className="main-title">2026???꾩씠??罹섎┛??/span>
            <button type="button" className="month-badge month-diary-link" onClick={() => openDiary(currentMonth, currentDay)} aria-label="?좏깮 ?좎쭨 ?쇨린?μ쑝濡??대룞">{currentMonth}??/button>
          </h1>
          <div className="head-actions calendar-top-actions">
            <button type="button" className="today-circle" onClick={openTodayDiary} aria-label="?ㅻ뒛 ?좎쭨 ?쇨린?μ쑝濡??대룞">{todayDefault.day}</button>
            <button type="button" className="red-plus-btn" onClick={openRedDateInput} aria-label="鍮④컙 ?좎쭨 ?쒖떆">+</button>
            <button type="button" className="plus-btn" onClick={() => openSchedule(currentMonth, currentDay)} aria-label="?쇱젙 異붽?">+</button>
            <button type="button" className="mini-btn info calendar-info-top-btn" onClick={() => openInfo(currentMonth, currentDay)} aria-label="?좏깮 ?좎쭨 ?뺣낫蹂닿??뚮줈 ?대룞">I</button>
            <button type="button" className="pill-btn compact-pill" onClick={() => openDatePicker("diary")}>?쇨린??/button>
            <button type="button" className="pill-btn compact-pill" onClick={() => openDatePicker("info")}>?뺣낫蹂닿???/button>
          </div>
        </div>

        <div className="calendar-search-box">
          <div className="calendar-search-row">
            <input
              className="calendar-search-input"
              value={searchKeyword}
              onChange={e => setSearchKeyword(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void searchDiaryAndInfo(); }}
              placeholder="?쇨린???뺣낫蹂닿???寃?됱뼱 ?낅젰"
            />
            <button type="button" className="soft-btn" onClick={() => void searchDiaryAndInfo()}>寃??/button>
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
                  <strong>{result.type === "diary" ? "?쇨린?? : "?뺣낫蹂닿???} 쨌 {pad(result.month)}/{pad(result.day)}</strong>
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
    const k = key(currentMonth, currentDay);
    const dayPhotos = photos[k] || [];
    const daySchedules = schedules[k] || [];
    const diaryPhotoCountClass = `count-${Math.min(Math.max(dayPhotos.length, 1), 4)}`;
    return (
      <section>
        <div className="diary-head">
          <h1>2026. {pad(currentMonth)}. {pad(currentDay)} ({getWeekday(currentMonth, currentDay)})</h1>
          <div className="head-actions diary-actions">
            <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>?뱟 罹섎┛??/button>
            <button type="button" className="pill-btn" onClick={() => openInfo(currentMonth, currentDay)}>?뱛 ?뺣낫 ?대룞</button>
          </div>
        </div>

        <div className="diary-top-row">
          <div className="weather-line diary-weather-line">
            <span>?룧 吏?/span>
            <span>?截?{weather}</span>
            <span>?뙜 {temp}</span>
            <span className="weather-time-inline">?븩 {weatherTime}</span>
            <button type="button" className="weather-refresh-btn" onClick={fetchWeatherFromKma}>{weatherSource}</button>
          </div>
          <div className="google-schedule-box diary-schedule-box">
            <div className="google-schedule-head">
              <strong>?쇱젙</strong>
              <button type="button" className="google-refresh-btn" onClick={() => void loadGoogleSchedulesForDay(currentMonth, currentDay)}>援ш? ?덈줈怨좎묠</button>
              <span>{daySchedules.length + googleSchedules.length}媛??쇱젙</span>
            </div>
            {(daySchedules.length > 0 || googleSchedules.length > 0) ? (
              <div className="google-schedule-list">
                {daySchedules.map(item => (
                  <div className="google-schedule-item app-schedule-item" key={item.id}>
                    <span className="google-schedule-time">{item.startTime || "?쒓컙 ?놁쓬"}</span>
                    <span className="google-schedule-title">罹섎┛??쨌 {item.title}</span>
                  </div>
                ))}
                {googleSchedules.map((item, index) => (
                  <div className="google-schedule-item" key={`${item.title}-${index}`}>
                    <span className="google-schedule-time">{item.allDay ? "醫낆씪" : item.start || "?쒓컙 ?놁쓬"}</span>
                    <span className="google-schedule-title">援ш? 쨌 {item.title}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="google-schedule-empty">??λ맂 ?쇱젙???놁뒿?덈떎.</div>
            )}
          </div>
          <div className="button-row diary-photo-import-row">
            <label className="soft-btn compact-photo-btn">
              ?벜 ?ъ쭊李띻린
              <input className="hidden-input" type="file" accept="image/*" capture="environment" multiple onChange={addPhotos} />
            </label>
            <label className="soft-btn compact-photo-btn">
              ?뼹 ?ъ쭊 媛?몄삤湲?              <input className="hidden-input" type="file" accept="image/*" multiple onChange={addPhotos} />
            </label>
            <button type="button" className="soft-btn compact-photo-btn" onClick={pastePhotoFromClipboard}>?뱥 遺숈뿬?ｊ린</button>
            <button type="button" className="soft-btn compact-photo-btn" onClick={() => attachDiaryPhotoToCalendar(k)}>罹섎┛??遺숈씠湲?/button>
            <button type="button" className="soft-btn compact-photo-btn delete-btn" onClick={() => deleteDiaryPhotoBySelect(k)}>??젣</button>
          </div>
        </div>

        <div className="text-paste-row">
          <button type="button" className="soft-btn text-paste-btn" onClick={pasteCopiedTextToDiary}>蹂듭궗??湲 遺숈씠湲?/button>
          <span className="text-paste-help">臾몄옄쨌移댄넚쨌硫붾え?먯꽌 蹂듭궗??湲???쇨린??蹂몃Ц??遺숈씠怨?諛붾줈 ??ν빀?덈떎.</span>
        </div>
        <textarea
          ref={diaryTextareaRef}
          className="diary-textarea diary-main-textarea diary-full-textarea"
          value={diaryText}
          onInput={e => resizeTextareaToContent(e.currentTarget)}
          onPaste={handleDiaryTextPaste}
          onChange={e => saveDiary(e.target.value, voiceText)}
          placeholder="?ㅻ뒛??湲곕줉???④꺼蹂댁꽭??..."
        />
        <HyperlinkPreview text={diaryText} />

        <div className="diary-photo-section" onPaste={handlePhotoPaste} tabIndex={0}>
          {dayPhotos.length === 0 && <div className="empty-photo diary-empty-photo">?ъ쭊??李띻굅??媛?몄삤硫??ш린????λ맗?덈떎.<br />?꾩씠?곗뿉??遺숈뿬?ｊ린媛 ???섎㈃ ?ъ쭊 媛?몄삤湲곕? ?ъ슜?섏꽭??</div>}
          <div className={`diary-photo-grid-safe diary-photo-gallery ${diaryPhotoCountClass}`}>
            {dayPhotos.map((photo, index) => (
              <div
                className="diary-photo-card-safe diary-gallery-photo diary-photo-item-with-delete"
                key={`${photo.name}-${index}`}
              >
                <button
                  type="button"
                  className="diary-photo-open-btn"
                  onClick={() => openDiaryOriginalPhoto(k, index)}
                  aria-label="?쇨린 ?ъ쭊 ?먮낯 ?ш쾶 蹂닿린"
                >
                  <img src={photo.url} alt={`?쇨린 ?ъ쭊 ${index + 1}`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="box voice-box">
          <div className="box-head compact-box-head voice-head-safe">
            <h3>?뚯꽦 硫붾え / 諛쏆븘?곌린</h3>
            <div className="button-row voice-main-actions">
              <button type="button" className="soft-btn" onClick={startRecording}>?럺 ?뱀쓬 ?쒖옉</button>
              <button type="button" className="soft-btn" onClick={stopRecording}>???뱀쓬 ?뺤?</button>
              <button type="button" className="soft-btn delete-btn" onClick={deleteVoiceMemo}>?뿊 ?뱀쓬 ??젣</button>
              <button type="button" className="soft-btn" onClick={saveVoiceMemoFile}>?뮶 ?뚯씪 ???/button>
              <button type="button" className="soft-btn" onClick={shareVoiceMemoToIphoneMemo}>?뱷 ?꾩씠??硫붾え濡?蹂대궡湲?/button>
              <label className="soft-btn">
                ?렒 ?뚯꽦?뚯씪 媛?몄삤湲?                <input className="hidden-input" type="file" accept="audio/m4a,audio/mp4,audio/mpeg,audio/mp3,.m4a,.mp3,.mp4,.aac,.webm" onChange={importVoiceFile} />
              </label>
              <span className="voice-status">{voiceStatus}</span>
            </div>
          </div>
          {audioUrl && <audio src={audioUrl} controls style={{ width: "100%", marginTop: 12 }} />}
          <textarea value={voiceText} onChange={e => saveDiary(diaryText, e.target.value)} style={{ minHeight: 140, marginTop: 12 }} placeholder="?뚯꽦 諛쏆븘?곌린 ?먮뒗 ?뱀쓬 ?댁슜???뺣━??蹂댁꽭??" />
        </div>
      </section>
    );
  }

  function ScheduleView() {
    const k = key(currentMonth, currentDay);
    const daySchedules = schedules[k] || [];

    return (
      <section>
        <div className="schedule-page box">
          <div className="schedule-head">
            <h2>+ ?쇱젙 湲곕줉 ({pad(currentMonth)}.{pad(currentDay)})</h2>
            <div className="head-actions schedule-actions">
              <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>?뱟 罹섎┛??/button>
              <button type="button" className="pill-btn" onClick={() => openDiary(currentMonth, currentDay)}>?랃툘 ?쇨린</button>
            </div>
          </div>

          <div className="schedule-form">
            <label>
              <span>?쒕ぉ</span>
              <input value={scheduleTitle} onChange={e => setScheduleTitle(e.target.value)} placeholder="?쇱젙 ?쒕ぉ" />
            </label>
            <label>
              <span>?쒖옉?쒓컙</span>
              <input type="time" value={scheduleStartTime} onChange={e => setScheduleStartTime(e.target.value)} />
            </label>
            <label>
              <span>醫낅즺??/span>
              <input type="date" value={scheduleEndDate} onChange={e => setScheduleEndDate(e.target.value)} />
            </label>
            <label>
              <span>諛섎났</span>
              <select value={scheduleRepeat} onChange={e => setScheduleRepeat(e.target.value)}>
                <option>?놁쓬</option>
                <option>留ㅼ씪</option>
                <option>留ㅼ＜</option>
                <option>留ㅼ썡</option>
                <option>留ㅻ뀈</option>
              </select>
            </label>
          </div>

          <div className="color-picker">
            <span>?됯퉼 ?좏깮</span>
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

          <button type="button" className="save-schedule-btn" onClick={addSchedule}>?쇱젙 ???/button>

          <div className="saved-schedules">
            <h3>??λ맂 ?쇱젙</h3>
            {daySchedules.length === 0 && <p className="muted">?꾩쭅 ??λ맂 ?쇱젙???놁뒿?덈떎.</p>}
            {daySchedules.map(item => (
              <div className={`saved-schedule schedule-${item.color}`} key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.startTime || "?쒓컙 ?놁쓬"} 쨌 醫낅즺??{item.endDate || "誘몄???} 쨌 諛섎났 {item.repeat}</span>
                </div>
                <button type="button" onClick={() => deleteSchedule(item.id)}>??젣</button>
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
            <h2>鍮④컙 ?좎쭨 ?쒖떆 ({currentMonth}??</h2>
            <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>?뱟 罹섎┛??/button>
          </div>
          <p className="muted">鍮④컙?됱쑝濡??쒖떆???좎쭨瑜??쇳몴濡??щ윭 媛??낅젰?섏꽭?? ?? 6, 25, 30</p>
          <input
            className="red-date-input"
            value={redDateInput}
            onChange={e => setRedDateInput(e.target.value)}
            placeholder="?? 6, 25"
            inputMode="text"
            autoComplete="off"
          />
          <button type="button" className="save-schedule-btn" onClick={saveRedDateInput}>鍮④컙 ?좎쭨 ???/button>
        </div>
      </section>
    );
  }

  function InfoView() {
    const k = key(currentMonth, currentDay);
    const dayInfoPhotos = infoPhotos[k] || [];
    const infoPhotoCountClass = `count-${Math.min(Math.max(dayInfoPhotos.length, 1), 3)}`;

    return (
      <section>
        <div className="box info-box" style={{ border: "2px solid var(--deep)", minHeight: 720 }} onPaste={handleInfoPhotoPaste} tabIndex={0}>
          <div className="info-head">
            <h2 className="info-title">?뱛 二쇱슂 ?뺣낫 蹂닿???/h2>
            <div className="info-sub-date">2026. {pad(currentMonth)}. {pad(currentDay)} ({getWeekday(currentMonth, currentDay)})</div>
            <div className="info-nav-row">
              <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>?뱟 ?붽컙 罹섎┛??/button>
              <button type="button" className="pill-btn" onClick={() => openDiary(currentMonth, currentDay)}>?랃툘 ?쇨린</button>
              <button type="button" className="today-circle info-date-circle" onClick={() => openDatePicker("info")} aria-label="?뺣낫蹂닿????좎쭨 ?좏깮">{currentDay}</button>
              <label className="soft-btn info-action-btn">
                ?뼹 ?ъ쭊 媛?몄삤湲?                <input className="hidden-input" type="file" accept="image/*" multiple onChange={addInfoPhotos} />
              </label>
              <button type="button" className="soft-btn info-action-btn" onClick={pasteInfoPhotoFromClipboard}>?뱥 遺숈뿬?ｊ린</button>
            </div>
          </div>
          <div className="text-paste-row info-text-paste-row">
            <button type="button" className="soft-btn text-paste-btn" onClick={pasteCopiedTextToInfo}>蹂듭궗??湲 遺숈씠湲?/button>
            <span className="text-paste-help">臾몄옄쨌移댄넚쨌?뱁럹?댁??먯꽌 蹂듭궗??湲???뺣낫蹂닿???蹂몃Ц??遺숈씠怨?諛붾줈 ??ν빀?덈떎.</span>
          </div>
          <textarea
            ref={infoTextareaRef}
            className="info-main-textarea"
            value={infoText}
            onInput={e => resizeTextareaToContent(e.currentTarget)}
            onPaste={handleInfoTextPaste}
            onChange={e => saveInfo(e.target.value)}
            placeholder="?ㅻ뒛??以묒슂???ㅽ겕?? ?뺣낫, ?쇱젙, 留곹겕, 硫붾え瑜?湲곕줉?섏꽭??"
          />
          <HyperlinkPreview text={infoText} />

          {dayInfoPhotos.length === 0 && <div className="empty-photo integrated-info-photo-empty">?대?吏瑜?遺숈뿬?ｊ굅???ъ쭊??媛?몄삤硫??닿납???뺣━?⑸땲??</div>}
          <div className={`info-photo-grid-safe ${infoPhotoCountClass}`}>
            {dayInfoPhotos.map((photo, index) => (
              <div className="info-photo-card-safe" key={`${photo.name}-${index}`}>
                <button
                  type="button"
                  className="original-photo-btn info-original-photo-btn"
                  onClick={() => setOriginalImageUrl(photo.url)}
                  aria-label="?뺣낫蹂닿????ъ쭊 ?먮낯 ?ш쾶 蹂닿린"
                >
                  <img src={photo.url} alt={`?뺣낫蹂닿????ъ쭊 ${index + 1}`} />
                </button>
                <textarea
                  className="info-photo-note-safe"
                  value={normalizeInfoPhotoMemo(photo.memo)}
                  onFocus={e => expandInfoPhotoNote(e.currentTarget)}
                  onInput={e => expandInfoPhotoNote(e.currentTarget)}
                  onBlur={e => collapseInfoPhotoNote(e.currentTarget)}
                  onChange={e => updateInfoPhotoMemo(k, index, e.target.value)}
                  placeholder="# ?ъ쭊 ?꾨옒???댁슜???낅젰?섏꽭??"
                />
                <div className="photo-actions safe-photo-actions">
                  <button type="button" className="soft-btn" onClick={() => moveInfoPhoto(k, index, -1)} disabled={index === 0}>???댁쟾</button>
                  <button type="button" className="soft-btn" onClick={() => moveInfoPhoto(k, index, 1)} disabled={index === dayInfoPhotos.length - 1}>?ㅼ쓬 ??/button>
                  <button type="button" className="soft-btn delete-btn" onClick={() => deleteInfoPhoto(k, index)}>??젣</button>
                </div>
              </div>
            ))}
          </div>
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
      {datePickerMode && (
        <div className="date-picker-modal" role="dialog" aria-modal="true" onClick={() => setDatePickerMode(null)}>
          <div className="date-picker-panel" onClick={event => event.stopPropagation()}>
            <h3>{datePickerMode === "diary" ? "?쇨린???좎쭨 ?좏깮" : "?뺣낫蹂닿????좎쭨 ?좏깮"}</h3>
            <input
              type="date"
              min="2026-05-01"
              max="2026-12-31"
              value={datePickerValue}
              onChange={event => setDatePickerValue(event.target.value)}
            />
            <div className="date-picker-actions">
              <button type="button" className="soft-btn" onClick={() => setDatePickerMode(null)}>痍⑥냼</button>
              <button type="button" className="pill-btn" onClick={applyDatePicker}>?대룞</button>
            </div>
          </div>
        </div>
      )}
      {originalImageUrl && (
        <div className="original-image-modal" role="dialog" aria-modal="true" onClick={closeOriginalImage}>
          <div className="original-image-panel" onClick={event => event.stopPropagation()}>
            <div className="original-modal-actions">
              {originalImageTarget?.type === "diary" && (
                <button type="button" className="original-delete-btn" onClick={deleteOriginalDiaryPhoto}>?ъ쭊 ??젣</button>
              )}
              <button type="button" className="original-close-btn" onClick={closeOriginalImage}>?リ린</button>
            </div>
            <img src={originalImageUrl} alt="?먮낯 ?ъ쭊" />
          </div>
        </div>
      )}
    </main>
  );
}

