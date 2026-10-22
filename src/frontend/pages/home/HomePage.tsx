import { ButtonLink } from "@/frontend/components/Button/Button";
import { PAGE_ROUTES } from "@/shared/constants/routes";
import styles from "./HomePage.module.css";

const FEATURES = [
  {
    title: "Your real spending",
    body: "Import PhonePe, Google Pay, Paytm and bank statements. Own-account transfers, refunds and money friends owe you are kept out of your expenses.",
  },
  {
    title: "Money owed to you",
    body: "Split a payment and send each friend a private link. They can agree and report payment without signing up.",
  },
  {
    title: "Refunds still missing",
    body: "Mark a payment as refund-expected and we match incoming credits for you, or tell you nothing has arrived yet.",
  },
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.title}>Know what you actually spent.</h1>
        <p className={styles.lead}>
          Track UPI spending across PhonePe, Google Pay and Paytm. Separate your own expenses from transfers, shared bills and refunds you are still waiting for.
        </p>
        <div className={styles.actions}>
          <ButtonLink href={PAGE_ROUTES.signup}>Create account</ButtonLink>
          <ButtonLink href={PAGE_ROUTES.login} variant="secondary">
            Sign in
          </ButtonLink>
        </div>
        <p className={styles.note}>We never ask for UPI PINs, OTPs or bank passwords. You upload statements yourself.</p>
      </section>
      <section className={styles.features}>
        {FEATURES.map((f) => (
          <article key={f.title} className={styles.feature}>
            <h2 className={styles.featureTitle}>{f.title}</h2>
            <p className={styles.featureBody}>{f.body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
