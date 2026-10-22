"use client";

import { useId, useState, type DragEvent } from "react";
import { cx } from "@/frontend/lib/cx";
import { Icon } from "@/frontend/components/Icon/Icon";
import { UPLOAD } from "@/shared/constants/limits";
import { acceptedExtensions } from "@/shared/constants/sources";
import styles from "./FileDropzone.module.css";

type FileDropzoneProps = {
  /** Called with every file that passed the type and size checks. */
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  accept?: readonly string[];
  maxBytes?: number;
  hint?: string;
};

/** Pick or drop one or more statements; files of the wrong type or size are listed, not uploaded. */
export function FileDropzone({ onFiles, disabled, accept = acceptedExtensions(), maxBytes = UPLOAD.MAX_FILE_BYTES, hint }: FileDropzoneProps) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const maxMb = Math.round(maxBytes / 1024 / 1024);

  function pick(list: FileList | null | undefined) {
    const files = [...(list ?? [])];
    if (files.length === 0) return;
    const problems: string[] = [];
    const ok = files.filter((file) => {
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (!accept.includes(ext)) problems.push(`${file.name}: use ${accept.join(", ")}`);
      else if (file.size > maxBytes) problems.push(`${file.name}: larger than ${maxMb} MB`);
      else return true;
      return false;
    });
    setRejected(problems);
    if (ok.length) onFiles(ok);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    if (!disabled) pick(e.dataTransfer.files);
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
        <span className={styles.icon} aria-hidden>
          <Icon name="upload" size={26} />
        </span>
        <span className={styles.title}>
          <span className={styles.pointer}>Drop statements here or click to choose</span>
          <span className={styles.touch}>Tap to choose statements</span>
        </span>
        <span className={styles.hint}>{hint ?? `${accept.join(", ")} · up to ${maxMb} MB each`}</span>
        <input
          id={id}
          type="file"
          multiple
          className="visually-hidden"
          accept={accept.join(",")}
          disabled={disabled}
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {rejected.length > 0 && (
        <ul className={styles.errors} role="alert">
          {rejected.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
