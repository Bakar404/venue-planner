// Supabase connection settings.
//
// Fill these in from your Supabase project: Project Settings -> API.
//   url     = "Project URL"
//   anonKey = "anon public" key
//
// The anon/public key is meant to live in frontend code. Your data is protected
// by Row Level Security (see schema.sql), so each account can only read and write
// its own layouts. NEVER put the service_role (secret) key here.
//
// Leave the placeholders as-is to run the app in local-only mode (no login,
// layouts saved in the browser).
window.SUPABASE_CONFIG = {
  url: "https://foulqtsldvkqzotgkrfd.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvdWxxdHNsZHZrcXpvdGdrcmZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMTM5MTUsImV4cCI6MjA5NjU4OTkxNX0.xxvPlFCQNnzE8k-9sgpBmqeOZAGaPndttj3oiPd_Z-8",
};
