"use client";

import { Button } from "@/frontend/components/Button/Button";
import { DateText } from "@/frontend/components/DateText/DateText";
import { useToast } from "@/frontend/components/Toast/Toast";
import styles from "./ShareLinkCard.module.css";

/**
 * Shows a freshly issued private link once. The message is deliberately generic: no amounts or
 * names travel in chat previews; the recipient sees details only after opening the link.
 */
export function ShareLinkCard({ name, url, expiresAt }: { name: string; url: string; expiresAt: string }) {
  const toast = useToast();
  const message = `Hi ${name}, I've shared an expense with you. Open this private link to see your part: ${url}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    toast.show("Link copied", "success");
  }

  return (
    <div className={styles.card}>
      <p className={styles.lead}>
        This link is for <strong>{name}</strong> only. Anyone who opens it first can respond as them, so send it directly.
      </p>
      <code className={styles.url}>{url}</code>
      <div className={styles.actions}>
        <Button onClick={copy}>Copy link</Button>
        <a className={styles.whatsapp} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
          Share on WhatsApp
        </a>
      </div>
      <p className={styles.muted}>
        Expires <DateText iso={expiresAt} />. Creating a new link turns this one off.
      </p>
    </div>
  );
}
