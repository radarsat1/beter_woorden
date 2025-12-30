import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts"

const WORKER_URL = Deno.env.get('USER_HEALTH_WORKER_URL');

// --- Interfaces ---
interface Health {
  status: string;
}

// --- Supabase Helpers ---
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseGlobal = createClient(supabaseUrl, supabaseKey);

function supabaseClient(user_token: string) {
  return createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${user_token}` } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}


// --- HTTP Handler ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");
    const token = authHeader.replace("Bearer ", "");
    const supabase = supabaseClient(token);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (!user) throw new Error("Unauthorized: " + authError);

    const body = await req.json();

    const workerResp = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
                 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({user_id: user.id})
    });

    if (!workerResp.ok) throw new Error(`Worker returned ${workerResp.status}`);

    return new Response(JSON.stringify({ response: await workerResp.json() }),
                        { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
