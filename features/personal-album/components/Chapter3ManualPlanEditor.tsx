"use client";

import type { DayPlan, PlanScheduleSegment } from "../types";
import type { useTravelDiaryChapter3ManualState } from "../hooks/useTravelDiaryChapter3ManualState";
import type { useTravelDiaryChapter3State } from "../hooks/useTravelDiaryChapter3State";
import {
  manualDayAlbumPlaceId,
  type ManualScheduleKey,
} from "../utils/chapter3Utils";
import { formatDateSlash } from "../utils/albumDateUtils";
import { Chapter3DayPhotoLocationMap, Chapter3PhotoAlbumPanel } from "./Chapter3PhotoAlbumPanel";

type ManualState = ReturnType<typeof useTravelDiaryChapter3ManualState>;
type AlbumState = ReturnType<typeof useTravelDiaryChapter3State>;

type SegmentRef = {
  segment: PlanScheduleSegment;
  segmentIndex: number;
  scheduleKey: ManualScheduleKey;
};

function listManualScheduleSegments(plan: DayPlan): SegmentRef[] {
  const blocks: ManualScheduleKey[] = ["morningSchedule", "afternoonSchedule"];
  return blocks.flatMap((scheduleKey) =>
    (plan[scheduleKey] || []).map((segment, segmentIndex) => ({
      segment,
      segmentIndex,
      scheduleKey,
    })),
  );
}

function SegmentEditor({
  day,
  segment,
  segmentIndex,
  scheduleKey,
  tripId,
  manualState,
}: {
  day: number;
  segment: PlanScheduleSegment;
  segmentIndex: number;
  scheduleKey: ManualScheduleKey;
  tripId: string;
  manualState: ManualState;
}) {
  return (
    <div className="chapter3ManualSegment chapter3ManualSegmentTextOnly">
      <div className="chapter3ManualSegmentHead">
        <input
          className="chapter3SimInput chapter3ManualPlaceInput"
          value={segment.place || ""}
          placeholder="장소명 (수동 입력, 사진 장소와 별도)"
          onChange={(e) =>
            manualState.updateScheduleSegment(tripId, day, scheduleKey, segmentIndex, "place", e.target.value)
          }
        />
        <button
          type="button"
          className="smallActionButton danger"
          onClick={() => manualState.removeScheduleSegment(tripId, day, scheduleKey, segmentIndex)}
        >
          삭제
        </button>
      </div>
      <textarea
        className="chapter3Textarea chapter3ManualSegmentNotes"
        value={segment.notes || ""}
        placeholder="메모"
        onChange={(e) =>
          manualState.updateScheduleSegment(tripId, day, scheduleKey, segmentIndex, "notes", e.target.value)
        }
      />
    </div>
  );
}

function DayPlanEditor({
  tripId,
  plan,
  manualState,
  albumState,
}: {
  tripId: string;
  plan: DayPlan;
  manualState: ManualState;
  albumState: AlbumState;
}) {
  const dayAlbumPlaceId = manualDayAlbumPlaceId(plan.day);
  const dayPhotos = albumState.getPlacePhotos(plan.day, dayAlbumPlaceId);
  const scheduleSegments = listManualScheduleSegments(plan);

  return (
    <div className="chapter3ManualDayEditor">
      <div className="chapter3ManualDayFields">
        <label>
          일차 제목
          <input
            className="chapter3SimInput"
            value={plan.title}
            onChange={(e) => manualState.updateDayPlanField(tripId, plan.day, "title", e.target.value)}
          />
        </label>
        <label>
          날짜 표시
          <input
            className="chapter3SimInput"
            value={plan.dateLabel || ""}
            onChange={(e) => manualState.updateDayPlanField(tripId, plan.day, "dateLabel", e.target.value)}
          />
        </label>
      </div>

      <label className="chapter3FieldLabel">
        일차 메모
        <textarea
          className="chapter3Textarea"
          value={plan.note}
          onChange={(e) => manualState.updateDayPlanField(tripId, plan.day, "note", e.target.value)}
        />
      </label>

      <section className="chapter3ManualScheduleBlock">
        <Chapter3PhotoAlbumPanel
          day={plan.day}
          placeId={dayAlbumPlaceId}
          placeName="사진 앨범"
          photos={dayPhotos}
          albumState={albumState}
          defaultOpen
          regionHint={manualState.activeTrip?.planRequest.destinations}
        />
      </section>

      <section className="chapter3ManualScheduleBlock">
        <div className="chapter3ManualScheduleHead">
          <h5>장소 메모</h5>
          <button
            type="button"
            className="smallActionButton"
            onClick={() => manualState.addScheduleSegment(tripId, plan.day, "morningSchedule")}
          >
            + 장소 메모
          </button>
        </div>

        {scheduleSegments.length > 0 && (
          <div className="chapter3ManualSegmentList">
            {scheduleSegments.map(({ segment, segmentIndex, scheduleKey }) => (
              <SegmentEditor
                key={segment.segmentId || `${scheduleKey}-${segmentIndex}`}
                day={plan.day}
                segment={segment}
                segmentIndex={segmentIndex}
                scheduleKey={scheduleKey}
                tripId={tripId}
                manualState={manualState}
              />
            ))}
          </div>
        )}
      </section>

      <Chapter3DayPhotoLocationMap photos={dayPhotos} day={plan.day} albumState={albumState} />
    </div>
  );
}

export function Chapter3ManualPlanEditor({
  manualState,
  albumState,
}: {
  manualState: ManualState;
  albumState: AlbumState;
}) {
  const trip = manualState.activeTrip;
  if (!trip) {
    return (
      <div className="chapter3ManualEmpty">
        <p className="chapter3Muted">기존 여행 계획이 없습니다. 새 여행을 추가해 주세요.</p>
        <button type="button" className="primaryButton" onClick={manualState.addTrip}>
          + 기존 여행 추가
        </button>
      </div>
    );
  }

  const editingPlan =
    trip.dayPlans.find((d) => d.day === manualState.editingDay) || trip.dayPlans[0];

  return (
    <div className="chapter3ManualPlanEditor">
      <div className="chapter3ManualTripBar">
        <select
          className="chapter3SimSelect"
          value={trip.id}
          onChange={(e) => manualState.selectTrip(e.target.value)}
        >
          {manualState.trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <button type="button" className="secondaryButton" onClick={manualState.addTrip}>
          + 새 여행
        </button>
        <button type="button" className="smallActionButton danger" onClick={() => manualState.removeTrip(trip.id)}>
          삭제
        </button>
      </div>

      <div className="chapter3ManualMetaGrid">
        <label>
          여행 제목
          <input
            className="chapter3SimInput"
            value={trip.title}
            onChange={(e) => manualState.updateTripMeta(trip.id, { title: e.target.value })}
          />
        </label>
        <label>
          여행지
          <input
            className="chapter3SimInput"
            value={trip.planRequest.destinations}
            placeholder="예: 전주, 오사카"
            onChange={(e) => manualState.updatePlanRequest(trip.id, { destinations: e.target.value })}
          />
        </label>
        <label>
          출발일
          <input
            type="date"
            className="chapter3SimInput"
            value={trip.planRequest.startDate}
            onChange={(e) => manualState.updatePlanRequest(trip.id, { startDate: e.target.value })}
          />
          {trip.planRequest.startDate && (
            <span className="chapter3DateSlashLabel">
              {formatDateSlash(trip.planRequest.startDate)}
            </span>
          )}
        </label>
        <label>
          종료일
          <input
            type="date"
            className="chapter3SimInput"
            value={trip.planRequest.endDate}
            onChange={(e) => manualState.updatePlanRequest(trip.id, { endDate: e.target.value })}
          />
          {trip.planRequest.endDate && (
            <span className="chapter3DateSlashLabel">
              {formatDateSlash(trip.planRequest.endDate)}
            </span>
          )}
        </label>
        <label>
          출발지
          <input
            className="chapter3SimInput"
            value={trip.planRequest.departure}
            onChange={(e) => manualState.updatePlanRequest(trip.id, { departure: e.target.value })}
          />
        </label>
        <label>
          인원
          <input
            className="chapter3SimInput"
            value={trip.planRequest.travelers}
            onChange={(e) => manualState.updatePlanRequest(trip.id, { travelers: e.target.value })}
          />
        </label>
      </div>

      <div className="chapter3DayTabs">
        {trip.dayPlans.map((dp) => (
          <button
            key={dp.day}
            type="button"
            className={`chapter3DayTab ${manualState.editingDay === dp.day ? "active" : ""}`}
            onClick={() => manualState.setEditingDay(dp.day)}
          >
            {dp.dateLabel || `${dp.day}일차`}
            {trip.dayPlans.length > 1 && (
              <span
                className="chapter3DayTabRemove"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  manualState.removeDay(trip.id, dp.day);
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button type="button" className="chapter3DayTab chapter3DayTabAdd" onClick={() => manualState.addDay(trip.id)}>
          + 일차
        </button>
      </div>

      {editingPlan && (
        <DayPlanEditor
          tripId={trip.id}
          plan={editingPlan}
          manualState={manualState}
          albumState={albumState}
        />
      )}
    </div>
  );
}
