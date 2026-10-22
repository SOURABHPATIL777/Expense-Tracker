import styles from "./Skeleton.module.css";

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className={styles.line} />
      ))}
    </div>
  );
}
