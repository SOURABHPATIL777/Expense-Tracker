-- Re-read every completed import once with the current reader: payee names from "Paid to …",
-- NEFT/RTGS/IMPS and UPI narrations, then categories redone for what the user didn't set.
-- (A separate migration: a new enum value can't be used in the transaction that adds it.)
insert into public.jobs (user_id, type, payload, idempotency_key)
select i.user_id, 'reread_import', jsonb_build_object('importId', i.id, 'fromFile', false), 'reread:names:' || i.id
from public.imports i
where i.status = 'completed'
on conflict (idempotency_key) do nothing;
