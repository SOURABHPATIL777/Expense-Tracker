"use client";

import { useState } from "react";
import { UploadQueue, type UploadItem } from "@/frontend/lib/uploadQueue";
import { uploadStatement } from "@/frontend/lib/uploadStatement";

/** Several statements uploading at once, with per-file progress, errors and retry. */
export function useUploadQueue() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [queue] = useState(() => new UploadQueue(uploadStatement, setItems));
  return {
    items,
    busy: items.some((i) => i.status === "queued" || i.status === "uploading"),
    /** Returns the new items' ids. */
    add: (files: File[]) => queue.add(files),
    retry: (id: string) => queue.retry(id),
    clearFinished: () => queue.clearFinished(),
  };
}
