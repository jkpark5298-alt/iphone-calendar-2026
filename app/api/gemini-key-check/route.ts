import { NextRequest, NextResponse } from "next/server";
import {
  assertAppApiAccess,
  assertRateLimit,
  clientIpFromRequest,
  getServerGeminiApiKey,
  applyCorsHeaders,
  corsPreflightResponse,
} from "../../../lib/apiSecurity";

/** Gemini API 키 유효성만 확인 (DB 접근 없음) */
export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const authError = assertAppApiAccess(request);
  if (authError) return applyCorsHeaders(authError, origin);

  const rateError = assertRateLimit(
    `gemini-key:${clientIpFromRequest(request)}`,
    20,
    60_000,
  );
  if (rateError) return applyCorsHeaders(rateError, origin);

  const apiKey = getServerGeminiApiKey(request);
  if (!apiKey) {
    return applyCorsHeaders(
      NextResponse.json({
        ok: false,
        geminiApiTest: {
          ok: false,
          message: "Gemini API 키가 없습니다.",
          details: "서버 GEMINI_API_KEY 또는 설정 키를 확인해 주세요.",
        },
      }),
      origin,
    );
  }

  try {
    const model = "gemini-2.5-flash";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: "Reply with OK" }],
          },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return applyCorsHeaders(
        NextResponse.json({
          ok: false,
          geminiApiTest: {
            ok: false,
            message: "Gemini API 키가 유효하지 않거나 호출에 실패했습니다.",
            details: `HTTP ${response.status}`,
            status: response.status,
          },
        }),
        origin,
      );
    }

    return applyCorsHeaders(
      NextResponse.json({
        ok: true,
        geminiApiTest: {
          ok: true,
          message: "Gemini API 키가 정상입니다.",
          status: response.status,
        },
      }),
      origin,
    );
  } catch {
    return applyCorsHeaders(
      NextResponse.json({
        ok: false,
        geminiApiTest: {
          ok: false,
          message: "Gemini API 확인 중 오류가 발생했습니다.",
          details: "네트워크 또는 타임아웃",
        },
      }),
      origin,
    );
  }
}
