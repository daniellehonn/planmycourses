// Fill these in from your Supabase project (Project Settings -> API).
// The anon/public key is safe to expose client-side by design — access to
// data is controlled by the Row Level Security policies in supabase-schema.sql,
// not by keeping this key secret.
//
// Until these are set, the app runs fully without accounts (local browser
// only) — account features just show a "not configured" message.
const SUPABASE_URL = 'https://obxjreeozprrybvneupu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ieGpyZWVvenBycnlidm5ldXB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNzgzOTgsImV4cCI6MjEwMDc1NDM5OH0.9FDRT7d2NxV7wxpNoOk0rlXrSmpH3mpH--Ac_w5lHcI';

const supabaseClient = (SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.startsWith('ey'))
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
