"use client";

import { useId, useState, type DragEvent } from "react";
import { cx } from "@/frontend/lib/cx";
import { UPLOAD } from "@/shared/constants/limits";
import styles from "./FileDropzone.module.css";

type FileDropzoneProps = {
  onFile: (file: File) => void;
  disabled?: boolean;
  accept?: readonly string[];
  maxBytes?: number;
  hint?: string;
};

export function FileDropzone({ onFile, disabled, accept = UPLOAD.ACCEPTED_EXTENSIONS, maxBytes = UPLOAD.MAX_FILE_BYTES, hint }: FileDropzoneProps) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>();

  function pick(file: File | undefined) {
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!accept.includes(ext)) return setError(`Unsupported file type. Use ${accept.join(", ")}.`);
    if (file.size > maxBytes) return setError(`File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    setError(undefined);
    onFile(file);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    if (!disabled) pick(e.dataTransfer.files[0]);
  }

  return (
    <div>
      <label
        htmlFor={id}
        className={cx(styles.zone, dragging && styles.dragging, disabled && styles.disabled)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className={styles.title}>Drop your statement here, or click to choose</span>
        <span className={styles.hint}>{hint ?? `${accept.join(", ")} · up to ${Math.round(maxBytes / 1024 / 1024)} MB`}</span>
        <input
          id={id}
          type="file"
          className="visually-hidden"
          accept={accept.join(",")}
          disabled={disabled}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
