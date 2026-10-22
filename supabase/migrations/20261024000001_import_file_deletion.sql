-- "Delete file only": the statement file is removed from storage but the import, its rows and its
-- transactions are kept (transaction_sources and raw_events cascade from imports, so the import row
-- has to stay). This records when that happened.
alter table public.imports add column file_deleted_at timestamptz;
