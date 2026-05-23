"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type View = "calendar" | "diary" | "info";
type PhotoItem = { url: string; name: string; tag: string };

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const weekdayLabels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const monthDays: Record<number, number> = { 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 };
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

function isHolidayOrOff(month: number, day: number) {
  return Boolean(holidays[key(month, day)]) || isSunday(month, day);
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
  const [audioUrl, setAudioUrl] = useState("");
  const [voiceStatus, setVoiceStatus] = useState("녹음 파일 없음");
  const [lastAudioFile, setLastAudioFile] = useState<File | null>(null);
  const [weatherTime, setWeatherTime] = useState("-");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    try {
      const rawCalendar = localStorage.getItem("iphone-diary-2026-calendar-photos");
      if (rawCalendar) setCalendarPhotos(JSON.parse(rawCalendar));
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
      setWeatherTime(new Date().toLocaleString("ko-KR"));
    } catch {
      setDiaryText("");
      setVoiceText("");
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

  function savePhotos(month: number, day: number, nextPhotos: PhotoItem[], nextCalendarPhotos: Record<string, string>) {
    localStorage.setItem(storageKey("photos", month, day), JSON.stringify(nextPhotos));
    localStorage.setItem("iphone-diary-2026-calendar-photos", JSON.stringify(nextCalendarPhotos));
  }

  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
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
    event.target.value = "";
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
      const holidayOrOff = isHolidayOrOff(currentMonth, day);
      const sunday = isSunday(currentMonth, day);
      cells.push(
        <div className={`day ${holidayOrOff ? "holiday-day" : ""}`} key={k}>
          <button
            type="button"
            className="day-hit"
            onClick={() => openDiary(currentMonth, day)}
            aria-label={`${currentMonth}월 ${day}일 일기장으로 이동`}
          />
          <div className="day-top">
            <span className={`num ${holidayOrOff ? "num-red" : ""}`}>{day}</span>
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
          {holidays[k] && <div className="holiday">{holidays[k]}</div>}
          {!holidays[k] && sunday && <div className="holiday off-label">휴무일</div>}
          <div className="thumb">
            {calendarPhotos[k] ? <img src={calendarPhotos[k]} alt="캘린더 대표 사진" /> : "대표 사진 없음"}
          </div>
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

        <div className="section-title">
          <h1>
            <span className="main-title">2026년 아이폰 캘린더</span><br />
            <span className="month-subtitle">2026. {pad(currentMonth)}</span>
          </h1>
          <div className="head-actions">
            <button type="button" className="pill-btn" onClick={openTodayDiary}>TODAY 일기장</button>
            <button type="button" className="pill-btn" onClick={() => openInfo(currentMonth, 1)}>정보보관소</button>
          </div>
        </div>

        <div className="calendar">
          {weekdayLabels.map((label, index) => <div key={label} className={`weekday ${index === 0 ? "weekday-red" : ""}`}>{label}</div>)}
          {cells}
        </div>
      </section>
    );
  }

  function DiaryView() {
    const k = key(currentMonth, currentDay);
    const dayPhotos = photos[k] || [];
    const weather = currentMonth === 5 ? "구름많음" : "맑음";
    const temp = currentMonth === 5 ? "21℃" : "25℃";

    return (
      <section>
        <div className="page-head">
          <h1>2026. {pad(currentMonth)}. {pad(currentDay)} ({getWeekday(currentMonth, currentDay)})</h1>
          <div className="head-actions">
            <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>📅 캘린더</button>
            <button type="button" className="pill-btn" onClick={() => openInfo(currentMonth, currentDay)}>📂 정보 이동</button>
          </div>
        </div>

        <div className="meta">
          <span>📍 경기도 파주시 운정 2동</span>
          <span>☀️ 날씨: <strong>{weather}</strong></span>
          <span>🌡 온도: <strong>{temp}</strong></span>
          <span>🕒 조회시점: <strong>{weatherTime}</strong></span>
        </div>

        <div className="notice">현재는 임시 날씨입니다. 실제 앱에서는 기상청 API를 연결해 조회 시점 기준 날씨와 온도를 가져오면 됩니다.</div>

        <textarea value={diaryText} onChange={e => saveDiary(e.target.value, voiceText)} placeholder="오늘의 기록을 남겨보세요...." />

        <div className="box">
          <div className="box-head">
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

          {dayPhotos.length === 0 && <div className="empty-photo">사진을 찍거나 가져오면 현재 열려 있는 해당 일기장 날짜 기준으로 {tag(currentMonth, currentDay)} 자동 태그가 붙고, 선택한 사진이 월간 캘린더에 표시됩니다.</div>}
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

        <div className="box">
          <div className="box-head">
            <h3>음성 메모 / 받아쓰기</h3>
            <div className="button-row">
              <button type="button" className="soft-btn" onClick={startRecording}>🎙 녹음 시작</button>
              <button type="button" className="soft-btn" onClick={stopRecording}>⏹ 녹음 정지</button>
            </div>
          </div>
          <p className="muted">아이폰·아이패드에서는 입력창을 누른 뒤 키보드 마이크 버튼으로 받아쓰기를 사용할 수 있습니다.</p>
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

  function InfoView() {
    return (
      <section>
        <div className="box" style={{ border: "2px solid var(--deep)", minHeight: 720 }}>
          <div className="page-head" style={{ marginTop: 0 }}>
            <h2 className="info-title">📂 주요 정보 보관소 (2026. {pad(currentMonth)}. {pad(currentDay)})</h2>
            <div className="head-actions">
              <button type="button" className="pill-btn" onClick={() => openCalendar(currentMonth)}>📅 월간 캘린더</button>
              <button type="button" className="pill-btn" onClick={() => openDiary(currentMonth, currentDay)}>✍️ 일기</button>
            </div>
          </div>
          <textarea value={infoText} onChange={e => saveInfo(e.target.value)} style={{ minHeight: 520, borderStyle: "dashed" }} placeholder="오늘의 중요한 스크랩, 정보, 일정, 링크, 메모를 기록하세요." />
        </div>
      </section>
    );
  }

  return (
    <main className="app">
      {view === "calendar" && <CalendarView />}
      {view === "diary" && <DiaryView />}
      {view === "info" && <InfoView />}
    </main>
  );
}
