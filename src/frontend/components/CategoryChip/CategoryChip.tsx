import type { CategoryDto } from "@/shared/schemas/categories";
import styles from "./CategoryChip.module.css";

/** Colour dot + name; "Uncategorised" when no category is set. */
export function CategoryChip({ category }: { category: Pick<CategoryDto, "name" | "color"> | null | undefined }) {
  if (!category) return <span className={styles.none}>Uncategorised</span>;
  return (
    <span className={styles.chip} title={category.name}>
      <span className={styles.dot} style={{ background: category.color ?? "var(--color-border-strong)" }} aria-hidden />
      <span className={styles.name}>{category.name}</span>
    </span>
  );
}
