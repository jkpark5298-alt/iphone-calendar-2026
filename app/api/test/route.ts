import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const keyToUse = serviceRoleKey || supabaseAnonKey;

    if (!supabaseUrl || !keyToUse) {
      return NextResponse.json({ error: "Missing env variables" });
    }

    const supabase = createClient(supabaseUrl, keyToUse);

    // 1. Test SELECT
    const { data: selectData, error: selectError } = await supabase
      .from("general_info_items")
      .select("*")
      .limit(5);

    // 2. Test INSERT (Write check)
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

    // 3. Test DELETE (Cleanup)
    let deleteError = null;
    if (!insertError) {
      const { error } = await supabase
        .from("general_info_items")
        .delete()
        .eq("id", testId);
      deleteError = error;
    }

    return NextResponse.json({
      env: {
        hasUrl: !!supabaseUrl,
        hasAnonKey: !!supabaseAnonKey,
        hasServiceKey: !!serviceRoleKey,
        keyUsed: serviceRoleKey ? "service_role" : "anon",
      },
      readTest: {
        ok: !selectError,
        error: selectError ? {
          message: selectError.message,
          code: selectError.code,
          details: selectError.details,
          hint: selectError.hint,
        } : null,
        dataLength: selectData ? selectData.length : 0,
      },
      writeTest: {
        ok: !insertError,
        error: insertError ? {
          message: insertError.message,
          code: insertError.code,
          details: insertError.details,
          hint: insertError.hint,
        } : null,
        insertedData: insertData,
        cleanupError: deleteError ? {
          message: deleteError.message,
        } : null
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message });
  }
}
