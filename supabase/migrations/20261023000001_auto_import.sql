-- Automatic import and keyword-based categorisation:
--  * import_layouts: CSV/Excel and PDF layouts shared by all users (seeded from the former code
--    presets; the LLM adds new ones). Server-only.
--  * imports: source is detected after upload, so source_kind/source_app become nullable.
--  * category_map: keyword → category. Shared rows (user_id null) come from seed data and the LLM;
--    a user's manual corrections are their own rows and win over shared ones.
--  * Per-user AI configuration (llm_configs) and per-user templates are removed: AI is Ollama-only,
--    configured in code.

alter type public.llm_task add value if not exists 'column_mapping';
alter type public.llm_task add value if not exists 'pdf_extraction';

-- ---------------------------------------------------------------------------
-- Import layouts (global)
-- ---------------------------------------------------------------------------
create table public.import_layouts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('table', 'text', 'llm_extract')),
  -- table: normalised header row; text: preset id or header-line fingerprint.
  signature text not null check (char_length(signature) between 1 and 2000),
  label text not null check (char_length(label) between 1 and 160),
  source_kind public.source_kind not null,
  source_app text not null,
  config jsonb not null default '{}',
  origin text not null default 'seed' check (origin in ('seed', 'llm')),
  priority integer not null default 1000,
  verified boolean not null default false,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, signature)
);
alter table public.import_layouts enable row level security;
revoke all on public.import_layouts from anon, authenticated;

insert into public.import_layouts (kind, signature, label, source_kind, source_app, priority, config)
values
  ('text', 'upi.phonepe.pdf.v1', 'PhonePe statement (PDF)', 'upi_app', 'phonepe', 100, '{"id":"upi.phonepe.pdf.v1","label":"PhonePe statement (PDF)","sourceKind":"upi_app","sourceApp":"phonepe","reader":"pdf_text","verified":false,"text":{"detect":["phonepe","transaction id"],"recordStart":"^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{1,2},? \\d{4}\\b","ignoreLines":["^Page \\d+ of \\d+","^Date\\s+Transaction Details","system generated","^Transaction Statement","^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{1,2},? \\d{4}\\s*-\\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"],"fields":{"date":"^(?<date>(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{1,2},? \\d{4})","time":"(?<time>\\d{1,2}:\\d{2}\\s?[ap]m)","amount":"(?:₹|INR|Rs\\.?)\\s?(?<amount>[\\d,]+(?:\\.\\d{1,2})?)","debitWhen":"\\bDEBIT\\b","creditWhen":"\\bCREDIT\\b","narration":"^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{1,2},? \\d{4}\\s+(?<narration>.+?)\\s+(?:DEBIT|CREDIT)\\b","counterparty":"(?:Paid to|Received from|Payment to|Transfer to|Refund from|Sent to|Bill paid -|Mobile recharged)\\s+(?<counterparty>.+?)\\s+(?:DEBIT|CREDIT)\\b","appTransactionId":"Transaction ID\\s*:?\\s*(?<appTransactionId>[A-Z0-9]{8,})","reference":"UTR No\\.?\\s*:?\\s*(?<reference>\\d{10,})"},"status":[{"when":"\\bFailed\\b","status":"failed"},{"when":"\\bPending\\b","status":"pending"}],"dateFormats":["MMM dd, yyyy","MMM d, yyyy","MMM dd yyyy","MMM d yyyy"]}}'::jsonb),
  ('text', 'upi.gpay.pdf.v1', 'Google Pay statement (PDF)', 'upi_app', 'gpay', 101, '{"id":"upi.gpay.pdf.v1","label":"Google Pay statement (PDF)","sourceKind":"upi_app","sourceApp":"gpay","reader":"pdf_text","verified":false,"text":{"detect":["google pay","upi transaction id"],"recordStart":"^\\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,? \\d{4}\\b","ignoreLines":["^Page \\d+","^Date\\s*(?:&|and)?\\s*time","^Transaction statement"],"fields":{"date":"^(?<date>\\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,? \\d{4})","time":"(?<time>\\d{1,2}:\\d{2}\\s?[AaPp][Mm])","amount":"(?:₹|INR|Rs\\.?)\\s?(?<amount>[\\d,]+(?:\\.\\d{1,2})?)","debitWhen":"\\b(?:Paid to|Sent to)\\b","creditWhen":"\\b(?:Received from|Refund from)\\b","narration":"^\\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*,? \\d{4}\\s+(?<narration>.+?)\\s+(?:₹|INR|Rs)","counterparty":"(?:Paid to|Sent to|Received from|Refund from)\\s+(?<counterparty>.+?)\\s+(?:₹|INR|Rs)","reference":"UPI Transaction ID:?\\s*(?<reference>\\d{10,})"},"status":[{"when":"\\b(?:Failed|Declined)\\b","status":"failed"},{"when":"\\bPending\\b","status":"pending"}],"dateFormats":["dd MMM, yyyy","d MMM, yyyy","dd MMM yyyy","d MMM yyyy","dd MMMM, yyyy","d MMMM, yyyy"]}}'::jsonb),
  ('table', 'upi.paytm.table.v1', 'Paytm UPI statement (CSV/Excel)', 'upi_app', 'paytm', 102, '{"id":"upi.paytm.table.v1","label":"Paytm UPI statement (CSV/Excel)","sourceKind":"upi_app","sourceApp":"paytm","reader":"table","verified":false,"table":{"headerMatch":["date","transaction details","your account","amount","upi ref no"],"columns":{"date":["date"],"time":["time"],"narration":["transaction details"],"counterparty":["transaction details"],"vpa":["other transaction details upi id or a c no","other transaction details"],"reference":["upi ref no"],"appTransactionId":["order id"],"note":["comment","remarks"]},"amount":{"mode":"signed","amount":["amount"]},"status":{"column":["status"],"map":{"success":"success","successful":"success","failed":"failed","pending":"pending"}},"dateFormats":["dd/MM/yyyy","d MMM yyyy","dd MMM yyyy","dd-MM-yyyy"]}}'::jsonb),
  ('text', 'upi.paytm.pdf.v1', 'Paytm UPI statement (PDF)', 'upi_app', 'paytm', 103, '{"id":"upi.paytm.pdf.v1","label":"Paytm UPI statement (PDF)","sourceKind":"upi_app","sourceApp":"paytm","reader":"pdf_text","verified":false,"text":{"detect":["paytm","upi ref"],"recordStart":"^\\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{4}\\b","ignoreLines":["^Page \\d+","^Date\\s*(?:&|and)?\\s*Time","^Passbook"],"fields":{"date":"^(?<date>\\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{4})","time":"(?<time>\\d{1,2}:\\d{2}\\s?[AaPp][Mm])","amount":"(?:₹|Rs\\.?|INR)\\s?[-+]?\\s?(?<amount>[\\d,]+(?:\\.\\d{1,2})?)","debitWhen":"\\b(?:Paid to|Sent to|Money sent to)\\b|-\\s?(?:₹|Rs)","creditWhen":"\\b(?:Received from|Refund from|Money received)\\b|\\+\\s?(?:₹|Rs)","narration":"^\\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{4}\\s+(?<narration>.+?)\\s+[-+]?\\s?(?:₹|Rs)","counterparty":"(?:Paid to|Sent to|Money sent to|Received from|Refund from)\\s+(?<counterparty>.+?)(?:\\s+[-+]?\\s?(?:₹|Rs)|$)","reference":"UPI Ref(?:erence)?\\s*(?:No\\.?|ID)?:?\\s*(?<reference>\\d{10,})","appTransactionId":"Order ID:?\\s*(?<appTransactionId>\\w{6,})"},"status":[{"when":"\\bFailed\\b","status":"failed"},{"when":"\\bPending\\b","status":"pending"}],"dateFormats":["dd MMM yyyy","d MMM yyyy"]}}'::jsonb),
  ('table', 'bank.hdfc.table.v1', 'HDFC Bank statement (CSV/Excel)', 'bank', 'hdfc', 104, '{"sourceKind":"bank","sourceApp":"hdfc","verified":false,"id":"bank.hdfc.table.v1","label":"HDFC Bank statement (CSV/Excel)","reader":"table","table":{"headerMatch":["date","narration","withdrawal amt","deposit amt"],"columns":{"date":["date"],"narration":["narration"],"reference":["chq ref no"],"balance":["closing balance"]},"amount":{"mode":"split","debit":["withdrawal amt"],"credit":["deposit amt"]},"dateFormats":["dd/MM/yy","dd/MM/yyyy","dd-MM-yyyy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.hdfc.pdf.v1', 'HDFC Bank statement (PDF)', 'bank', 'hdfc', 105, '{"sourceKind":"bank","sourceApp":"hdfc","verified":false,"id":"bank.hdfc.pdf.v1","label":"HDFC Bank statement (PDF)","reader":"pdf_text","text":{"detect":["\\bHDFC\\s+Bank\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd/MM/yy","dd/MM/yyyy","dd-MM-yyyy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.icici.table.v1', 'ICICI Bank statement (CSV/Excel)', 'bank', 'icici', 106, '{"sourceKind":"bank","sourceApp":"icici","verified":false,"id":"bank.icici.table.v1","label":"ICICI Bank statement (CSV/Excel)","reader":"table","table":{"headerMatch":["transaction date","transaction remarks","withdrawal amount","deposit amount"],"columns":{"date":["transaction date","value date"],"narration":["transaction remarks"],"reference":["cheque number"],"balance":["balance"]},"amount":{"mode":"split","debit":["withdrawal amount"],"credit":["deposit amount"]},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.icici.pdf.v1', 'ICICI Bank statement (PDF)', 'bank', 'icici', 107, '{"sourceKind":"bank","sourceApp":"icici","verified":false,"id":"bank.icici.pdf.v1","label":"ICICI Bank statement (PDF)","reader":"pdf_text","text":{"detect":["\\bICICI\\s+Bank\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.sbi.table.v1', 'State Bank of India statement (CSV/Excel)', 'bank', 'sbi', 108, '{"sourceKind":"bank","sourceApp":"sbi","verified":false,"id":"bank.sbi.table.v1","label":"State Bank of India statement (CSV/Excel)","reader":"table","table":{"headerMatch":["txn date","description","ref no","debit","credit"],"columns":{"date":["txn date","value date"],"narration":["description"],"reference":["ref no cheque no","ref no"],"balance":["balance"]},"amount":{"mode":"split","debit":["debit"],"credit":["credit"]},"dateFormats":["d MMM yyyy","dd MMM yyyy","dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","dd-MMM-yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.sbi.pdf.v1', 'State Bank of India statement (PDF)', 'bank', 'sbi', 109, '{"sourceKind":"bank","sourceApp":"sbi","verified":false,"id":"bank.sbi.pdf.v1","label":"State Bank of India statement (PDF)","reader":"pdf_text","text":{"detect":["\\bState\\s+Bank\\s+of\\s+India\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["d MMM yyyy","dd MMM yyyy","dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","dd-MMM-yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.pnb.table.v1', 'Punjab National Bank statement (CSV/Excel)', 'bank', 'pnb', 110, '{"sourceKind":"bank","sourceApp":"pnb","verified":false,"id":"bank.pnb.table.v1","label":"Punjab National Bank statement (CSV/Excel)","reader":"table","table":{"headerMatch":["transaction date","withdrawal","deposit","narration"],"columns":{"date":["transaction date"],"narration":["narration"],"reference":["cheque number"],"balance":["balance"]},"amount":{"mode":"split","debit":["withdrawal"],"credit":["deposit"]},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.pnb.pdf.v1', 'Punjab National Bank statement (PDF)', 'bank', 'pnb', 111, '{"sourceKind":"bank","sourceApp":"pnb","verified":false,"id":"bank.pnb.pdf.v1","label":"Punjab National Bank statement (PDF)","reader":"pdf_text","text":{"detect":["\\bPunjab\\s+National\\s+Bank\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.bob.table.v1', 'Bank of Baroda statement (CSV/Excel)', 'bank', 'bob', 112, '{"sourceKind":"bank","sourceApp":"bob","verified":false,"id":"bank.bob.table.v1","label":"Bank of Baroda statement (CSV/Excel)","reader":"table","table":{"headerMatch":["tran date","narration","withdrawal","deposit"],"columns":{"date":["tran date","value date"],"narration":["narration"],"reference":["chqno","cheque no"],"balance":["balance"]},"amount":{"mode":"split","debit":["withdrawal dr","withdrawal"],"credit":["deposit cr","deposit"]},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.bob.pdf.v1', 'Bank of Baroda statement (PDF)', 'bank', 'bob', 113, '{"sourceKind":"bank","sourceApp":"bob","verified":false,"id":"bank.bob.pdf.v1","label":"Bank of Baroda statement (PDF)","reader":"pdf_text","text":{"detect":["\\bBank\\s+of\\s+Baroda\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.canara.table.v1', 'Canara Bank statement (CSV/Excel)', 'bank', 'canara', 114, '{"sourceKind":"bank","sourceApp":"canara","verified":false,"id":"bank.canara.table.v1","label":"Canara Bank statement (CSV/Excel)","reader":"table","table":{"headerMatch":["txn date","description","branch code","debit","credit"],"columns":{"date":["txn date","value date"],"narration":["description"],"reference":["cheque no"],"balance":["balance"]},"amount":{"mode":"split","debit":["debit"],"credit":["credit"]},"dateFormats":["dd-MM-yyyy HH:mm:ss","dd-MM-yyyy","dd/MM/yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.canara.pdf.v1', 'Canara Bank statement (PDF)', 'bank', 'canara', 115, '{"sourceKind":"bank","sourceApp":"canara","verified":false,"id":"bank.canara.pdf.v1","label":"Canara Bank statement (PDF)","reader":"pdf_text","text":{"detect":["\\bCanara\\s+Bank\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd-MM-yyyy HH:mm:ss","dd-MM-yyyy","dd/MM/yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.union.table.v1', 'Union Bank of India statement (CSV/Excel)', 'bank', 'union', 116, '{"sourceKind":"bank","sourceApp":"union","verified":false,"id":"bank.union.table.v1","label":"Union Bank of India statement (CSV/Excel)","reader":"table","table":{"headerMatch":["date","tran id","remarks","amount"],"columns":{"date":["date","tran date"],"narration":["remarks"],"reference":["tran id"],"balance":["balance"]},"amount":{"mode":"signed","amount":["amount rs","amount"]},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.union.pdf.v1', 'Union Bank of India statement (PDF)', 'bank', 'union', 117, '{"sourceKind":"bank","sourceApp":"union","verified":false,"id":"bank.union.pdf.v1","label":"Union Bank of India statement (PDF)","reader":"pdf_text","text":{"detect":["\\bUnion\\s+Bank\\s+of\\s+India\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.boi.table.v1', 'Bank of India statement (CSV/Excel)', 'bank', 'boi', 118, '{"sourceKind":"bank","sourceApp":"boi","verified":false,"id":"bank.boi.table.v1","label":"Bank of India statement (CSV/Excel)","reader":"table","table":{"headerMatch":["txn date","description","withdrawal","deposit"],"columns":{"date":["txn date"],"narration":["description"],"reference":["cheque no"],"balance":["balance"]},"amount":{"mode":"split","debit":["withdrawal dr","withdrawal"],"credit":["deposit cr","deposit"]},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.boi.pdf.v1', 'Bank of India statement (PDF)', 'bank', 'boi', 119, '{"sourceKind":"bank","sourceApp":"boi","verified":false,"id":"bank.boi.pdf.v1","label":"Bank of India statement (PDF)","reader":"pdf_text","text":{"detect":["\\bBank\\s+of\\s+India\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.indian.table.v1', 'Indian Bank statement (CSV/Excel)', 'bank', 'indian', 120, '{"sourceKind":"bank","sourceApp":"indian","verified":false,"id":"bank.indian.table.v1","label":"Indian Bank statement (CSV/Excel)","reader":"table","table":{"headerMatch":["post date","details","debit","credit"],"columns":{"date":["post date","value date"],"narration":["details"],"balance":["balance"]},"amount":{"mode":"split","debit":["debit"],"credit":["credit"]},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd MMM yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.indian.pdf.v1', 'Indian Bank statement (PDF)', 'bank', 'indian', 121, '{"sourceKind":"bank","sourceApp":"indian","verified":false,"id":"bank.indian.pdf.v1","label":"Indian Bank statement (PDF)","reader":"pdf_text","text":{"detect":["\\bIndian\\s+Bank\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd MMM yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.central.table.v1', 'Central Bank of India statement (CSV/Excel)', 'bank', 'central', 122, '{"sourceKind":"bank","sourceApp":"central","verified":false,"id":"bank.central.table.v1","label":"Central Bank of India statement (CSV/Excel)","reader":"table","table":{"headerMatch":["post date","account description","debit","credit"],"columns":{"date":["post date","value date"],"narration":["account description"],"reference":["cheque number"],"balance":["balance"]},"amount":{"mode":"split","debit":["debit"],"credit":["credit"]},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.central.pdf.v1', 'Central Bank of India statement (PDF)', 'bank', 'central', 123, '{"sourceKind":"bank","sourceApp":"central","verified":false,"id":"bank.central.pdf.v1","label":"Central Bank of India statement (PDF)","reader":"pdf_text","text":{"detect":["\\bCentral\\s+Bank\\s+of\\s+India\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.iob.table.v1', 'Indian Overseas Bank statement (CSV/Excel)', 'bank', 'iob', 124, '{"sourceKind":"bank","sourceApp":"iob","verified":false,"id":"bank.iob.table.v1","label":"Indian Overseas Bank statement (CSV/Excel)","reader":"table","table":{"headerMatch":["naration","cod","debit","credit"],"columns":{"date":["date","value date"],"narration":["naration","narration"],"reference":["chq no"],"balance":["balance"]},"amount":{"mode":"split","debit":["debit"],"credit":["credit"]},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd-MMM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.iob.pdf.v1', 'Indian Overseas Bank statement (PDF)', 'bank', 'iob', 125, '{"sourceKind":"bank","sourceApp":"iob","verified":false,"id":"bank.iob.pdf.v1","label":"Indian Overseas Bank statement (PDF)","reader":"pdf_text","text":{"detect":["\\bIndian\\s+Overseas\\s+Bank\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd-MMM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.uco.table.v1', 'UCO Bank statement (CSV/Excel)', 'bank', 'uco', 126, '{"sourceKind":"bank","sourceApp":"uco","verified":false,"id":"bank.uco.table.v1","label":"UCO Bank statement (CSV/Excel)","reader":"table","table":{"headerMatch":["particulars","withdrawals","deposits"],"columns":{"date":["date","txn date"],"narration":["particulars"],"reference":["chq no"],"balance":["balance"]},"amount":{"mode":"split","debit":["withdrawals"],"credit":["deposits"]},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd-MMM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.uco.pdf.v1', 'UCO Bank statement (PDF)', 'bank', 'uco', 127, '{"sourceKind":"bank","sourceApp":"uco","verified":false,"id":"bank.uco.pdf.v1","label":"UCO Bank statement (PDF)","reader":"pdf_text","text":{"detect":["\\bUCO\\s+Bank\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd-MMM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.bom.table.v1', 'Bank of Maharashtra statement (CSV/Excel)', 'bank', 'bom', 128, '{"sourceKind":"bank","sourceApp":"bom","verified":false,"id":"bank.bom.table.v1","label":"Bank of Maharashtra statement (CSV/Excel)","reader":"table","table":{"headerMatch":["particulars","cheque reference no","debit","credit"],"columns":{"date":["date"],"narration":["particulars"],"reference":["cheque reference no"],"balance":["balance"]},"amount":{"mode":"split","debit":["debit"],"credit":["credit"]},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.bom.pdf.v1', 'Bank of Maharashtra statement (PDF)', 'bank', 'bom', 129, '{"sourceKind":"bank","sourceApp":"bom","verified":false,"id":"bank.bom.pdf.v1","label":"Bank of Maharashtra statement (PDF)","reader":"pdf_text","text":{"detect":["\\bBank\\s+of\\s+Maharashtra\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb),
  ('table', 'bank.psb.table.v1', 'Punjab & Sind Bank statement (CSV/Excel)', 'bank', 'psb', 130, '{"sourceKind":"bank","sourceApp":"psb","verified":false,"id":"bank.psb.table.v1","label":"Punjab & Sind Bank statement (CSV/Excel)","reader":"table","table":{"headerMatch":["txn date","description","debit","credit"],"columns":{"date":["txn date"],"narration":["description"],"balance":["balance"]},"amount":{"mode":"split","debit":["debit"],"credit":["credit"]},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"]}}'::jsonb),
  ('text', 'bank.psb.pdf.v1', 'Punjab & Sind Bank statement (PDF)', 'bank', 'psb', 131, '{"sourceKind":"bank","sourceApp":"psb","verified":false,"id":"bank.psb.pdf.v1","label":"Punjab & Sind Bank statement (PDF)","reader":"pdf_text","text":{"detect":["\\bPunjab\\s+&\\s+Sind\\s+Bank\\b"],"detectWithinLines":15,"recordStart":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\b","ignoreLines":["^Page \\d+","^(?:Txn|Tran|Transaction|Value|Post)?\\s*Date\\b","statement of account","computer generated"],"fields":{"date":"^(?<date>\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})","amount":"(?<amount>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s+(?<balance>[\\d,]+\\.\\d{2})\\s*(?:Dr|Cr)?\\s*$","narration":"^(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+(?:(?:\\d{1,2}[/-](?:\\d{1,2}|[A-Za-z]{3})[/-]\\d{2,4}|\\d{1,2} [A-Za-z]{3} \\d{4})\\s+)?(?<narration>.+?)\\s+[\\d,]+\\.\\d{2}","debitWhen":"UPI/DR|\\bDR\\b|TO TRANSFER|WITHDRAWAL|\\bATM\\b|\\bPOS\\b|DEBIT","creditWhen":"UPI/CR|\\bCR\\b|BY TRANSFER|DEPOSIT|REFUND|REVERSAL|SALARY|INTEREST|CREDIT"},"dateFormats":["dd/MM/yyyy","dd-MM-yyyy","dd/MM/yy","dd-MM-yy","d MMM yyyy","dd MMM yyyy","dd-MMM-yyyy","dd-MMM-yy"],"directionFromBalance":true}}'::jsonb)
on conflict (kind, signature) do nothing;

-- ---------------------------------------------------------------------------
-- Imports: detected source, chosen layout, temporary PDF text for AI reading
-- ---------------------------------------------------------------------------
alter table public.imports
  alter column source_kind drop not null,
  alter column source_app drop not null,
  add column layout_id uuid references public.import_layouts (id) on delete set null,
  -- PDF lines kept only while the LLM reads them in chunks; cleared when processing finishes.
  add column extracted_text jsonb,
  -- What the file was detected as, e.g. "HDFC Bank statement (CSV/Excel)" or "Read by AI".
  add column detected_label text check (char_length(detected_label) <= 160),
  -- True when an LLM read the rows (PDF) or worked out the columns (CSV/Excel) for this import.
  add column read_by_ai boolean not null default false,
  drop column template_id,
  drop column config;

drop table public.import_templates;
drop table public.llm_configs;

-- ---------------------------------------------------------------------------
-- New default categories: Individual (person-to-person) and Credit Card Bill
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_categories(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (user_id, name, kind_hint, color, is_system)
  select p_user_id, v.name, v.kind::public.transaction_kind, v.color, true
  from (values
    ('Food & Dining', 'expense', '#e8590c'),
    ('Groceries', 'expense', '#2f9e44'),
    ('Shopping', 'expense', '#ae3ec9'),
    ('Transport', 'expense', '#1c7ed6'),
    ('Fuel', 'expense', '#5c7cfa'),
    ('Bills & Utilities', 'expense', '#f08c00'),
    ('Rent', 'expense', '#c2255c'),
    ('Mobile & Internet', 'expense', '#0ca678'),
    ('Entertainment', 'expense', '#7048e8'),
    ('Health', 'expense', '#e03131'),
    ('Education', 'expense', '#3b5bdb'),
    ('Travel', 'expense', '#1098ad'),
    ('Personal Care', 'expense', '#d6336c'),
    ('Subscriptions', 'expense', '#6741d9'),
    ('Gifts & Donations', 'expense', '#f76707'),
    ('EMI & Loans', 'expense', '#495057'),
    ('Fees & Charges', 'expense', '#868e96'),
    ('Investments', 'self_transfer', '#087f5b'),
    ('Credit Card Bill', 'cc_bill_payment', '#5f3dc4'),
    ('Individual', 'expense', '#74b816'),
    ('Salary', 'income', '#2b8a3e'),
    ('Other', 'expense', '#adb5bd')
  ) as v (name, kind, color)
  on conflict do nothing
$$;
revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- Existing users get the two new categories too.
insert into public.categories (user_id, name, kind_hint, color, is_system)
select p.id, v.name, v.kind::public.transaction_kind, v.color, true
  from public.profiles p
 cross join (values ('Credit Card Bill', 'cc_bill_payment', '#5f3dc4'), ('Individual', 'expense', '#74b816')) as v (name, kind, color)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Category map: keyword → category
-- ---------------------------------------------------------------------------
create table public.category_map (
  id uuid primary key default gen_random_uuid(),
  -- null = shared by everyone (seed or LLM-learned); set = that user's own correction.
  user_id uuid references auth.users (id) on delete cascade,
  keyword text not null check (keyword ~ '^[a-z0-9][a-z0-9 &.''-]{1,59}$'),
  category_name text not null check (char_length(category_name) between 1 and 80),
  transaction_kind public.transaction_kind,
  origin text not null check (origin in ('seed', 'llm', 'user')),
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index category_map_scope_keyword_uidx
  on public.category_map (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), keyword);
create trigger set_updated_at before update on public.category_map
  for each row execute function public.set_updated_at();

alter table public.category_map enable row level security;
create policy category_map_read on public.category_map
  for select to authenticated
  using ((user_id is null or user_id = (select auth.uid())) and (select public.is_permanent_user()));
revoke all on public.category_map from anon;
revoke insert, update, delete on public.category_map from authenticated;

insert into public.category_map (keyword, category_name, transaction_kind, origin)
select v.keyword, v.category, v.kind::public.transaction_kind, 'seed'
from (values
  ('zomato', 'Food & Dining', null), ('swiggy', 'Food & Dining', null), ('dominos', 'Food & Dining', null),
  ('mcdonalds', 'Food & Dining', null), ('kfc', 'Food & Dining', null), ('starbucks', 'Food & Dining', null),
  ('eatsure', 'Food & Dining', null), ('box8', 'Food & Dining', null),
  ('swiggy instamart', 'Groceries', null), ('instamart', 'Groceries', null), ('blinkit', 'Groceries', null),
  ('zepto', 'Groceries', null), ('bigbasket', 'Groceries', null), ('dmart', 'Groceries', null), ('jiomart', 'Groceries', null),
  ('myntra', 'Shopping', null), ('amazon', 'Shopping', null), ('flipkart', 'Shopping', null), ('ajio', 'Shopping', null),
  ('meesho', 'Shopping', null), ('nykaa', 'Shopping', null), ('tata cliq', 'Shopping', null), ('croma', 'Shopping', null),
  ('decathlon', 'Shopping', null),
  ('uber', 'Transport', null), ('ola', 'Transport', null), ('rapido', 'Transport', null), ('namma yatri', 'Transport', null),
  ('fastag', 'Transport', null),
  ('indian oil', 'Fuel', null), ('iocl', 'Fuel', null), ('hpcl', 'Fuel', null), ('bharat petroleum', 'Fuel', null),
  ('bpcl', 'Fuel', null),
  ('irctc', 'Travel', null), ('makemytrip', 'Travel', null), ('goibibo', 'Travel', null), ('cleartrip', 'Travel', null),
  ('indigo', 'Travel', null), ('air india', 'Travel', null), ('redbus', 'Travel', null), ('ixigo', 'Travel', null),
  ('oyo', 'Travel', null),
  ('airtel', 'Mobile & Internet', null), ('jio', 'Mobile & Internet', null), ('bsnl', 'Mobile & Internet', null),
  ('act fibernet', 'Mobile & Internet', null),
  ('bescom', 'Bills & Utilities', null), ('tata power', 'Bills & Utilities', null), ('adani electricity', 'Bills & Utilities', null),
  ('mahanagar gas', 'Bills & Utilities', null), ('indane', 'Bills & Utilities', null), ('bharatgas', 'Bills & Utilities', null),
  ('apple media', 'Entertainment', null), ('bookmyshow', 'Entertainment', null), ('pvr', 'Entertainment', null),
  ('inox', 'Entertainment', null),
  ('netflix', 'Subscriptions', null), ('spotify', 'Subscriptions', null), ('hotstar', 'Subscriptions', null),
  ('youtube premium', 'Subscriptions', null), ('prime video', 'Subscriptions', null), ('google play', 'Subscriptions', null),
  ('apollo', 'Health', null), ('pharmeasy', 'Health', null), ('1mg', 'Health', null), ('netmeds', 'Health', null),
  ('practo', 'Health', null), ('medplus', 'Health', null),
  ('udemy', 'Education', null), ('coursera', 'Education', null), ('unacademy', 'Education', null),
  ('urban company', 'Personal Care', null),
  ('indmoney', 'Investments', 'self_transfer'), ('nse', 'Investments', 'self_transfer'), ('bse', 'Investments', 'self_transfer'),
  ('zerodha', 'Investments', 'self_transfer'), ('groww', 'Investments', 'self_transfer'), ('upstox', 'Investments', 'self_transfer'),
  ('angel one', 'Investments', 'self_transfer'), ('kuvera', 'Investments', 'self_transfer'), ('smallcase', 'Investments', 'self_transfer'),
  ('indian clearing corporation', 'Investments', 'self_transfer'),
  ('indmoney credit card repayment', 'Credit Card Bill', 'cc_bill_payment'), ('cred club', 'Credit Card Bill', 'cc_bill_payment'),
  ('credit card payment', 'Credit Card Bill', 'cc_bill_payment'), ('credit card bill', 'Credit Card Bill', 'cc_bill_payment')
) as v (keyword, category, kind)
on conflict do nothing;

-- Carry over users' learned merchant choices as their own keyword rows, then retire merchant_map.
insert into public.category_map (user_id, keyword, category_name, transaction_kind, origin)
select m.user_id,
       left(trim(regexp_replace(lower(m.merchant_name), '[^a-z0-9 &.''-]+', ' ', 'g')), 60),
       c.name, m.transaction_kind, 'user'
  from public.merchant_map m
  join public.categories c on c.id = m.category_id
 where m.merchant_name is not null
   and trim(regexp_replace(lower(m.merchant_name), '[^a-z0-9 &.''-]+', ' ', 'g')) ~ '^[a-z0-9][a-z0-9 &.''-]{1,59}$'
on conflict do nothing;

drop table public.merchant_map;
