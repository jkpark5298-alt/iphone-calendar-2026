"use client";

import { ChangeEvent, ClipboardEvent, useEffect, useMemo, useRef, useState } from "react";

type View = "calendar" | "diary" | "info" | "schedule" | "redDate";
type PhotoItem = { url: string; name: string; tag: string };
type ScheduleColor = "yellow" | "blue" | "red" | "green" | "lightGreen" | "orange" | "navy" | "purple";
type ScheduleItem = {
  id: string;
  title: string;
  startTime: string;
  endDate: string;
  repeat: string;
  color: ScheduleColor;
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

function key(month: number, day: number) {
  return `${month}-${day}`;
}

function tag(month: number, day: number) {
  return `#${pad(month)}/${pad(day)}#`;
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
  const [calendarPhotos, setCalendarPhotos] = useState<Record<string, string>>({});
  const [schedules, setSchedules] = useState<Record<string, ScheduleItem[]>>({});
  const [redDates, setRedDates] = useState<Record<number, number[]>>({});
  const [redDateInput, setRedDateInput] = useState("");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleStartTime, setScheduleStartTime] = useState("");
  const [scheduleEndDate, setScheduleEndDate] = useState("");
  const [scheduleRepeat, setScheduleRepeat] = useState("없음");
  const [scheduleColor, setScheduleColor] = useState<ScheduleColor>("yellow");
  const [audioUrl, setAudioUrl] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("녹음 파일 없음");
  const [lastAudioFile, setLastAudioFile] = useState<File | null>(null);
  const [weather, setWeather] = useState("조회 중");
  const [temp, setTemp] = useState("-");
  const [weatherTime, setWeatherTime] = useState("-");
  const [weatherSource, setWeatherSource] = useState("기상청 연결 대기");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    try {
      const rawCalendar = localStorage.getItem("iphone-diary-2026-calendar-photos");
      if (rawCalendar) setCalendarPhotos(JSON.parse(rawCalendar));
      const rawSchedules = localStorage.getItem("iphone-calendar-2026-schedules");
      if (rawSchedules) setSchedules(JSON.parse(rawSchedules));
      const rawRedDates = localStorage.getItem("iphone-calendar-2026-red-dates");
      if (rawRedDates) setRedDates(JSON.parse(rawRedDates));
    } catch {
      setCalendarPhotos({});
    }
  }, []);

  useEffect(() => {
    if (view !== "diary") return;
    try {
      const raw = localStorage.getItem(storageKey("diary", currentMonth, currentDay));
      const data = raw ? JSON.parse(raw) : {};
      setDiaryText(data.diaryText || "");
      setVoiceText(data.voiceText || "");

      const rawPhotos = localStorage.getItem(storageKey("photos", currentMonth, currentDay));
      const items = rawPhotos ? JSON.parse(rawPhotos) : [];
      setPhotos(prev => ({ ...prev, [key(currentMonth, currentDay)]: items }));
      fetchWeatherFromKma();
    } catch {
      setDiaryText("");
      setVoiceText("");
      fetchWeatherFromKma();
    }
  }, [view, currentMonth, currentDay]);

  useEffect(() => {
    if (view !== "info") return;
    try {
      const raw = localStorage.getItem(storageKey("info", currentMonth, currentDay));
      const data = raw ? JSON.parse(raw) : {};
      setInfoText(data.infoText || "");
    } catch {
      setInfoText("");
    }
  }, [view, currentMonth, currentDay]);

  async function fetchWeatherFromKma() {
    setWeather("조회 중");
    setTemp("-");
    setWeatherSource("기상청 조회 중");

    try {
      const response = await fetch("/api/weather", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.message || "weather error");
      }

      setWeather(data.weather || "확인 필요");
      setTemp(data.temperature ? `${data.temperature}℃` : "-");
      setWeatherTime(data.observedAt || new Date().toLocaleString("ko-KR"));
      setWeatherSource("기상청");
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
    setScheduleRepeat("없음");
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
    const parsedDays = redDateInput
      .split(/[,.\s]+/)
      .map(value => Number(value.trim()))
      .filter(value => Number.isInteger(value) && value >= 1 && value <= monthDays[currentMonth]);

    const uniqueDays = Array.from(new Set(parsedDays)).sort((a, b) => a - b);
    const nextRedDates = { ...redDates, [currentMonth]: uniqueDays };
    setRedDates(nextRedDates);
    localStorage.setItem("iphone-calendar-2026-red-dates", JSON.stringify(nextRedDates));
    alert(`${currentMonth}월 빨간 날짜가 저장되었습니다.`);
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

  function saveDiary(nextDiaryText: string, nextVoiceText: string) {
    setDiaryText(nextDiaryText);
    setVoiceText(nextVoiceText);
    localStorage.setItem(
      storageKey("diary", currentMonth, currentDay),
      JSON.stringify({ diaryText: nextDiaryText, voiceText: nextVoiceText })
    );
  }

  function saveInfo(nextInfoText: string) {
    setInfoText(nextInfoText);
    localStorage.setItem(storageKey("info", currentMonth, currentDay), JSON.stringify({ infoText: nextInfoText }));
  }

  function saveSchedules(nextSchedules: Record<string, ScheduleItem[]>) {
    setSchedules(nextSchedules);
    localStorage.setItem("iphone-calendar-2026-schedules", JSON.stringify(nextSchedules));
  }

  function addSchedule() {
    const trimmedTitle = scheduleTitle.trim();
    if (!trimmedTitle) {
      alert("일정 제목을 입력해 주세요.");
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
    setScheduleRepeat("없음");
    alert("일정이 저장되었습니다.");
  }

  function deleteSchedule(scheduleId: string) {
    const k = key(currentMonth, currentDay);
    const nextForDay = (schedules[k] || []).filter(item => item.id !== scheduleId);
    const nextSchedules = { ...schedules, [k]: nextForDay };
    saveSchedules(nextSchedules);
  }

  function savePhotos(month: number, day: number, nextPhotos: PhotoItem[], nextCalendarPhotos: Record<string, string>) {
    localStorage.setItem(storageKey("photos", month, day), JSON.stringify(nextPhotos));
    localStorage.setItem("iphone-diary-2026-calendar-photos", JSON.stringify(nextCalendarPhotos));
  }

  async function savePhotoFiles(files: File[]) {
    if (!files.length) return;

    const readFile = (file: File) => new Promise<PhotoItem>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ url: String(reader.result), name: file.name, tag: tag(currentMonth, currentDay) });
      reader.readAsDataURL(file);
    });

    const newItems = await Promise.all(files.map(readFile));
    const k = key(currentMonth, currentDay);
    const nextPhotosForDay = [...(photos[k] || []), ...newItems];
    const nextPhotos = { ...photos, [k]: nextPhotosForDay };
    const nextCalendarPhotos = { ...calendarPhotos };
    if (!nextCalendarPhotos[k]) nextCalendarPhotos[k] = newItems[0].url;

    setPhotos(nextPhotos);
    setCalendarPhotos(nextCalendarPhotos);
    savePhotos(currentMonth, currentDay, nextPhotosForDay, nextCalendarPhotos);
  }

  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    await savePhotoFiles(files);
    event.target.value = "";
  }

  async function handlePhotoPaste(event: ClipboardEvent<HTMLDivElement>) {
    const pastedFiles = Array.from(event.clipboardData.items)
      .filter(item => item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (!pastedFiles.length) return;
    event.preventDefault();
    await savePhotoFiles(pastedFiles);
  }

  function setCalendarPhoto(k: string, index: number) {
    const items = photos[k] || [];
    if (!items[index]) return;
    const nextCalendarPhotos = { ...calendarPhotos, [k]: items[index].url };
    setCalendarPhotos(nextCalendarPhotos);
    const [month, day] = k.split("-").map(Number);
    savePhotos(month, day, items, nextCalendarPhotos);
    alert("선택한 사진을 월간 캘린더에 붙였습니다.");
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      setLastAudioFile(null);
      setVoiceStatus("녹음 중...");

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = event => audioChunksRef.current.push(event.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `diary_voice_${pad(currentMonth)}_${pad(currentDay)}.webm`, { type: "audio/webm" });
        setLastAudioFile(file);
        setAudioUrl(URL.createObjectURL(blob));
        setVoiceStatus(`${tag(currentMonth, currentDay)} 녹음 완료`);
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorder.start();
    } catch {
      alert("마이크 권한이 필요합니다. 아이폰/아이패드 설정에서 사파리 마이크 권한을 확인하세요.");
      setVoiceStatus("마이크 권한 필요");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      setVoiceStatus("녹음 정리 중...");
    }
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

    const url = URL.createObjectURL(lastAudioFile);
    const link = document.createElement("a");
    link.href = url;
    link.download = lastAudioFile.name;
    link.click();
    setVoiceStatus("공유 미지원 - 파일 다운로드");
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
            aria-label={`${currentMonth}월 ${day}일 일기장으로 이동`}
          />
          <div className="day-top">
            <span className={`num ${redMarked ? "num-red" : ""} ${isToday ? "today-num" : ""}`}>{day}</span>
            <button
              type="button"
              className="mini-btn info only-info"
              onClick={(e) => {
                e.stopPropagation();
                openInfo(currentMonth, day);
              }}
              aria-label={`${currentMonth}월 ${day}일 주요 정보 보관소로 이동`}
            >
              I
            </button>
          </div>
          {holidays[k] && <div className="holiday holiday-neutral">{holidays[k]}</div>}
          <div className={`thumb ${calendarPhotos[k] ? "" : "empty-thumb"}`}>
            {calendarPhotos[k] ? <img src={calendarPhotos[k]} alt="캘린더 대표 사진" /> : null}
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
              {month}월
            </button>
          ))}
        </div>

        <div className="section-title calendar-headline">
          <h1 className="calendar-title-line">
            <span className="main-title">2026년 아이폰 캘린더</span>
            <span className="month-badge">{currentMonth}월</span>
          </h1>
          <div className="head-actions calendar-top-actions">
            <button type="button" className="today-circle" onClick={moveToTodayOnCalendar} aria-label="오늘 날짜로 이동">{todayDefault.day}</button>
            <button type="button" className="red-plus-btn" onClick={openRedDateInput} aria-label="빨간 날짜 표시">+</button>
            <button type="button" className="plus-btn" onClick={() => openSchedule(currentMonth, currentDay)} aria-label="일정 추가">+</button>
            <button type="button" className="pill-btn compact-pill" onClick={openTodayDiary}>TODAY 일기장</button>
            <button type="button" className="pill-btn compact-pill" onClick={() => openInfo(currentMonth, currentDay)}>정보보관소</button>
          </div>
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
    return (
      <section>
        <div className="diary-head">
          <h1>2026. {pad(currentMonth)}. {pad(currentDay)} ({getWeekday(currentMonth, currentDay)})</h1>
          <div className="head-actions diary-actions">
            <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>📅 캘린더</button>
            <button type="button" className="pill-btn" onClick={() => openInfo(currentMonth, currentDay)}>📂 정보 이동</button>
          </div>
        </div>

        <div className="weather-line">
          <span>🏠 집</span>
          <span>☀️ {weather}</span>
          <span>🌡 {temp}</span>
          <span className="weather-time">🕒 {weatherTime}</span>
          <span className="weather-source">{weatherSource}</span>
        </div>

        <div className="notice compact-notice">날씨는 기상청 단기예보 API 기준입니다. Vercel 환경변수 KMA_SERVICE_KEY가 필요합니다.</div>

        <textarea className="diary-textarea" value={diaryText} onChange={e => saveDiary(e.target.value, voiceText)} placeholder="오늘의 기록을 남겨보세요...." />

        <div className="box photo-box" onPaste={handlePhotoPaste} tabIndex={0}>
          <div className="box-head compact-box-head">
            <h3>Today 사진</h3>
            <div className="button-row">
              <label className="soft-btn">
                📷 사진찍기
                <input className="hidden-input" type="file" accept="image/*" capture="environment" multiple onChange={addPhotos} />
              </label>
              <label className="soft-btn">
                🖼 사진 가져오기
                <input className="hidden-input" type="file" accept="image/*" multiple onChange={addPhotos} />
              </label>
            </div>
          </div>

          {dayPhotos.length === 0 && <div className="empty-photo">사진 찍기·가져오기·붙여넣기 가능 / {tag(currentMonth, currentDay)} 자동 태그</div>}
          <div className="photo-grid">
            {dayPhotos.map((photo, index) => (
              <div className="photo-card" key={`${photo.name}-${index}`}>
                <img src={photo.url} alt={`일기 사진 ${index + 1}`} />
                <div className="photo-caption">
                  <span>{photo.tag} 해당 일기장 날짜 사진 {index + 1}</span>
                  <button type="button" className="soft-btn" onClick={() => setCalendarPhoto(k, index)}>캘린더에 붙이기</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="box voice-box">
          <div className="box-head compact-box-head">
            <h3>음성 메모 / 받아쓰기</h3>
            <div className="button-row">
              <button type="button" className="soft-btn" onClick={startRecording}>🎙 녹음 시작</button>
              <button type="button" className="soft-btn" onClick={stopRecording}>⏹ 녹음 정지</button>
            </div>
          </div>
          <p className="muted compact-muted">입력창을 누른 뒤 키보드 마이크 버튼으로 받아쓰기를 사용할 수 있습니다.</p>
          {audioUrl && <audio src={audioUrl} controls style={{ width: "100%", marginTop: 12 }} />}
          <div className="voice-save-row">
            <button type="button" className="soft-btn" onClick={shareVoiceMemoToIphoneMemo}>📝 아이폰 메모로 보내기</button>
            <button type="button" className="soft-btn delete-btn" onClick={deleteVoiceMemo}>🗑 녹음 삭제</button>
            <span className="voice-status">{voiceStatus}</span>
          </div>
          <textarea value={voiceText} onChange={e => saveDiary(diaryText, e.target.value)} style={{ minHeight: 140, marginTop: 12 }} placeholder="음성 받아쓰기 또는 녹음 내용을 정리해 보세요." />
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
            <h2>+ 일정 기록 ({pad(currentMonth)}.{pad(currentDay)})</h2>
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
              <span>시작시간</span>
              <input type="time" value={scheduleStartTime} onChange={e => setScheduleStartTime(e.target.value)} />
            </label>
            <label>
              <span>종료일</span>
              <input type="date" value={scheduleEndDate} onChange={e => setScheduleEndDate(e.target.value)} />
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

          <button type="button" className="save-schedule-btn" onClick={addSchedule}>일정 저장</button>

          <div className="saved-schedules">
            <h3>저장된 일정</h3>
            {daySchedules.length === 0 && <p className="muted">아직 저장된 일정이 없습니다.</p>}
            {daySchedules.map(item => (
              <div className={`saved-schedule schedule-${item.color}`} key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.startTime || "시간 없음"} · 종료일 {item.endDate || "미지정"} · 반복 {item.repeat}</span>
                </div>
                <button type="button" onClick={() => deleteSchedule(item.id)}>삭제</button>
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
          <p className="muted">빨간색으로 표시할 날짜만 입력하세요. 예: 6, 25</p>
          <input
            className="red-date-input"
            value={redDateInput}
            onChange={e => setRedDateInput(e.target.value)}
            placeholder="예: 6, 25"
            inputMode="numeric"
          />
          <button type="button" className="save-schedule-btn" onClick={saveRedDateInput}>빨간 날짜 저장</button>
        </div>
      </section>
    );
  }

  function InfoView() {
    return (
      <section>
        <div className="box info-box" style={{ border: "2px solid var(--deep)", minHeight: 720 }}>
          <div className="info-head">
            <h2 className="info-title">📂 주요 정보 보관소</h2>
            <div className="info-sub-date">2026. {pad(currentMonth)}. {pad(currentDay)}</div>
            <div className="info-nav-row">
              <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>📅 월간 캘린더</button>
              <button type="button" className="pill-btn" onClick={() => openDiary(currentMonth, currentDay)}>✍️ 일기</button>
              <button type="button" className="today-circle info-date-circle" onClick={() => openCalendar(currentMonth)}>{currentDay}</button>
            </div>
          </div>
          <textarea value={infoText} onChange={e => saveInfo(e.target.value)} style={{ minHeight: 520, borderStyle: "dashed" }} placeholder="오늘의 중요한 스크랩, 정보, 일정, 링크, 메모를 기록하세요." />
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
    </main>
  );
}
