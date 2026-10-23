-- Earlier imports get their names worked out again (see 20261026000002): a job reads each import's
-- stored rows, or the file itself when the user uploads the same statement again.
alter type public.job_type add value if not exists 'reread_import';

-- A bank's name is never a category keyword. UPI narrations end with the payee's bank
-- ("…/BASAVESHWARA GRAPE PR/dry gr/State Bank Of India"), so keywords such as "state bank of india"
-- learned by the AI turned shop payments into own-account transfers.
delete from public.category_map_keyword
where origin in ('llm', 'user')
  and (keyword ~ '\mbank\M' or keyword in ('kotak mahindra', 'idfc first', 'indusind', 'hsbc', 'standard chartered', 'au small finance'));

-- Keywords learned from a whole dated narration ("technology icici bank limited salary june 2026")
-- match no other month; the user's choice now spreads by the payer's name instead.
delete from public.category_map_keyword
where origin = 'user'
  and keyword ~ '\m(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(20)?[0-9]{2}$';
