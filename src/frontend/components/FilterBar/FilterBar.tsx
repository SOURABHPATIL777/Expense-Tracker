import type { ReactNode } from "react";
import { Button } from "@/frontend/components/Button/Button";
import styles from "./FilterBar.module.css";

/** One row of filters above a list; wraps on small screens. */
export function FilterBar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className={styles.bar} role="search">
      {children}
      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset} className={styles.reset}>
          Reset
        </Button>
      )}
    </div>
  );
}
