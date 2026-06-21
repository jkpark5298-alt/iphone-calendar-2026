import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Gemini API key is missing. Please set GEMINI_API_KEY in .env.local or enter it in the settings." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { action, text, imageBase64, mimeType } = body;

    let contents: any[] = [];

    if (action === "ocr") {
      if (!imageBase64) {
        return NextResponse.json({ error: "Image data is required for OCR" }, { status: 400 });
      }
      contents = [
        {
          role: "user",
          parts: [
            { text: "Extract all visible text from this image. Output only the extracted text, exactly as it appears. Do not add any introductory or explanatory text. If there is no text in the image, reply with nothing." },
            {
              inlineData: {
                mimeType: mimeType || "image/jpeg",
                data: imageBase64,
              },
            },
          ],
        },
      ];
    } else if (action === "classify") {
      if (!text) {
        return NextResponse.json({ error: "Text is required for classification" }, { status: 400 });
      }
      const prompt = `
You are an AI text classifier and summarizer. Analyze the following text and:
1. Classify it into exactly one of these categories: 정치, 행정, 경제, 산업, 사회, 교육, 문화, 예술, 과학, 기술, 국제, 외교, 국방, 안보, 기타.
2. Extract a single representative keyword (1-3 words) for the content.
3. Generate a concise and clear title (제목) (in Korean, 10 words or less) representing the core content.

Text:
"${text}"

Output strictly in JSON format. Do not write markdown blocks or any other formatting, just the raw JSON:
{
  "category": "one of the categories listed above",
  "keyword": "extracted keyword",
  "title": "generated title"
}
`;
      contents = [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ];
    } else if (action === "fact-check") {
      if (!text && !imageBase64) {
        return NextResponse.json({ error: "Text or image is required for fact-checking" }, { status: 400 });
      }
      const prompt = `
You are an expert fact-checker. Please fact-check the following content. If an image is provided, examine it carefully and consider its visual context in relation to the text.
Provide a clear, detailed, and structured fact-check report in Korean.

Structure:
1. 판정 결과 (Verdict): 참 (True) / 대체로 참 (Mostly True) / 절반의 참 (Half True) / 대체로 거짓 (Mostly False) / 거짓 (False) / 판단 보류 (Unverified) 중 하나 선택 및 이유 요약.
2. 근거 설명 (Reasoning/Evidence): 구체적인 근거와 논리를 바탕으로 상세히 설명.
3. 추가 참고 사항 (Additional Context): 유의해야 할 추가 맥락 정보 제공.

Content to fact-check:
"${text || "[Image content]"}"

Output the report formatted in beautiful, readable Markdown.
`;
      const parts: any[] = [{ text: prompt }];
      if (imageBase64) {
        parts.push({
          inlineData: {
            mimeType: mimeType || "image/jpeg",
            data: imageBase64,
          },
        });
      }

      contents = [
        {
          role: "user",
          parts,
        },
      ];
    } else if (action === "photobook-classify") {
      if (!text && !imageBase64) {
        return NextResponse.json({ error: "Text or image is required for classification" }, { status: 400 });
      }
      const prompt = `
You are an AI photo classifier. Analyze the following photo (if provided) and/or description text:
1. Extract a single representative keyword (1-2 words in Korean or English) e.g., "가족", "She", "바다".
2. Assign a suitable 2nd classification category ("2차분류" in Korean, 1-2 words) e.g., "여행", "일상", "음식", "기억", "풍경", "인물", "취미", "기타".

Text context: "${text || ""}"

Output strictly in JSON format. Do not write markdown blocks or any other formatting, just the raw JSON:
{
  "keyword": "extracted_keyword",
  "category2": "assigned_category2"
}
`;
      const parts: any[] = [{ text: prompt }];
      if (imageBase64) {
        parts.push({
          inlineData: {
            mimeType: mimeType || "image/jpeg",
            data: imageBase64,
          },
        });
      }

      contents = [
        {
          role: "user",
          parts,
        },
      ];
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contents }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: `Gemini API error: ${errText}` }, { status: response.status });
    }

    const resData = await response.json();
    let resultText = resData.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Clean up JSON block characters if Gemini returns them
    if (action === "classify" || action === "photobook-classify") {
      resultText = resultText.replace(/```json/g, "").replace(/```/g, "").trim();
    }

    return NextResponse.json({ result: resultText });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
