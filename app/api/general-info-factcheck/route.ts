import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  assertAppApiAccess,
  assertRateLimit,
  assertSafePublicHttpUrl,
  clientIpFromRequest,
  getServerGeminiApiKey,
} from "../../../lib/apiSecurity";
import { normalizeReportPlainText } from "../../../lib/generalInfoHelpers";

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

const isGeminiCreditDepletedPayload = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  return (
    /RESOURCE_EXHAUSTED/i.test(text) ||
    /prepayment credits/i.test(text) ||
    /credits? are depleted/i.test(text) ||
    /"code"\s*:\s*429/i.test(text) ||
    /\b429\b/.test(text) ||
    /quota.*?exceed/i.test(text)
  );
};

const creditDepletedResponse = () =>
  NextResponse.json({
    ok: true,
    mode: "credit_depleted",
    needsManualFactCheck: true,
    status: "확인 필요",
    summary: "AI 크레딧이 소진되었습니다. 수동으로 Fact Check를 작성해 주세요.",
    result: "",
  });

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
    const safeUrl = await assertSafePublicHttpUrl(url);
    const response = await fetch(safeUrl, {
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
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

export async function POST(request: NextRequest) {
  const authError = assertAppApiAccess(request);
  if (authError) return authError;

  const rateError = assertRateLimit(
    `factcheck:${clientIpFromRequest(request)}`,
    20,
    60_000,
  );
  if (rateError) return rateError;

  let payload: FactCheckRequest = {};

  try {
    try {
      payload = (await request.json()) as FactCheckRequest;
    } catch (parseError) {
      console.error("general-info-factcheck invalid json body", parseError);
      return NextResponse.json({
        ok: true,
        mode: "fallback",
        warning: "요청 본문 파싱에 실패해 기본 보고서를 작성했습니다.",
        ...buildFallbackReport({}),
      });
    }

    const apiKey = getServerGeminiApiKey(request);
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
너는 저장된 자료를 바탕으로 "근거 있는 검증 메모(AI 검증 보고서)"를 작성하는 Fact Check 담당자다.
목표는 외부 인터넷으로 진실을 단정하는 것이 아니라, 저장함의 TEXT·이미지·URL만으로 주장과 근거를 정리하는 것이다.

작업 목표:
1. 본문 TEXT, 인라인 이미지, 첨부 이미지/PDF, 출처 URL, 요약/메모를 검토한다.
2. 주장 / 근거 / 미확인을 반드시 분리해 적는다. (쉬운 요약 문장만 나열하지 말 것)
3. 근거를 적을 때는 반드시 출처를 표시한다.
4. 초등학생도 이해할 수 있게 쉽게 쓰되, 확인하지 못한 내용은 지어내지 않는다.

검증 기준 (반드시 준수):
1. 원문 충실도: 자료에 있는 내용만 사용. 없는 숫자·인명·날짜를 만들지 말 것.
2. 주장 vs 근거 분리: (1) 자료가 말하는 것 (2) 뒷받침 근거 (3) 아직 확인 안 된 것.
3. 검증 가능 항목만 확인: 날짜·수치·기관명·인명·인용은 원문/이미지와 대조.
4. 이미지 역할 명시: 사진이 무엇을 보여주는지 1~2문장. 없거나 못 읽으면 "이미지 없음/직접 확인 필요".
5. 상태값 규칙 (보수적으로):
   - "확인 완료": 본문·이미지·URL 등 복수 근거가 서로 모순 없이 핵심을 뒷받침할 때만.
   - "확인 필요": 근거가 본문 TEXT뿐인 경우, URL 미대조, 이미지 미판독, 수치·날짜 추가 확인이 필요한 경우. (기본값으로 우선 고려)
   - "오류 가능성": 본문 모순, 과장, 출처 불명.
6. 출처 신뢰도는 보수적으로: URL/매체명을 "신뢰한다"고 단정하지 말고 "출처 표시됨 / 추가 확인 권장"으로 적을 것.
7. 실시간 뉴스·위키 검색으로 진실을 판정한 것처럼 쓰지 말 것.
8. "## 8. 더 확인이 필요한 내용"에는 최소 1개 이상 미확인/추가확인 항목을 적을 것. (없으면 "현재 저장 자료 범위에서는 추가 확인 항목 없음"이라고 명시)

근거 출처 표시 규칙 (매우 중요):
- 본문 TEXT 근거: (출처: 본문 TEXT)
- 인라인/첨부 이미지 근거: (출처: 이미지 1) 또는 (출처: 첨부 이미지)
- URL 근거: (출처: URL) + 가능하면 URL 일부 표기
- 요약/메모 근거: (출처: 요약) / (출처: 추가 메모)
- 한 문장에 근거가 있으면 문장 끝에 출처를 붙인다.

출력 형식 규칙 (매우 중요):
1. 결과는 반드시 JSON 객체만 출력한다. 마크다운 코드펜스(\`\`\`)나 설명문을 붙이지 않는다.
2. result 값은 보고서 본문 문자열이다. JSON 전체를 result에 넣지 않는다.
3. 섹션 제목은 반드시 같은 줄에 쓴다. 예: "## 1. 이 자료의 주제"
   - 금지 예: "##" 다음 줄에 "1. 이 자료의 주제"
4. 각 섹션(## 1. ~ ## 9.) 사이에는 빈 줄을 넣는다.
5. 불릿은 "* " 형식으로 한 줄에 하나씩 쓴다.

JSON 형식:
{
  "status": "확인 완료 또는 확인 필요 또는 오류 가능성",
  "summary": "저장함 카드에 표시할 1~2문장 요약",
  "result": "AI 검증 보고서 전체 본문"
}

보고서 result 형식 예시:
# AI 검증 보고서
## 1. 이 자료의 주제
(내용)
## 2. 자료가 말하는 핵심 내용
(내용)
## 3. 자료 속 주장
* 주장1 (출처: 본문 TEXT)
## 4. 구체적인 근거 (각 근거 끝에 출처 표시)
* 근거1 (출처: 본문 TEXT)
## 5. 이미지에서 확인한 내용 (출처: 이미지 n)
(내용)
## 6. 초등학생도 이해할 수 있는 쉬운 설명
(내용)
## 7. 확인된 내용
* 확인1 (출처: 본문 TEXT)
## 8. 더 확인이 필요한 내용
* 추가 확인1
## 9. 정리
(내용)

검토 자료:
제목: ${payload.title || "제목 없음"}
분류: ${payload.categoryPath || "분류 미정"}
키워드: ${Array.isArray(payload.keywords) ? payload.keywords.join(", ") : "없음"}
자료 구성: ${payload.mediaSummary || "자료 구성 정보 없음"}
첨부 이미지 수: ${inlineParts.length}
출처 URL 존재: ${payload.sourceUrl ? "예" : "아니오"}

${sourceText || "저장된 본문 자료가 부족합니다."}
`;

    const parts: Array<{ text: string } | InlineMediaPart> = [
      { text: prompt },
      ...inlineParts,
    ];

    const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
    let data: Record<string, unknown> | null = null;
    let lastError: unknown = null;
    let usedModel = models[0];

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
                temperature: 0.2,
                maxOutputTokens: 4096,
                responseMimeType: "application/json",
              },
            }),
          },
        );

        data = (await response.json()) as Record<string, unknown>;

        if (response.ok) {
          usedModel = model;
          break;
        }

        if (isGeminiCreditDepletedPayload(data) || response.status === 429) {
          return creditDepletedResponse();
        }

        lastError = data;
        data = null;
      } catch (error) {
        if (isGeminiCreditDepletedPayload(error)) {
          return creditDepletedResponse();
        }
        lastError = error;
        data = null;
      }
    }

    if (!data) {
      console.error("general-info-factcheck gemini failed", lastError);
      if (isGeminiCreditDepletedPayload(lastError)) {
        return creditDepletedResponse();
      }
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

    const extractResultText = (value: unknown): string => {
      if (typeof value !== "string") return "";
      let text = value.trim();
      if (!text) return "";

      // 실수로 JSON 전체가 result로 들어온 경우 result 필드만 추출
      if (/^\s*\{/.test(text) && /"result"\s*:/.test(text)) {
        try {
          const asJson = JSON.parse(
            text.replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim(),
          ) as { result?: unknown };
          if (typeof asJson.result === "string" && asJson.result.trim()) {
            text = asJson.result.trim();
          }
        } catch {
          const match = text.match(/"result"\s*:\s*"((?:\\.|[^"\\])*)"/);
          if (match?.[1]) {
            try {
              text = JSON.parse(`"${match[1]}"`);
            } catch {
              text = match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
            }
          }
        }
      }

      return normalizeReportPlainText(text);
    };

    const wrapAiVerificationReport = (resultText: string, model: string) => {
      const label = `AI 검증 보고서(${model})`;
      const body = extractResultText(resultText);
      if (!body) return `# ${label}`;
      if (/AI 검증 보고서\([^)]+\)/i.test(body)) {
        return normalizeReportPlainText(
          body.replace(/AI 검증 보고서\([^)]+\)/i, label),
        );
      }
      if (body.startsWith("# ")) {
        const withoutFirstTitle = body.replace(/^#\s+[^\n]*\n?/, "").trim();
        return normalizeReportPlainText(`# ${label}\n\n${withoutFirstTitle}`);
      }
      return normalizeReportPlainText(`# ${label}\n\n${body}`);
    };

    if (!parsed) {
      return NextResponse.json({
        ok: true,
        mode: "gemini-text",
        model: usedModel,
        status: "확인 필요",
        summary:
          "Gemini가 보고서를 작성했지만 구조화된 결과로 변환하지 못했습니다.",
        result: wrapAiVerificationReport(
          rawText || buildFallbackReport(payload).result,
          usedModel,
        ),
      });
    }

    let safeStatus =
      parsed.status === "확인 완료" ||
      parsed.status === "확인 필요" ||
      parsed.status === "오류 가능성"
        ? parsed.status
        : "확인 필요";

    // 본문만 있고 URL/이미지가 없으면 확인 완료를 확인 필요로 완화
    const hasUrl = Boolean(getString(payload.sourceUrl));
    const hasImage = inlineParts.length > 0;
    if (safeStatus === "확인 완료" && !hasUrl && !hasImage) {
      safeStatus = "확인 필요";
    }

    return NextResponse.json({
      ok: true,
      mode: "gemini",
      model: usedModel,
      status: safeStatus,
      summary: parsed.summary || "정밀 Fact Check 보고서가 작성되었습니다.",
      result: wrapAiVerificationReport(parsed.result || rawText, usedModel),
    });
  } catch (error) {
    console.error("general-info-factcheck route error", error);
    if (isGeminiCreditDepletedPayload(error)) {
      return creditDepletedResponse();
    }
    // 500 대신 폴백 보고서를 반환해 UI에 보고서가 항상 보이게 함
    return NextResponse.json({
      ok: true,
      mode: "fallback",
      warning: "보고서 작성 중 오류가 발생해 기본 보고서를 작성했습니다.",
      ...buildFallbackReport(payload),
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
