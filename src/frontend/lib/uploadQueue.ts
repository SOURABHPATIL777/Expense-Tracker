import { ApiError } from "@/frontend/lib/apiClient";
import type { UploadStage } from "@/frontend/lib/uploadStatement";
import type { ImportDto } from "@/shared/schemas/imports";

export type UploadItemStatus = "queued" | "uploading" | "done" | "error";

export type UploadItem = {
  id: string;
  file: File;
  status: UploadItemStatus;
  stage?: UploadStage;
  import?: ImportDto;
  error?: string;
  /** The existing import when the server refused a duplicate. */
  existingImportId?: string;
};

type Upload = (file: File, opts: { onStage: (s: UploadStage) => void }) => Promise<ImportDto>;

/**
 * Uploads statements a few at a time (each is hash → register → PUT to storage → confirm).
 * Framework-free so it can be tested; `useUploadQueue` adapts it for React.
 */
export class UploadQueue {
  private items: UploadItem[] = [];
  private active = 0;
  private seq = 0;

  constructor(
    private readonly upload: Upload,
    private readonly onChange: (items: UploadItem[]) => void,
    private readonly concurrency = 2,
  ) {}

  /** Queues files and returns their ids. */
  add(files: File[]): string[] {
    const added = files.map((file) => ({ id: `${Date.now()}-${this.seq++}`, file, status: "queued" as const }));
    this.items.push(...added);
    this.emit();
    this.pump();
    return added.map((i) => i.id);
  }

  retry(id: string): void {
    this.patch(id, { status: "queued", error: undefined, stage: undefined });
    this.pump();
  }

  /** Drops finished and failed rows from the list. */
  clearFinished(): void {
    this.items = this.items.filter((i) => i.status === "queued" || i.status === "uploading");
    this.emit();
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const next = this.items.find((i) => i.status === "queued");
      if (!next) return;
      this.active += 1;
      this.patch(next.id, { status: "uploading" });
      void this.run(next).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async run(item: UploadItem): Promise<void> {
    try {
      const imp = await this.upload(item.file, { onStage: (stage) => this.patch(item.id, { stage }) });
      this.patch(item.id, { status: "done", import: imp, stage: undefined });
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError("UNKNOWN", "Upload failed. Please try again.", 0);
      const existing = (e.details as { importId?: string } | undefined)?.importId;
      this.patch(item.id, { status: "error", error: e.message, existingImportId: existing, stage: undefined });
    }
  }

  private patch(id: string, patch: Partial<UploadItem>): void {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    this.emit();
  }

  private emit(): void {
    this.onChange([...this.items]);
  }
}
