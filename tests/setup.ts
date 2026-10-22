// Minimal env so modules that read configuration can load under test.
process.env.APP_URL ??= "http://localhost:3000";
process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key-0000000000";
process.env.SUPABASE_SECRET_KEY ??= "test-secret-key-000000000000000000";
process.env.CRON_SECRET ??= "test-cron-secret-0000000000000000000000";
process.env.LOG_LEVEL ??= "silent";
