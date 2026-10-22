// Minimal env so modules that read configuration can load under test.
process.env.APP_URL ??= "http://localhost:3000";
process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key-0000000000";
process.env.SUPABASE_SECRET_KEY ??= "test-secret-key-000000000000000000";
process.env.CRON_SECRET ??= "test-cron-secret-0000000000000000000000";
process.env.LOG_LEVEL ??= "silent";
process.env.R2_ACCOUNT_ID ??= "0123456789abcdef0123456789abcdef";
process.env.R2_ACCESS_KEY_ID ??= "test-r2-access-key";
process.env.R2_SECRET_ACCESS_KEY ??= "test-r2-secret-access-key-000000000000";
