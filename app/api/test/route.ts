import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Read headers for request-level custom key
    const urlObj = new URL(request.url);
    const customHeaderKey = request.headers.get("x-gemini-api-key") || urlObj.searchParams.get("key");
    const geminiApiKey = customHeaderKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    const keyToUse = serviceRoleKey || supabaseAnonKey;

    if (!supabaseUrl || !keyToUse) {
      return NextResponse.json({ error: "Missing env variables" });
    }

    const supabase = createClient(supabaseUrl, keyToUse);

    // 1. Test Supabase SELECT
    const { data: selectData, error: selectError } = await supabase
      .from("general_info_items")
      .select("*")
      .limit(5);

    // 2. Test Supabase INSERT (Write check)
    const testId = 999999999;
    const testRow = {
      id: testId,
      title: "Supabase Write Test",
      text: "Testing INSERT permissions",
      primary_category: "테스트",
      secondary_category: "테스트",
      third_category: "테스트",
      keywords: ["test"],
      input_types: ["test"],
      summary: "test",
      fact_check_status: "확인 전",
      fact_check_summary: "test",
      confirmed: false,
      created_at_text: new Date().toLocaleString("ko-KR")
    };

    const { data: insertData, error: insertError } = await supabase
      .from("general_info_items")
      .insert(testRow)
      .select();

    // 3. Test API DELETE route (Cleanup & Auth check)
    let apiDeleteResult: any = null;
    if (!insertError) {
      try {
        const { DELETE as generalInfoDelete } = require("../general-info/route");
        const mockReq = new NextRequest("http://localhost:3000/api/general-info", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "origin": "http://localhost:3000",
            "referer": "http://localhost:3000/",
            "host": "localhost:3000"
          },
          body: JSON.stringify({ id: testId })
        });
        const apiRes = await generalInfoDelete(mockReq);
        apiDeleteResult = {
          status: apiRes.status,
          data: await apiRes.json()
        };
      } catch (e: any) {
        apiDeleteResult = { error: e.message || String(e) };
      }
    }

    // 4. Test Google Gemini API Key validity
    let geminiTestResult = {
      ok: false,
      message: "Gemini API 키가 설정되지 않았습니다.",
      status: 0,
      details: ""
    };

    if (geminiApiKey) {
      try {
        const model = "gemini-2.5-flash";
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: "Hello! Reply with 'Gemini API is working successfully!'" }]
              }
            ]
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const responseText = await response.text();
        let responseJson: any = null;
        try {
          responseJson = JSON.parse(responseText);
        } catch(e) {}

        if (response.ok) {
          const generatedText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          geminiTestResult = {
            ok: true,
            message: generatedText ? generatedText.trim() : "성공했지만 응답 본문이 비어있습니다.",
            status: response.status,
            details: "API Key is valid and authorized."
          };
        } else {
          geminiTestResult = {
            ok: false,
            message: "Google Gemini API가 오류를 반환했습니다.",
            status: response.status,
            details: responseJson?.error?.message || responseText || "Unknown API error"
          };
        }
      } catch (err: any) {
        geminiTestResult = {
          ok: false,
          message: "Gemini API 연결 실패 (네트워크/방화벽 또는 타임아웃)",
          status: 500,
          details: err.message || String(err)
        };
      }
    }

    return NextResponse.json({
      env: {
        hasUrl: !!supabaseUrl,
        hasAnonKey: !!supabaseAnonKey,
        hasServiceKey: !!serviceRoleKey,
        keyUsed: serviceRoleKey ? "service_role" : "anon",
        hasGeminiEnvKey: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
        geminiEnvKeySnippet: (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").slice(0, 6) + "..."
      },
      supabaseReadTest: {
        ok: !selectError,
        error: selectError ? {
          message: selectError.message,
          code: selectError.code,
          details: selectError.details,
          hint: selectError.hint,
        } : null,
        dataLength: selectData ? selectData.length : 0,
      },
      supabaseWriteTest: {
        ok: !insertError,
        error: insertError ? {
          message: insertError.message,
          code: insertError.code,
          details: insertError.details,
          hint: insertError.hint,
        } : null,
        insertedData: insertData,
        apiDeleteResult: apiDeleteResult
      },
      geminiApiTest: geminiTestResult
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message });
  }
}
