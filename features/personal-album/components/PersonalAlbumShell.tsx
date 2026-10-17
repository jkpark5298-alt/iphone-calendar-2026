"use client";

/**
 * 개인 앨범 전용 셸 — Chapter3MapAlbum 을 personalOnly 로 고정해서 사용한다.
 * (여행 앨범/지도 탭 숨김, 계획서(planRequest/dayPlans)는 빈 스텁)
 */

import React from "react";
import type { PlanRequest } from "../types";
import { Chapter3MapAlbum } from "./Chapter3MapAlbum";

const EMPTY_PLAN_REQUEST: PlanRequest = {
  startDate: "",
  endDate: "",
  departure: "",
  destinations: "",
  travelers: "",
  budget: "",
  transportPreference: "",
  accommodationPreference: "",
  styles: [],
};

const EMPTY_DAY_PLANS: React.ComponentProps<typeof Chapter3MapAlbum>["dayPlans"] = [];

export interface PersonalAlbumShellProps {
  showPasteHint: (msg: string) => void;
}

export function PersonalAlbumShell({ showPasteHint }: PersonalAlbumShellProps) {
  return (
    <Chapter3MapAlbum
      personalOnly
      panelMode="albums"
      planRequest={EMPTY_PLAN_REQUEST}
      dayPlans={EMPTY_DAY_PLANS}
      additionalTravelInfo={null}
      isPlanConfirmed={false}
      activePlanId={null}
      effectiveDeparture=""
      showPasteHint={showPasteHint}
    />
  );
}
