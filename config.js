// PumpWatch settings.
// Leave these empty to run in demo mode (prices are saved only in your own browser).
// To share prices with everyone, create a free Supabase project, run supabase/schema.sql,
// then paste your Project URL and "anon public" key below. The anon key is safe to publish:
// the database rules in schema.sql only allow reading prices and adding new reports.
window.PUMPWATCH_CONFIG = {
  supabaseUrl: "https://pftgcsofwxvvgtrqmdok.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmdGdjc29md3h2dmd0cnFtZG9rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwOTc0MDUsImV4cCI6MjEwODY3MzQwNX0.sncbmNsa1iw3PpR6qBr003B3m0PDMDheRMcdOGoS_Zw",

  // Prices older than this many days are flagged as possibly out of date.
  staleAfterDays: 3
};
