/*
  Optional cloud sync.

  Venue Planner works without this: venues are saved in the browser's local storage.
  To let people sign in and sync venues across devices, create a free Supabase project,
  run schema.sql in its SQL editor, then paste the project URL and the public "anon" key
  below. The anon key is designed to be public; row level security in schema.sql keeps
  each user's data private. Never put the service role key here.

  Leave both values empty to keep the app fully local. It then makes no network requests.
*/
window.SUPABASE_CONFIG = {
  url: '',
  anonKey: '',
};
