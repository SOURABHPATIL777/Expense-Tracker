import { ButtonLink } from "@/frontend/components/Button/Button";
import { DonutChart } from "@/frontend/components/DonutChart/DonutChart";
import { Icon, type IconName } from "@/frontend/components/Icon/Icon";
import { formatInr } from "@/frontend/lib/format";
import { PAGE_ROUTES } from "@/shared/constants/routes";
import styles from "./HomePage.module.css";

const FEATURES: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "pie",
    title: "Your real spending",
    body: "Import PhonePe, Google Pay, Paytm and bank statements. Own-account transfers, refunds and money friends owe you are kept out of your expenses.",
  },
  {
    icon: "users",
    title: "Money owed to you",
    body: "Split a payment and send each friend a private link. They can agree and report payment without signing up.",
  },
  {
    icon: "refund",
    title: "Refunds still missing",
    body: "Mark a payment as refund-expected and we match incoming credits for you, or tell you nothing has arrived yet.",
  },
];

/** Illustrative numbers for the preview card (not anyone's data). */
const EXAMPLE = [
  { key: "food", label: "Food & Dining", value: 812000, color: "var(--chart-1)" },
  { key: "shopping", label: "Shopping", value: 645000, color: "var(--chart-2)" },
  { key: "travel", label: "Travel", value: 410000, color: "var(--chart-3)" },
  { key: "bills", label: "Bills", value: 268000, color: "var(--chart-4)" },
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.copy}>
          <span className={styles.brand}>
            <span className={styles.logo} aria-hidden>
              ₹
            </span>
            UPI Spend
          </span>
          <h1 className={styles.title}>Know what you actually spent.</h1>
          <p className={styles.lead}>
            One clear picture across PhonePe, Google Pay, Paytm and your bank, with transfers, shared bills and pending refunds kept apart.
          </p>
          <div className={styles.actions}>
            <ButtonLink href={PAGE_ROUTES.signup}>Create free account</ButtonLink>
            <ButtonLink href={PAGE_ROUTES.login} variant="secondary">
              Sign in
            </ButtonLink>
          </div>
          <p className={styles.note}>
            <Icon name="check" size={16} /> We never ask for UPI PINs, OTPs or bank passwords.
          </p>
        </div>

        <div className={styles.preview} aria-label="Example dashboard">
          <span className={styles.previewTag}>Example</span>
          <p className={styles.previewEyebrow}>You spent in October</p>
          <p className={`${styles.previewAmount} tabular`}>{formatInr(2135000)}</p>
          <DonutChart label="Example spending by category" items={EXAMPLE} centerLabel="Spent" />
        </div>
      </section>

      <section className={styles.features}>
        {FEATURES.map((f) => (
          <article key={f.title} className={styles.feature}>
            <span className={styles.featureIcon} aria-hidden>
              <Icon name={f.icon} size={22} />
            </span>
            <h2 className={styles.featureTitle}>{f.title}</h2>
            <p className={styles.featureBody}>{f.body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
