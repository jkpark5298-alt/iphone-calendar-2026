import { NextRequest, NextResponse } from "next/server";

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

const PRIMARY_CATEGORIES = [
  "정치",
  "행정",
  "경제",
  "산업",
  "사회",
  "교육",
  "문화",
  "예술",
  "과학",
  "기술",
  "국제",
  "외교",
  "국방",
  "안보",
];

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
  const category = normalizeString(value, "사회");
  return PRIMARY_CATEGORIES.includes(category) ? category : "사회";
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
    "1차 분류는 반드시 다음 목록 중 하나만 선택하세요:",
    PRIMARY_CATEGORIES.join(", "),
    "",
    "반환 JSON 형식:",
    "{",
    '  "title": "정리된 제목",',
    '  "summary": "2~3문장 요약",',
    '  "primaryCategory": "1차 분류",',
    '  "secondaryCategory": "2차 분류",',
    '  "thirdCategory": "3차 분류",',
    '  "keywords": ["키워드1", "키워드2", "키워드3"],',
    '  "factCheckStatus": "확인 완료" 또는 "확인 필요" 또는 "오류 가능",',
    '  "factCheckSummary": "오류 가능성, 확인 필요 사항, 수정 권고를 구체적으로 정리"',
    "}",
    "",
    "분류 기준:",
    "- 정치/행정/경제/산업/사회/교육/문화/예술/과학/기술/국제/외교/국방/안보 중 가장 가까운 1차 분류 선택",
    "- 연예, 콘텐츠, 공연, 패션, 영화, 음악은 대체로 문화 또는 예술로 분류",
    "- 기업, 시장, 공급망, 반도체, 증시, 물가, 산업동향은 경제 또는 산업으로 분류",
    "- 국가 간 관계, 해외 이슈, 국제 행사, 외교 현안은 국제 또는 외교로 분류",
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
    const body = (await request.json()) as GeneralInfoAnalyzeRequest;

    const apiKey = request.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
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
          status: response.status,
          detail: JSON.stringify(data, null, 2),
          model,
        },
        { status: 500 },
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