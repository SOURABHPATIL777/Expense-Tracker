import { api, ApiError, newIdempotencyKey } from "@/frontend/lib/apiClient";
import { API_ROUTES } from "@/shared/constants/routes";
import type { SourceApp } from "@/shared/constants/enums";
import type { CreateImportResultDto, ImportDto } from "@/shared/schemas/imports";

export type UploadStage = "hashing" | "registering" | "uploading" | "queuing";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Register → upload straight to private storage via a short-lived signed URL → tell the API it's
 * there. The hash lets the server reject an exact re-import and verify the stored bytes.
 */
export async function uploadStatement(
  file: File,
  opts: { sourceApp: SourceApp; accountId?: string; onStage?: (s: UploadStage) => void },
): Promise<ImportDto> {
  opts.onStage?.("hashing");
  const sha256 = await sha256Hex(file);

  opts.onStage?.("registering");
  const { data } = await api.post<CreateImportResultDto>(
    API_ROUTES.imports,
    { fileName: file.name, fileSize: file.size, sha256, sourceApp: opts.sourceApp, accountId: opts.accountId || undefined },
    { idempotencyKey: newIdempotencyKey() },
  );

  opts.onStage?.("uploading");
  const put = await fetch(data.upload.url, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!put.ok) throw new ApiError("UPLOAD_FAILED", "The file upload failed. Please try again.", put.status);

  opts.onStage?.("queuing");
  return (await api.post<ImportDto>(API_ROUTES.importUploaded(data.import.id))).data;
}
