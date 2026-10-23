import { BANKS, UPI_APPS, type SourceApp, type SourceKind } from "./enums";

// Per-source configuration: which file formats each UPI app / bank accepts and how users get the file.
// The upload UI, API validation and storage policy all read from here.

export const FILE_FORMATS = {
  csv: { label: "CSV", extensions: [".csv"], mimeTypes: ["text/csv", "application/csv", "text/plain"] },
  excel: {
    label: "Excel",
    extensions: [".xls", ".xlsx"],
    mimeTypes: ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  pdf: { label: "PDF", extensions: [".pdf"], mimeTypes: ["application/pdf"] },
  html: { label: "HTML", extensions: [".html", ".htm"], mimeTypes: ["text/html"] },
  json: { label: "JSON", extensions: [".json"], mimeTypes: ["application/json", "text/plain"] },
} as const;

export type FileFormat = keyof typeof FILE_FORMATS;
export const ALL_FORMATS = Object.keys(FILE_FORMATS) as FileFormat[];

export type SourceConfig = {
  kind: SourceKind;
  formats: readonly FileFormat[];
  /** Where to find the export inside the app / net banking. */
  howToExport: string;
  /** Shown when a PDF is password protected. */
  passwordHint?: string;
};

const BANK_DEFAULT: Omit<SourceConfig, "howToExport"> = {
  kind: "bank",
  formats: ALL_FORMATS,
  passwordHint: "Banks often use a mix of your name, date of birth or customer ID. Check the email the statement came with.",
};

const bank = (howToExport: string, overrides: Partial<SourceConfig> = {}): SourceConfig => ({ ...BANK_DEFAULT, howToExport, ...overrides });

export const SOURCE_CONFIG: Record<SourceApp, SourceConfig> = {
  phonepe: {
    kind: "upi_app",
    formats: ALL_FORMATS,
    howToExport: "PhonePe app → History → Download statement (choose date range) → open the emailed file.",
    passwordHint: "PhonePe statements are usually protected with your registered mobile number.",
  },
  gpay: {
    kind: "upi_app",
    formats: ALL_FORMATS,
    howToExport: "Google Pay app → Profile → Settings → Transaction history → Download statement.",
  },
  paytm: {
    kind: "upi_app",
    formats: ALL_FORMATS,
    howToExport: "Paytm app → Balance & History → Download UPI statement (Excel or PDF).",
    passwordHint: "Paytm statements may be protected with your registered mobile number.",
  },
  other_upi: { kind: "upi_app", formats: ALL_FORMATS, howToExport: "Download the statement from your UPI app's history section." },
  hdfc: bank("NetBanking → Accounts → Account statement → choose period → Download as Excel/Delimited/PDF."),
  icici: bank("iMobile / NetBanking → Accounts → Statement → Detailed statement → Download (XLS/PDF)."),
  sbi: bank("YONO / OnlineSBI → Account statement → choose period → Download (Excel/PDF)."),
  pnb: bank("PNB ONE / internet banking → Accounts → Account statement → Download."),
  bob: bank("bob World → Accounts → Account statement → Download."),
  canara: bank("Canara ai1 → Accounts → Account statement → Download."),
  union: bank("Union Vyom → Accounts → Mini/Detailed statement → Download."),
  boi: bank("BOI Mobile / Star Connect → Account statement → Download."),
  indian: bank("IndOASIS → Accounts → Account statement → Download."),
  central: bank("Cent Mobile → Account statement → Download."),
  iob: bank("IOB Mobile / internet banking → Account statement → Download."),
  uco: bank("UCO mBanking → Account statement → Download."),
  bom: bank("Mahamobile → Account statement → Download."),
  psb: bank("PSB UnIC → Account statement → Download."),
  axis: bank("Axis Mobile / internet banking → Accounts → Statement → choose period → Download (PDF/Excel)."),
  kotak: bank("Kotak811 / net banking → Account statement → choose period → Download (PDF/Excel)."),
  yes: bank("YES Mobile / net banking → Accounts → Statement → Download."),
  idfc: bank("IDFC FIRST app → Account → Statements → Download."),
  indusind: bank("IndusMobile / net banking → Account statement → Download."),
  au: bank("AU 0101 app / net banking → Account statement → Download."),
  federal: bank("FedMobile / FedNet → Account statement → Download."),
  rbl: bank("RBL MoBank / net banking → Account statement → Download."),
  idbi: bank("IDBI GO Mobile+ / net banking → Account statement → Download."),
  bandhan: bank("mBandhan / net banking → Account statement → Download."),
  hsbc: bank("HSBC India app / net banking → Statements → Download (text PDF, not a scanned copy)."),
  sc: bank("SC Mobile / online banking → e-Statements → Download."),
  other_bank: bank("Download your account statement from net banking or the bank's app."),
};

export const UPI_SOURCES = UPI_APPS;
export const BANK_SOURCES = BANKS;

const extensionOf = (fileName: string) => fileName.slice(fileName.lastIndexOf(".")).toLowerCase();

export function formatForFileName(fileName: string): FileFormat | null {
  const ext = extensionOf(fileName);
  return ALL_FORMATS.find((f) => (FILE_FORMATS[f].extensions as readonly string[]).includes(ext)) ?? null;
}

export function acceptedExtensions(app?: SourceApp): string[] {
  const formats = app ? SOURCE_CONFIG[app].formats : ALL_FORMATS;
  return formats.flatMap((f) => [...FILE_FORMATS[f].extensions]);
}

export const ALL_MIME_TYPES: string[] = ALL_FORMATS.flatMap((f) => [...FILE_FORMATS[f].mimeTypes]);
