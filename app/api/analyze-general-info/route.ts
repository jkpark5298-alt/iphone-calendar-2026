import { NextRequest, NextResponse } from "next/server";
import {
  assertAppApiAccess,
  assertRateLimit,
  clientIpFromRequest,
  getServerGeminiApiKey,
} from "../../../lib/apiSecurity";
import { INFO_INDEX_CATEGORIES } from "../../../lib/infoIndex";

/**
 * 일반정보 AI 자동분류 API.
 * 이 앱 UI에서는 비활성화했지만, 다른 앱에서 Bearer APP_API_TOKEN /
 * GENERAL_INFO_API_TOKEN 으로 호출해 재사용할 수 있습니다.
 */

type GeneralInfoAnalyzeRequest = {
  title?: string;
  text?: string;
  sourceUrl?: string;
  fileName?: string;
  fileType?: "none" | "image" | "video";
  summary?: string;
};

type GeminiPart = {
  text?: string;
};

const PRIMARY_CATEGORIES: string[] = [...INFO_INDEX_CATEGORIES];

const stripCodeFence = (value: string) =>
  value
    .trim()
    .replace(/^~~~json\s*/i, "")
    .replace(/^~~~\s*/i, "")
    .replace(/~~~$/i, "")
    .trim();

const safeJsonParse = (value: string) => {
  const cleaned = stripCodeFence(value);

  try {
    return JSON.parse(cleaned);
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!objectMatch) throw new Error("Gemini 응답에서 JSON 객체를 찾지 못했습니다.");
    return JSON.parse(objectMatch[0]);
  }
};

const normalizeString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value.trim() : fallback;

const normalizeKeywords = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 10);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\n#]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 10);
  }

  return [];
};

const normalizePrimaryCategory = (value: unknown) => {
  const category = normalizeString(value, "기타");
  return PRIMARY_CATEGORIES.includes(category) ? category : "기타";
};

const buildPrompt = (input: GeneralInfoAnalyzeRequest) => {
  const title = normalizeString(input.title);
  const text = normalizeString(input.text);
  const sourceUrl = normalizeString(input.sourceUrl);
  const fileName = normalizeString(input.fileName);
  const fileType = normalizeString(input.fileType);
  const summary = normalizeString(input.summary);

  return [
    "당신은 일반 정보 수집 자료를 분류하고 요약하는 한국어 정보관리 AI입니다.",
    "",
    "아래 자료를 분석해서 반드시 JSON 하나만 반환하세요.",
    "마크다운, 설명문, 코드블록 없이 JSON 객체만 반환하세요.",
    "",
    "분류는 반드시 다음 목록 중 하나만 선택하세요:",
    PRIMARY_CATEGORIES.join(", "),
    "",
    "반환 JSON 형식:",
    "{",
    '  "title": "정리된 제목",',
    '  "summary": "2~3문장 요약",',
    '  "primaryCategory": "분류",',
    '  "secondaryCategory": "태그",',
    '  "thirdCategory": "보조 태그",',
    '  "keywords": ["키워드1", "키워드2", "키워드3"],',
    '  "factCheckStatus": "확인 완료" 또는 "확인 필요" 또는 "오류 가능",',
    '  "factCheckSummary": "오류 가능성, 확인 필요 사항, 수정 권고를 구체적으로 정리"',
    "}",
    "",
    "분류 기준:",
    "- " + PRIMARY_CATEGORIES.join("/") + " 중 가장 가까운 분류 선택",
    "- 아이폰, 아이패드, 맥, iOS는 애플",
    "- 의료, 운동, 영양, 수면은 건강",
    "- 인공지능, ChatGPT, Gemini, 생성형 모델은 AI",
    "- 도서, 독서, 출판은 책",
    "- 전시, 공연, 예술은 문화",
    "- 두뇌, 신경은 뇌",
    "- 광고, 브랜드는 마케팅",
    "- 스킨케어, 코스메틱은 화장품",
    "- 개봉작, 시네마는 영화",
    "- 교육, 정치, 행정은 사회",
    "- 기업, 시장, 반도체, 증시, 물가는 경제",
    "- 국가 간 관계, 해외 이슈는 국제",
    "- 사실 확인이 어려우면 factCheckStatus는 확인 필요로 설정",
    "- factCheckSummary에는 단순 요약이 아니라 오류 가능성, 확인해야 할 출처, 수정이 필요한 표현을 구체적으로 작성",
    "- 원문에 근거가 부족하면 무엇을 추가 확인해야 하는지 제안",
    "",
    "분석 대상:",
    "제목: " + (title || "(없음)"),
    "출처 URL: " + (sourceUrl || "(없음)"),
    "자료 파일명: " + (fileName || "(없음)"),
    "자료 형태: " + (fileType || "(없음)"),
    "기존 요약: " + (summary || "(없음)"),
    "",
    "본문:",
    text.slice(0, 12000) || "(본문 없음)",
  ].join("\n");
};

export async function POST(request: NextRequest) {
  try {
    const authError = assertAppApiAccess(request);
    if (authError) return authError;

    const rateError = assertRateLimit(
      `analyze:${clientIpFromRequest(request)}`,
      30,
      60_000,
    );
    if (rateError) return rateError;

    const body = (await request.json()) as GeneralInfoAnalyzeRequest;

    const apiKey = getServerGeminiApiKey(request);
    const model =
      process.env.GEMINI_TEXT_MODEL ||
      process.env.GEMINI_VISION_MODEL ||
      "gemini-2.5-flash";

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "Gemini API 키가 없습니다.",
        },
        { status: 500 },
      );
    }

    const prompt = buildPrompt(body);

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        model +
        ":generateContent?key=" +
        apiKey,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Gemini 일반 정보 분석 요청 실패",
        },
        { status: 502 },
      );
    }

    const parts = data?.candidates?.[0]?.content?.parts as GeminiPart[] | undefined;
    const text = parts?.map((part) => part.text || "").join("\n").trim() || "";

    if (!text) {
      return NextResponse.json(
        {
          ok: false,
          error: "Gemini 일반 정보 분석 응답이 비어 있습니다.",
          model,
        },
        { status: 500 },
      );
    }

    const parsed = safeJsonParse(text);

    const result = {
      title: normalizeString(parsed.title, body.title || "일반 정보 자료"),
      summary: normalizeString(parsed.summary, body.summary || ""),
      primaryCategory: normalizePrimaryCategory(parsed.primaryCategory),
      secondaryCategory: normalizeString(parsed.secondaryCategory, "일반"),
      thirdCategory: normalizeString(parsed.thirdCategory, "기타"),
      keywords: normalizeKeywords(parsed.keywords),
      factCheckStatus: normalizeString(parsed.factCheckStatus, "확인 필요"),
      factCheckSummary: normalizeString(
        parsed.factCheckSummary,
        "AI 분석 결과입니다. 중요한 정보는 원문 출처 확인이 필요합니다.",
      ),
    };

    return NextResponse.json({
      ok: true,
      model,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Gemini 일반 정보 분석 처리 중 오류가 발생했습니다.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};