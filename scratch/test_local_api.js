async function test() {
  // Let's find an active ID from the DB first
  const supabaseUrl = "https://ykumumrvcapnehafexdl.supabase.co";
  const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrdW11bXJ2Y2FwbmVoYWZleGRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NzYzMzMsImV4cCI6MjA5NTI1MjMzM30.PDPmVFQCLQPmoh0UX-fEwl_OT0zN1hJeiVV6iURwgjI";
  
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  const { data } = await supabase.from("general_info_items").select("id, title").limit(1);
  if (!data || data.length === 0) {
    console.log("No items in DB to delete.");
    return;
  }
  
  const targetId = data[0].id;
  const targetTitle = data[0].title;
  console.log(`Target item to delete: ID=${targetId}, Title="${targetTitle}"`);
  
  console.log(`Sending DELETE request to http://localhost:3000/api/general-info...`);
  try {
    const res = await fetch("http://localhost:3000/api/general-info", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Referer": "http://localhost:3000/",
        "Host": "localhost:3000"
      },
      body: JSON.stringify({ id: targetId })
    });
    console.log("Response status:", res.status);
    const text = await res.text();
    console.log("Response text:", text);
  } catch (err) {
    console.error("Fetch failed (make sure your npm run dev local server is running):", err.message);
  }
}
test();
