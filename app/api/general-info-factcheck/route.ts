import { NextResponse } from "next/server";

type FactCheckRequest = {
  title?: string;
  text?: string;
  formattedTextHtml?: string;
  sourceUrl?: string;
  summary?: string;
  factCheckSummary?: string;
  extraNote?: string;
  categoryPath?: string;
  keywords?: string[];
  pdfText?: string;
  mediaSummary?: string;
  mediaItems?: Array<Record<string, unknown>>;
};

type InlineMediaPart = {
  inlineData: {
    mimeType: string;
    data: string;
  };
};

const MAX_INLINE_MEDIA = 6;
const MAX_INLINE_BYTES = 4_000_000;

const getString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const parseDataUrl = (value: unknown): InlineMediaPart | null => {
  const raw = getString(value);
  const match = raw.match(/^data:([^;]+);base64,(.+)$/);

  if (!match) return null;

  const mimeType = match[1];
  const data = match[2];

  if (!mimeType || !data) return null;
  if (data.length > MAX_INLINE_BYTES) return null;

  if (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf" ||
    mimeType === "text/plain"
  ) {
    return {
      inlineData: {
        mimeType,
        data,
      },
    };
  }

  return null;
};

const extractSrcFromHtml = (html: string): string[] => {
  const found: string[] = [];
  const re = /<(?:img|video)[^>]+src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const src = String(match[1] || "").trim();
    if (src && !found.includes(src)) found.push(src);
  }
  return found;
};

const htmlToPlainHint = (html: string) =>
  String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const fetchUrlAsInlinePart = async (url: string): Promise<InlineMediaPart | null> => {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return null;
    const mimeType = (response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!mimeType.startsWith("image/") && mimeType !== "application/pdf") return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_INLINE_BYTES) return null;
    return {
      inlineData: {
        mimeType,
        data: buffer.toString("base64"),
      },
    };
  } catch {
    return null;
  }
};

const resolveInlinePart = async (value: unknown): Promise<InlineMediaPart | null> => {
  const raw = getString(value);
  if (!raw) return null;
  const fromData = parseDataUrl(raw);
  if (fromData) return fromData;
  return fetchUrlAsInlinePart(raw);
};

const buildMediaEvidence = async (payload: FactCheckRequest) => {
  const mediaItems = Array.isArray(payload.mediaItems) ? payload.mediaItems : [];
  const inlineParts: InlineMediaPart[] = [];
  const mediaTextLines: string[] = [];
  const seenData = new Set<string>();

  const pushInline = (part: InlineMediaPart | null) => {
    if (!part || inlineParts.length >= MAX_INLINE_MEDIA) return;
    const key = part.inlineData.data.slice(0, 80);
    if (seenData.has(key)) return;
    seenData.add(key);
    inlineParts.push(part);
  };

  for (const [index, item] of mediaItems.entries()) {
    const label = "자료 " + (index + 1);
    const type = getString(item.type);
    const fileName =
      getString(item.fileName) ||
      getString(item.name) ||
      getString(item.filename) ||
      "파일명 없음";
    const description =
      getString(item.description) ||
      getString(item.caption) ||
      getString(item.text) ||
      getString(item.memo);
    const sourceUrl =
      getString(item.url) ||
      getString(item.fileUrl) ||
      getString(item.sourceUrl) ||
      getString(item.previewUrl);

    mediaTextLines.push(
      [
        "[" + label + "]",
        "- 종류: " + (type || "알 수 없음"),
        "- 파일명: " + fileName,
        description ? "- 설명/추출 Text: " + description : "",
        sourceUrl && !sourceUrl.startsWith("data:")
          ? "- 자료 URL: " + sourceUrl
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    const candidates = [
      item.preview,
      item.dataUrl,
      item.previewUrl,
      item.filePreview,
      item.fileUrl,
      item.url,
      item.src,
      item.base64,
    ];

    for (const candidate of candidates) {
      const parsed = await resolveInlinePart(candidate);
      if (parsed) {
        pushInline(parsed);
        break;
      }
    }
  }

  const htmlSrcList = extractSrcFromHtml(getString(payload.formattedTextHtml));
  for (const [index, src] of htmlSrcList.entries()) {
    mediaTextLines.push(`[본문 인라인 이미지 ${index + 1}]\n- src 포함`);
    pushInline(await resolveInlinePart(src));
  }

  return {
    inlineParts,
    mediaText: mediaTextLines.join("\n\n"),
  };
};

const buildFallbackReport = (payload: FactCheckRequest) => {
  const bodyFromHtml = htmlToPlainHint(getString(payload.formattedTextHtml));
  const sourceText = [
    payload.text,
    bodyFromHtml && bodyFromHtml !== getString(payload.text) ? bodyFromHtml : "",
    payload.summary,
    payload.factCheckSummary,
    payload.extraNote,
    payload.pdfText,
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  const hasEnoughText = sourceText.length >= 80;

  const status = hasEnoughText ? "확인 필요" : "자료 부족";

  const result = [
    "# 초등학생도 이해할 수 있는 쉬운 보고서",
    "",
    "## 1. 주제",
    payload.title || "제목 없음",
    "",
    "## 2. 이 자료가 말하는 내용",
    sourceText
      ? sourceText.slice(0, 900)
      : "저장된 Text가 부족해서 자세한 내용을 확인하기 어렵습니다.",
    "",
    "## 3. 근거로 볼 수 있는 자료",
    payload.sourceUrl
      ? "- 저장된 출처 URL: " + payload.sourceUrl
      : "- 저장된 출처 URL이 없습니다.",
    payload.mediaSummary
      ? "- 저장된 자료 구성: " + payload.mediaSummary
      : "- 자료 구성 정보가 없습니다.",
    payload.formattedTextHtml
      ? "- 본문 TEXT에 인라인 이미지/서식이 포함되어 있습니다."
      : "- 본문 인라인 이미지 정보는 없습니다.",
    payload.pdfText
      ? "- PDF에서 추출된 Text가 포함되어 있습니다."
      : "- PDF 추출 TEXT는 아직 없습니다.",
    "",
    "## 4. 쉽게 설명하면",
    "이 자료는 어떤 사건이나 지식에 대해 설명하고 있습니다. 중요한 것은 자료 안의 주장과 그 주장을 뒷받침하는 근거가 서로 맞는지 확인하는 것입니다.",
    "",
    "## 5. 더 확인할 점",
    "- 날짜, 숫자, 기관명, 인명은 원문과 다시 비교해야 합니다.",
    "- 사진이나 PDF 자료는 실제 내용이 정확히 추출되었는지 확인해야 합니다.",
    "- 출처 URL이 있다면 원문과 저장된 요약이 같은지 확인해야 합니다.",
  ].join("\n");

  return {
    status,
    summary: hasEnoughText
      ? "저장된 자료를 바탕으로 보고서를 작성했지만, 일부 근거는 추가 확인이 필요합니다."
      : "저장된 TEXT가 부족하여 보고서와 근거 확인이 제한됩니다.",
    result,
  };
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as FactCheckRequest;
    const apiKey =
      request.headers.get("x-gemini-api-key") ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;
    const { inlineParts, mediaText } = await buildMediaEvidence(payload);

    if (!apiKey) {
      return NextResponse.json({
        ok: true,
        mode: "fallback",
        warning: "Gemini API 키가 없어 기본 보고서를 작성했습니다.",
        ...buildFallbackReport(payload),
      });
    }

    const bodyFromHtml = htmlToPlainHint(getString(payload.formattedTextHtml));

    const sourceText = [
      payload.text ? "[저장된 본문 TEXT]\n" + payload.text : "",
      bodyFromHtml && bodyFromHtml !== getString(payload.text)
        ? "[본문 TEXT(HTML 추출)]\n" + bodyFromHtml
        : "",
      payload.formattedTextHtml
        ? "[본문 TEXT HTML 포함 여부]\n인라인 이미지/서식 HTML이 포함되어 있습니다."
        : "",
      payload.pdfText ? "[PDF 추출 TEXT]\n" + payload.pdfText : "",
      payload.summary ? "[저장된 요약]\n" + payload.summary : "",
      payload.factCheckSummary
        ? "[기존 Fact Check 요약]\n" + payload.factCheckSummary
        : "",
      payload.extraNote ? "[추가 보강 메모]\n" + payload.extraNote : "",
      payload.sourceUrl ? "[출처 URL]\n" + payload.sourceUrl : "",
      payload.mediaSummary
        ? "[저장 자료 구성]\n" + payload.mediaSummary
        : "",
      mediaText ? "[사진/이미지/PDF 자료 정보]\n" + mediaText : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const prompt = `
너는 초등학생도 이해할 수 있게 쉬운 보고서를 작성하는 선생님이자 Fact Check 담당자다.

작업 목표:
저장함에 있는 본문 TEXT, 인라인 이미지, 사진/이미지/PDF 자료를 확인하고,
그 안의 TEXT 내용, 주장, 지식에 대해 구체적인 근거를 정리한 뒤,
초등학생도 이해할 수 있는 쉬운 보고서를 작성하라.

중요 원칙:
1. 저장된 본문 TEXT, URL, 본문 속 인라인 이미지, 첨부 사진/이미지, PDF 추출 TEXT를 모두 검토한다.
2. 첨부된 이미지나 PDF를 읽을 수 있으면 그 내용도 근거로 사용한다.
3. 실제로 확인하지 못한 내용은 지어내지 말고 "추가 확인 필요"라고 쓴다.
4. 출처 URL이 있으면 "원문 대조 필요" 또는 "출처 확인 필요"로 표시한다.
5. 사진을 직접 판독하기 어려우면 "사진 내용 직접 확인 필요"라고 쓴다.
6. 보고서 수준은 초등학생도 이해할 수 있을 만큼 쉽게 작성한다.
7. 결과는 반드시 JSON만 출력한다.

JSON 형식:
{
  "status": "확인 완료 또는 확인 필요 또는 오류 가능성",
  "summary": "저장함 카드에 표시할 1~2문장 요약",
  "result": "초등학생도 이해할 수 있는 쉬운 보고서 전체 내용"
}

보고서 result 형식:
# 쉬운 보고서 제목
## 1. 이 자료의 주제
## 2. 자료가 말하는 핵심 내용
## 3. 자료 속 주장
## 4. 구체적인 근거
## 5. 초등학생도 이해할 수 있는 쉬운 설명
## 6. 확인된 내용
## 7. 더 확인이 필요한 내용
## 8. 정리

검토 자료:
제목: ${payload.title || "제목 없음"}
분류: ${payload.categoryPath || "분류 미정"}
키워드: ${Array.isArray(payload.keywords) ? payload.keywords.join(", ") : "없음"}
자료 구성: ${payload.mediaSummary || "자료 구성 정보 없음"}
첨부 이미지 수: ${inlineParts.length}

${sourceText || "저장된 본문 자료가 부족합니다."}
`;

    const parts: Array<{ text: string } | InlineMediaPart> = [
      { text: prompt },
      ...inlineParts,
    ];

    const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
    let data: Record<string, unknown> | null = null;
    let lastError: unknown = null;

    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts,
                },
              ],
              generationConfig: {
                temperature: 0.25,
                maxOutputTokens: 4096,
              },
            }),
          },
        );

        data = (await response.json()) as Record<string, unknown>;

        if (response.ok) break;

        lastError = data;
        data = null;
      } catch (error) {
        lastError = error;
        data = null;
      }
    }

    if (!data) {
      console.error("general-info-factcheck gemini failed", lastError);
      return NextResponse.json({
        ok: true,
        mode: "fallback",
        warning: "Gemini 검증 실패로 기본 보고서를 작성했습니다.",
        ...buildFallbackReport(payload),
      });
    }

    const rawText =
      (data as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      })?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("\n")
        .trim() || "";

    const cleaned = rawText
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();

    let parsed: { status?: string; summary?: string; result?: string } | null =
      null;

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return NextResponse.json({
        ok: true,
        mode: "gemini-text",
        status: "확인 필요",
        summary:
          "Gemini가 보고서를 작성했지만 구조화된 결과로 변환하지 못했습니다.",
        result: rawText || buildFallbackReport(payload).result,
      });
    }

    const safeStatus =
      parsed.status === "확인 완료" ||
      parsed.status === "확인 필요" ||
      parsed.status === "오류 가능성"
        ? parsed.status
        : "확인 필요";

    return NextResponse.json({
      ok: true,
      mode: "gemini",
      status: safeStatus,
      summary: parsed.summary || "정밀 Fact Check 보고서가 작성되었습니다.",
      result: parsed.result || rawText,
    });
  } catch (error) {
    console.error("general-info-factcheck route error", error);
    return NextResponse.json(
      {
        ok: false,
        error: "정밀 Fact Check 보고서 작성 중 오류가 발생했습니다.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
