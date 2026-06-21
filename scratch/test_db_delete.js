const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://ykumumrvcapnehafexdl.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrdW11bXJ2Y2FwbmVoYWZleGRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NzYzMzMsImV4cCI6MjA5NTI1MjMzM30.PDPmVFQCLQPmoh0UX-fEwl_OT0zN1hJeiVV6iURwgjI";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  console.log("Fetching items...");
  const { data, error } = await supabase
    .from("general_info_items")
    .select("id, title, confirmed")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Fetch error:", error);
    return;
  }

  console.log("Current items in DB:");
  data.forEach(item => {
    console.log(`- ID: ${item.id}, Title: "${item.title}", Confirmed: ${item.confirmed}`);
  });

  if (data.length === 0) {
    console.log("No items to test delete.");
    return;
  }

  // Find the first "클립보드 이미지 자료" item to test deleting
  const target = data.find(item => item.title.includes("클립보드 이미지 자료")) || data[0];
  console.log(`\nTrying to DELETE item: ID=${target.id}, Title="${target.title}"...`);
  
  const { error: deleteError } = await supabase
    .from("general_info_items")
    .delete()
    .eq("id", target.id);

  if (deleteError) {
    console.error("Delete failed! Error details:", deleteError);
  } else {
    console.log("Delete succeeded!");
  }
}

test();
