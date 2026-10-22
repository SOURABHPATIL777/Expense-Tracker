"use client";

import { useState } from "react";
import { Form } from "@/frontend/components/Form/Form";
import { FormField } from "@/frontend/components/Form/FormField";
import { Alert } from "@/frontend/components/Alert/Alert";
import { api } from "@/frontend/lib/apiClient";
import { API_ROUTES } from "@/shared/constants/routes";
import { resendSchema, type ResendInput } from "@/shared/schemas/auth";
import styles from "./ResendConfirmation.module.css";

/** "Send a new confirmation link" for links that expired or were already used. */
export function ResendConfirmation({ email }: { email?: string }) {
  const [sentTo, setSentTo] = useState<string>();

  async function submit(values: ResendInput) {
    await api.post(API_ROUTES.auth.resend, values);
    setSentTo(values.email);
  }

  if (sentTo) {
    return (
      <Alert tone="success" title="New link sent">
        If {sentTo} has an account waiting for confirmation, a fresh link is on its way. It works on any device; open it once.
      </Alert>
    );
  }
  return (
    <div className={styles.wrap}>
      <Form schema={resendSchema} onSubmit={submit} submitLabel="Send a new link">
        <FormField name="email" label="Email" type="email" autoComplete="email" defaultValue={email} required />
      </Form>
    </div>
  );
}
