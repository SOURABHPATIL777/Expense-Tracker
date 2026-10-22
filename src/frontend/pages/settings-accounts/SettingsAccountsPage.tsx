"use client";

import { CrudPage } from "@/frontend/components/CrudPage/CrudPage";
import type { Column } from "@/frontend/components/DataTable/DataTable";
import { FormField } from "@/frontend/components/Form/FormField";
import { Badge } from "@/frontend/components/StatusBadge/StatusBadge";
import { optionsFrom } from "@/frontend/components/Select/Select";
import { useCrud } from "@/frontend/hooks/useCrud";
import { API_ROUTES } from "@/shared/constants/routes";
import { SOURCE_APPS, SOURCE_KINDS } from "@/shared/constants/enums";
import { SOURCE_APP_LABELS } from "@/shared/constants/labels";
import { accountFormSchema, type AccountDto, type AccountInput } from "@/shared/schemas/accounts";
import styles from "./SettingsAccountsPage.module.css";

const SOURCE_KIND_OPTIONS = [
  { value: SOURCE_KINDS[0], label: "UPI app" },
  { value: SOURCE_KINDS[1], label: "Bank account" },
];

const columns: Column<AccountDto>[] = [
  {
    key: "label",
    header: "Account",
    render: (a) => (
      <div className={styles.name}>
        <strong>{a.label}</strong>
        <span className={styles.muted}>
          {SOURCE_APP_LABELS[a.sourceApp]}
          {a.maskedNumber && ` · ••${a.maskedNumber}`}
        </span>
      </div>
    ),
  },
  {
    key: "upi",
    header: "Your UPI IDs",
    hideOnMobile: true,
    render: (a) => (a.upiIds.length ? <span className={styles.vpas}>{a.upiIds.join(", ")}</span> : <span className={styles.muted}>None added</span>),
  },
  { key: "primary", header: "", render: (a) => a.isPrimary && <Badge tone="info">Primary</Badge> },
];

export default function SettingsAccountsPage() {
  const crud = useCrud<AccountDto, AccountInput>({ collectionUrl: API_ROUTES.accounts, itemUrl: API_ROUTES.account, noun: "Account" });
  return (
    <CrudPage
      crud={crud}
      title="Accounts & UPI IDs"
      description="Add the UPI IDs and accounts that belong to you. Payments between them are counted as your own transfers, not spending."
      addLabel="Add account"
      columns={columns}
      empty={{ title: "No accounts yet", description: "Add your bank accounts and UPI IDs so transfers between them aren't counted as spending." }}
      formSchema={accountFormSchema}
      renderFields={(e) => (
        <>
          <FormField name="label" label="Name" placeholder="e.g. HDFC Salary, PhonePe" defaultValue={e?.label} required />
          <FormField name="sourceKind" label="Type" type="select" options={SOURCE_KIND_OPTIONS} defaultValue={e?.sourceKind ?? "bank"} />
          <FormField name="sourceApp" label="Bank or app" type="select" options={optionsFrom(SOURCE_APPS, SOURCE_APP_LABELS)} defaultValue={e?.sourceApp} />
          <FormField name="maskedNumber" label="Last 4 digits (optional)" inputMode="numeric" defaultValue={e?.maskedNumber ?? ""} hint="Never enter your full account number." />
          <FormField name="upiIds" label="Your UPI IDs" type="textarea" placeholder="name@okhdfcbank, 98xxxxxx10@ybl" defaultValue={e?.upiIds.join(", ")} hint="Comma separated." />
          <FormField name="isPrimary" label="Primary account" type="checkbox" defaultChecked={e?.isPrimary} />
        </>
      )}
      deleteTitle={(a) => `Delete “${a.label}”?`}
      deleteMessage="Transactions stay, but they will no longer be linked to this account and its UPI IDs won't be used for transfer detection."
    />
  );
}
