"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TravelPlaceCategory, TravelPlaceRecord } from "../types";
import { useTravelPlacesDb } from "../hooks/TravelPlacesDbContext";
import {
  formatTravelPlaceInputDate,
  findSimilarTravelPlaces,
  isDomesticPlaceRecord,
  normalizeTravelPlaceCategory,
  openTravelPlaceExternalMap,
  TRAVEL_PLACE_CATEGORIES,
  travelPlaceCategoryLabel,
  travelPlaceLabel,
  travelPlaceNamePlaceholder,
} from "../utils/travelPlacesDb";

export type PlaceSuggestion = {
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  phone?: string;
  source: "db" | "api";
  recordId?: string;
  category?: TravelPlaceCategory;
};

type TravelPlaceLookupFieldsProps = {
  recordId?: string;
  name: string;
  address: string;
  onNameChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onCountryChange?: (value: string) => void;
  onCityChange?: (value: string) => void;
  onMapRegionChange?: (value: "domestic" | "overseas") => void;
  onCategoryChange?: (value: TravelPlaceCategory) => void;
  onPhoneChange?: (value: string) => void;
  regionHint?: string;
  country?: string;
  city?: string;
  area?: string;
  phone?: string;
  mapRegion?: "domestic" | "overseas";
  category?: TravelPlaceCategory;
  namePlaceholder?: string;
  addressPlaceholder?: string;
  layout?: "row" | "stack";
  /**
   * true면 blur/제안 선택 시 즉시 DB 저장.
   * 기본 false — 「DB에 추가」 버튼으로만 저장.
   */
  autoSave?: boolean;
  /** autoSave=false일 때 「DB에 추가」 버튼 표시 (기본 true) */
  showAddToDbButton?: boolean;
  showNameField?: boolean;
  /** 국가·도시 입력 필드 표시 (Ch4 등) */
  showCountryCityFields?: boolean;
  /** 연락처 필드 (Ch4 등) */
  showPhoneField?: boolean;
  /** 국내/해외 지도 구분 토글 (Ch4 등) */
  showMapRegionToggle?: boolean;
  /** 여행지/식당/숙소/카페/쇼핑 구분 (Ch4 등) */
  showCategoryToggle?: boolean;
  /** true면 여행지명+주소가 모두 있을 때만 저장 */
  requireCompletePlace?: boolean;
  /** 지도용 주소 권장 힌트 표시 (기본 true) */
  showAddressHint?: boolean;
  onSaved?: (record: TravelPlaceRecord) => void;
};

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function normalizePlaceName(value: string): string {
  return value.trim().toLowerCase();
}

function isCloseNameMatch(typed: string, suggestion: string): boolean {
  const a = normalizePlaceName(typed);
  const b = normalizePlaceName(suggestion);
  if (!a || !b) return false;
  if (a === b) return true;
  return b.includes(a) || a.includes(b);
}

/** 방법1: DB 일치·단일 결과·이름 유사 시 자동 주소 채움 후보 선택 */
function pickAutoFillSuggestion(
  typedName: string,
  items: PlaceSuggestion[],
): PlaceSuggestion | null {
  if (items.length === 0) return null;

  const exact = items.find(
    (s) =>
      s.address.trim() &&
      normalizePlaceName(s.name) === normalizePlaceName(typedName),
  );
  if (exact) return exact;

  const withAddress = items.filter((s) => s.address.trim());
  if (withAddress.length === 1) return withAddress[0];

  const top = withAddress[0];
  if (top && isCloseNameMatch(typedName, top.name)) return top;

  return null;
}

export function TravelPlaceLookupFields({
  recordId,
  name,
  address,
  onNameChange,
  onAddressChange,
  onCountryChange,
  onCityChange,
  onMapRegionChange,
  onCategoryChange,
  onPhoneChange,
  regionHint = "",
  country = "",
  city = "",
  area = "",
  phone = "",
  mapRegion,
  category,
  namePlaceholder,
  addressPlaceholder = "주소 (예: 전북 전주시 완산구 기린대로 99)",
  layout = "stack",
  autoSave = false,
  showAddToDbButton = true,
  showNameField = true,
  showCountryCityFields = false,
  showPhoneField = false,
  showMapRegionToggle = false,
  showCategoryToggle = false,
  requireCompletePlace = false,
  showAddressHint = true,
  onSaved,
}: TravelPlaceLookupFieldsProps) {
  const db = useTravelPlacesDb();
  const [activeField, setActiveField] = useState<"name" | "address" | null>(null);
  const [apiSuggestions, setApiSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loadingApi, setLoadingApi] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const resolvedCategory = normalizeTravelPlaceCategory(category);
  const resolvedNamePlaceholder =
    namePlaceholder ?? travelPlaceNamePlaceholder(resolvedCategory);

  const showAddress = Boolean(name.trim() || address.trim());
  const canAddToDb =
    Boolean(name.trim() || address.trim()) &&
    !(requireCompletePlace && (!name.trim() || !address.trim()));
  const lookupContext = useMemo(
    () => ({ name, address, country, city, area, mapRegion }),
    [name, address, country, city, area, mapRegion],
  );
  const isDomestic = useMemo(
    () => isDomesticPlaceRecord(lookupContext),
    [lookupContext],
  );
  const debouncedQuery = useDebouncedValue(
    activeField === "address" ? address : activeField === "name" ? name : "",
    350,
  );

  const dbSuggestions = useMemo((): PlaceSuggestion[] => {
    if (!debouncedQuery.trim()) return [];
    return db.searchPlaces(debouncedQuery).slice(0, 6).map((p) => ({
      name: p.name,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
      phone: p.phone,
      source: "db" as const,
      recordId: p.id,
      category: normalizeTravelPlaceCategory(p.category),
    }));
  }, [db, debouncedQuery]);

  useEffect(() => {
    if (!activeField || !debouncedQuery.trim()) {
      setApiSuggestions([]);
      return;
    }

    // 국내·해외 모두 Google Places 조회 (국내는 regionCode=KR 편향)
    let cancelled = false;
    const run = async () => {
      setLoadingApi(true);
      try {
        const hint = [country, city, area, regionHint].filter(Boolean).join(" ");
        const searchText =
          activeField === "address" && name.trim()
            ? `${name} ${debouncedQuery}`.trim()
            : debouncedQuery;
        const res = await fetch("/api/places-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: searchText,
            regionHint: hint,
            mapRegion: isDomestic ? "domestic" : "overseas",
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          suggestions?: Array<{
            name: string;
            address: string;
            lat?: number;
            lng?: number;
            phone?: string;
          }>;
        };
        if (cancelled) return;
        setApiSuggestions(
          (data.suggestions ?? []).map((s) => ({
            ...s,
            source: "api" as const,
          })),
        );
      } catch {
        if (!cancelled) setApiSuggestions([]);
      } finally {
        if (!cancelled) setLoadingApi(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, activeField, country, city, area, regionHint, isDomestic, name]);

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const merged: PlaceSuggestion[] = [];
    for (const item of [...dbSuggestions, ...apiSuggestions]) {
      const key = `${item.name}|${item.address}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged.slice(0, 8);
  }, [dbSuggestions, apiSuggestions]);

  const showDropdown = Boolean(activeField && debouncedQuery.trim() && suggestions.length > 0);

  const buildRecordToSave = useCallback(
    (overrides?: {
      name?: string;
      address?: string;
      phone?: string;
      lat?: number;
      lng?: number;
      category?: TravelPlaceCategory;
      id?: string;
    }) => {
      const resolvedRegion = mapRegion ?? (isDomestic ? "domestic" : "overseas");
      const id = overrides?.id ?? recordId ?? `tp-${Date.now()}`;
      const existing = db.places.find((p) => p.id === id);
      return {
        id,
        name: (overrides?.name ?? name).trim(),
        address: (overrides?.address ?? address).trim(),
        country: country.trim(),
        city: city.trim(),
        area: area.trim(),
        phone: (overrides?.phone ?? phone).trim(),
        category: overrides?.category
          ? normalizeTravelPlaceCategory(overrides.category)
          : resolvedCategory,
        mapRegion: resolvedRegion,
        photos: existing?.photos ?? [],
        lat: overrides?.lat ?? existing?.lat,
        lng: overrides?.lng ?? existing?.lng,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    [
      recordId,
      name,
      address,
      country,
      city,
      area,
      phone,
      mapRegion,
      resolvedCategory,
      isDomestic,
      db.places,
    ],
  );

  const saveToDb = useCallback(
    (record: ReturnType<typeof buildRecordToSave>, skipSimilarConfirm = false) => {
      if (!record.name && !record.address) return null;
      if (requireCompletePlace && (!record.name || !record.address)) return null;

      if (!skipSimilarConfirm) {
        const similar = findSimilarTravelPlaces(db.places, record);
        if (similar.length > 0) {
          const top = similar[0];
          const kind = top.match === "exact" ? "동일" : "유사";
          const proceed = window.confirm(
            `${kind} 장소가 이미 있습니다.\n「${travelPlaceLabel(top.place)}」\n\n확인: 새로 저장\n취소: 저장하지 않음`,
          );
          if (!proceed) return null;
        }
      }

      const saved = db.savePlace(record);
      onSaved?.(saved);
      return saved;
    },
    [db, requireCompletePlace, onSaved, buildRecordToSave],
  );

  const persistCurrent = useCallback(() => {
    if (!autoSave) return;
    saveToDb(buildRecordToSave(), true);
  }, [autoSave, saveToDb, buildRecordToSave]);

  const handleAddToDb = useCallback(() => {
    if (!canAddToDb || addBusy) return;
    setAddBusy(true);
    try {
      const saved = saveToDb(buildRecordToSave());
      if (saved) {
        // hint is via onSaved if parent wants
      }
    } finally {
      setAddBusy(false);
    }
  }, [canAddToDb, addBusy, saveToDb, buildRecordToSave]);

  const applySuggestion = useCallback(
    (item: PlaceSuggestion) => {
      onNameChange(item.name || name);
      onAddressChange(item.address || address);
      if (item.phone && onPhoneChange) onPhoneChange(item.phone);
      setActiveField(null);

      if (!autoSave) return;

      const existingId = item.recordId ?? recordId;
      const existing = existingId
        ? db.places.find((p) => p.id === existingId)
        : undefined;
      saveToDb(
        buildRecordToSave({
          id: existingId ?? `tp-${Date.now()}`,
          name: item.name,
          address: item.address,
          phone: item.phone,
          lat: item.lat ?? existing?.lat,
          lng: item.lng ?? existing?.lng,
          category: item.category
            ? normalizeTravelPlaceCategory(item.category)
            : existing
              ? normalizeTravelPlaceCategory(existing.category)
              : resolvedCategory,
        }),
        true,
      );
    },
    [
      onNameChange,
      onAddressChange,
      onPhoneChange,
      name,
      address,
      autoSave,
      recordId,
      db.places,
      saveToDb,
      buildRecordToSave,
      resolvedCategory,
    ],
  );

  const tryAutoFillAddressOnNameBlur = useCallback(async (): Promise<boolean> => {
    const trimmedName = name.trim();
    if (!trimmedName || address.trim()) return false;

    const exactDb = db
      .searchPlaces(trimmedName)
      .find(
        (p) =>
          p.address.trim() &&
          normalizePlaceName(p.name) === normalizePlaceName(trimmedName),
      );
    if (exactDb) {
      applySuggestion({
        name: exactDb.name,
        address: exactDb.address,
        lat: exactDb.lat,
        lng: exactDb.lng,
        source: "db",
        recordId: exactDb.id,
      });
      return true;
    }

    setLoadingApi(true);
    try {
      const hint = [country, city, area, regionHint].filter(Boolean).join(" ");
      const res = await fetch("/api/places-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmedName,
          regionHint: hint,
          mapRegion: isDomestic ? "domestic" : "overseas",
        }),
      });
      const data = (await res.json()) as {
        suggestions?: Array<{
          name: string;
          address: string;
          lat?: number;
          lng?: number;
          phone?: string;
        }>;
      };
      const apiItems: PlaceSuggestion[] = (data.suggestions ?? []).map((s) => ({
        ...s,
        source: "api" as const,
      }));
      const pick = pickAutoFillSuggestion(trimmedName, apiItems);
      if (pick) {
        applySuggestion(pick);
        return true;
      }
    } catch {
      // ignore — 사용자가 드롭다운에서 직접 선택 가능
    } finally {
      setLoadingApi(false);
    }
    return false;
  }, [
    name,
    address,
    country,
    city,
    area,
    regionHint,
    isDomestic,
    db,
    applySuggestion,
  ]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setActiveField(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const layoutClass = layout === "row" ? "travelPlaceLookupRow" : "travelPlaceLookupStack";

  return (
    <div className={`travelPlaceLookup ${layoutClass}`} ref={wrapRef}>
      {showCategoryToggle && (
        <div className="travelPlaceCategoryRow">
          <span className="travelPlaceCategoryLabel">장소 구분</span>
          <div
            className="travelPlaceCategoryToggle"
            role="group"
            aria-label="여행지 장소 구분"
          >
            {TRAVEL_PLACE_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`travelPlaceCategoryButton ${resolvedCategory === cat ? "active" : ""}`}
                onClick={() => onCategoryChange?.(cat)}
              >
                {travelPlaceCategoryLabel(cat)}
              </button>
            ))}
          </div>
        </div>
      )}

      {showMapRegionToggle && (
        <div className="travelPlaceMapRegionRow">
          <span className="travelPlaceMapRegionLabel">지도 구분</span>
          <div className="chapter3MapRegionToggle" role="group" aria-label="국내/해외 지도 구분">
            <button
              type="button"
              className={`chapter3MapModeButton ${isDomestic ? "active" : ""}`}
              onClick={() => onMapRegionChange?.("domestic")}
            >
              국내 · 네이버
            </button>
            <button
              type="button"
              className={`chapter3MapModeButton ${!isDomestic ? "active" : ""}`}
              onClick={() => onMapRegionChange?.("overseas")}
            >
              해외 · 구글
            </button>
          </div>
        </div>
      )}

      {showNameField && (
      <label className="travelPlaceLookupField">
        {travelPlaceCategoryLabel(resolvedCategory)}명
        <input
          className="travelPlaceLookupInput"
          value={name}
          placeholder={resolvedNamePlaceholder}
          onChange={(e) => onNameChange(e.target.value)}
          onFocus={() => setActiveField("name")}
          onBlur={() => {
            window.setTimeout(() => {
              void (async () => {
                const filled = await tryAutoFillAddressOnNameBlur();
                if (filled) return;
                if (!address.trim() && name.trim()) return;
                persistCurrent();
              })();
            }, 180);
          }}
        />
      </label>
      )}

      {(showNameField ? showAddress : Boolean(name.trim() || address.trim())) && (
        <label className="travelPlaceLookupField">
          주소
          <input
            className="travelPlaceLookupInput"
            value={address}
            placeholder={addressPlaceholder}
            onChange={(e) => onAddressChange(e.target.value)}
            onFocus={() => setActiveField("address")}
            onBlur={() => {
              window.setTimeout(() => persistCurrent(), 150);
            }}
          />
        </label>
      )}

      {showCountryCityFields && (
        <div className="travelPlaceLookupMetaRow">
          <label className="travelPlaceLookupField">
            국가
            <input
              className="travelPlaceLookupInput"
              value={country}
              placeholder="예: 한국, 일본"
              onChange={(e) => onCountryChange?.(e.target.value)}
              onBlur={() => {
                window.setTimeout(() => persistCurrent(), 150);
              }}
            />
          </label>
          <label className="travelPlaceLookupField">
            도시
            <input
              className="travelPlaceLookupInput"
              value={city}
              placeholder="예: 서울, 도쿄"
              onChange={(e) => onCityChange?.(e.target.value)}
              onBlur={() => {
                window.setTimeout(() => persistCurrent(), 150);
              }}
            />
          </label>
        </div>
      )}

      {showPhoneField && (
        <label className="travelPlaceLookupField">
          연락처
          <input
            className="travelPlaceLookupInput"
            value={phone}
            placeholder="예: 02-1234-5678"
            inputMode="tel"
            onChange={(e) => onPhoneChange?.(e.target.value)}
            onBlur={() => {
              window.setTimeout(() => persistCurrent(), 150);
            }}
          />
        </label>
      )}

      {showDropdown && (
        <ul className="travelPlaceLookupDropdown" role="listbox">
          {suggestions.map((item, idx) => (
            <li key={`${item.source}-${idx}`}>
              <button
                type="button"
                className="travelPlaceLookupOption"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applySuggestion(item)}
              >
                <span className="travelPlaceLookupOptionBadge">
                  {item.source === "db"
                    ? travelPlaceCategoryLabel(item.category)
                    : "조회"}
                </span>
                <strong>{item.name || travelPlaceLabel(item)}</strong>
                {item.address && <small>{item.address}</small>}
                {item.phone && <small>{item.phone}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {loadingApi && activeField && debouncedQuery.trim() && (
        <p className="travelPlaceLookupHint">주소 조회 중…</p>
      )}

      {showAddressHint && name.trim() && !address.trim() && (
        <p className="travelPlaceLookupHint travelPlaceAddressRecommend">
          지도 표시에는 <strong>도로명 주소</strong> 입력을 권장합니다.
          {" "}이름 입력 시 국내·해외 Places 후보에서 주소를 자동으로 채울 수 있습니다.
        </p>
      )}

      {!autoSave && showAddToDbButton && (
        <div className="travelPlaceAddToDbRow">
          <button
            type="button"
            className="secondaryButton travelPlaceAddToDbButton"
            disabled={!canAddToDb || addBusy}
            onClick={handleAddToDb}
            title="4번 챕터 여행지 DB에 명시적으로 추가"
          >
            {addBusy ? "추가 중…" : "DB에 추가"}
          </button>
          <span className="travelPlaceLookupHint">
            입력만으로는 DB에 저장되지 않습니다. 필요할 때 버튼을 누르세요.
          </span>
        </div>
      )}
    </div>
  );
}

/** 3장 여행지 DB 조회 — 이름 클릭 시 주소 표시, 선택 시 복사 */
export function TravelPlaceDbLookupPanel({
  showPasteHint,
  onViewMap,
}: {
  showPasteHint: (msg: string) => void;
  onViewMap?: (place: TravelPlaceRecord) => void;
}) {
  const db = useTravelPlacesDb();
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return db.searchPlaces(query).filter((p) => p.name.trim() || p.address.trim());
  }, [db, query]);

  const copyPlace = async (place: TravelPlaceRecord) => {
    const text = place.address.trim()
      ? `${place.name.trim()}\n${place.address.trim()}`
      : place.name.trim();
    try {
      await navigator.clipboard.writeText(text);
      showPasteHint(`📋 복사됨: ${place.name || place.address}`);
    } catch {
      showPasteHint("⚠️ 클립보드 복사에 실패했습니다.");
    }
  };

  const openMap = (place: TravelPlaceRecord) => {
    if (onViewMap) {
      onViewMap(place);
      return;
    }
    openTravelPlaceExternalMap(place);
    const provider = isDomesticPlaceRecord(place) ? "네이버" : "구글";
    showPasteHint(`🗺️ ${provider} 지도에서 엽니다.`);
  };

  return (
    <div className="travelPlaceDbSearch travelPlaceDbLookupPanel">
      <label>
        여행지 DB 조회
        <input
          className="travelPlaceLookupInput"
          value={query}
          placeholder="여행지명·주소로 검색"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {query.trim() && (
        <p className="travelPlaceLookupHint">검색 결과 {results.length}건</p>
      )}

      {!query.trim() ? (
        <p className="chapter3Muted">여행지명·주소를 입력하면 저장된 여행지를 검색합니다.</p>
      ) : results.length === 0 ? (
        <p className="chapter3Muted">일치하는 여행지가 없습니다.</p>
      ) : (
        <ul className="travelPlaceDbSearchList">
          {results.map((place) => {
            const expanded = expandedId === place.id;
            return (
              <li key={place.id} className={expanded ? "expanded" : ""}>
                <button
                  type="button"
                  className="travelPlaceDbSearchItem"
                  onClick={() => setExpandedId(expanded ? null : place.id)}
                >
                  <div className="travelPlaceDbSearchItemMain">
                    <strong>
                      <span className="travelPlaceCategoryChip compact">
                        {travelPlaceCategoryLabel(place.category)}
                      </span>{" "}
                      {place.name || "(이름 없음)"}
                    </strong>
                    <span className="travelPlaceDbSearchDate">
                      입력 {formatTravelPlaceInputDate(place.createdAt)}
                    </span>
                  </div>
                  {!expanded && place.address && (
                    <small className="travelPlaceDbSearchPreview">주소 보기 ▼</small>
                  )}
                </button>

                {expanded && (
                  <div className="travelPlaceDbSearchDetail">
                    {place.address ? (
                      <p className="travelPlaceDbSearchAddress">📫 {place.address}</p>
                    ) : (
                      <p className="chapter3Muted">등록된 주소가 없습니다.</p>
                    )}
                    <div className="travelPlaceDbSearchDetailActions">
                      <button
                        type="button"
                        className="smallActionButton"
                        onClick={() => void copyPlace(place)}
                      >
                        주소 복사
                      </button>
                      <button
                        type="button"
                        className="smallActionButton"
                        onClick={(e) => {
                          e.stopPropagation();
                          openMap(place);
                        }}
                      >
                        지도 보기
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 저장된 여행지만 검색 (1·2장용 — 선택 시 폼에 반영) */
export function TravelPlaceDbSearch({
  onSelect,
  placeholder = "여행지명·주소로 검색",
}: {
  onSelect: (place: TravelPlaceRecord) => void;
  placeholder?: string;
}) {
  const db = useTravelPlacesDb();
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    if (!query.trim()) return [];
    return db.searchPlaces(query).filter((p) => p.name.trim() || p.address.trim());
  }, [db, query]);

  return (
    <div className="travelPlaceDbSearch">
      <label>
        여행지 DB 조회
        <input
          className="travelPlaceLookupInput"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {query.trim() && (
        <p className="travelPlaceLookupHint">검색 결과 {results.length}건</p>
      )}
      {!query.trim() ? (
        <p className="chapter3Muted">4번 챕터에 등록된 여행지를 검색해 선택하세요.</p>
      ) : results.length === 0 ? (
        <p className="chapter3Muted">일치하는 여행지가 없습니다. 4번 챕터「여행지 DB 명명」에서 먼저 등록하세요.</p>
      ) : (
        <ul className="travelPlaceDbSearchList">
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                className="travelPlaceDbSearchItem"
                onClick={() => onSelect(place)}
              >
                <strong>
                  <span className="travelPlaceCategoryChip compact">
                    {travelPlaceCategoryLabel(place.category)}
                  </span>{" "}
                  {place.name || "(이름 없음)"}
                </strong>
                {place.address && <small>{place.address}</small>}
                {(place.city || place.country) && (
                  <span className="travelPlaceDbSearchMeta">
                    {[place.country, place.city].filter(Boolean).join(" · ")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
