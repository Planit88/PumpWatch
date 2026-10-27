// PumpWatch settings.
// Leave these empty to run in demo mode (prices are saved only in your own browser).
// To share prices with everyone, create a free Supabase project, run supabase/schema.sql,
// then paste your Project URL and "anon public" key below. The anon key is safe to publish:
// the database rules in schema.sql only allow reading prices and adding new reports.
window.PUMPWATCH_CONFIG = {
  supabaseUrl: "",      // e.g. "https://abcdefghijkl.supabase.co"
  supabaseAnonKey: "",  // the long "anon public" key from Project Settings → API

  // Prices older than this many days are flagged as possibly out of date.
  staleAfterDays: 3
};
