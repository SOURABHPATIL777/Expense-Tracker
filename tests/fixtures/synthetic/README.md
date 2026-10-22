# Synthetic fixtures

These files are **hand-made** in the shape of real HDFC, Paytm, PhonePe and SBI exports. They contain
no real data. They prove the engine and the AI-read checks work as designed; they do **not** prove
how a real export looks. When an anonymised real export passes, add it under `tests/fixtures/real/`
and set `verified = true` on its `import_layouts` row.
