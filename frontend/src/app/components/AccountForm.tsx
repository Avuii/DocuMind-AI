import { useState } from "react";
import { Brain } from "lucide-react";
import { sendJson } from "../data/documents";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { meetsPasswordRequirements, PasswordField } from "./PasswordField";
import { useI18n } from "../data/preferences";
import type { Language } from "../data/preferences";

export type Account = { email: string; language: Language | null };

export function AccountForm({ onSignedIn }: { onSignedIn: (account: Account) => void }) {
  const { t } = useI18n();
  const [register, setRegister] = useState(false);
  const [reset, setReset] = useState(false);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if ((register || reset) && !meetsPasswordRequirements(password)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (reset) {
        await sendJson("/api/auth/reset-password", "POST", { email: email.trim(), code: code.trim(), newPassword: password });
        setCode("");
        setPassword("");
        setReset(false);
        setNotice("Password reset. Sign in with your new password.");
        return;
      }
      const account = await sendJson<Account>(
        register ? "/api/auth/register" : "/api/auth/login",
        "POST",
        { email: email.trim(), password }
      );
      onSignedIn(account);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-12">
      <Card className="w-full max-w-md bg-white p-7 sm:p-9">
        <div className="flex items-center gap-3 font-semibold text-slate-900">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white">
            <Brain aria-hidden="true" className="size-5" />
          </span>
          DocuMind-AI
        </div>
        <h1 className="text-2xl font-semibold">{t(reset ? "Reset password" : register ? "Create an account" : "Sign in")}</h1>
        {notice && <p role="status" className="text-sm text-emerald-800">{t(notice)}</p>}
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="space-y-2">
            <Label htmlFor="account-email">{t("Email")}</Label>
            <Input id="account-email" type="email" autoComplete="username" required maxLength={254}
              value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
          </div>
          {reset && <label className="block space-y-2 text-sm">
            <span>{t("Recovery code")}</span>
            <Input value={code} onChange={(event) => setCode(event.target.value)} disabled={busy}
              type="password" required maxLength={80} autoComplete="off" />
          </label>}
          <PasswordField key={String(register || reset)} id="account-password" label={reset ? "New password" : "Password"}
            autoComplete={register || reset ? "new-password" : "current-password"}
            showRequirements={register || reset} value={password} onChange={setPassword} disabled={busy} />
          {error && <p role="alert" className="text-sm text-red-700">{t(error)}</p>}
          <Button className="w-full bg-blue-600 hover:bg-blue-700"
            disabled={busy || ((register || reset) && !meetsPasswordRequirements(password))}>
            {t(busy ? "Please wait…" : reset ? "Reset password" : register ? "Create account" : "Sign in")}
          </Button>
        </form>
        <Button variant="ghost" disabled={busy} onClick={() => {
          setRegister(!register && !reset);
          setReset(false);
          setCode("");
          setPassword("");
          setError("");
          setNotice("");
        }}>
          {t(register || reset ? "Back to sign in" : "Create a local account")}
        </Button>
        {!register && !reset && <Button variant="ghost" disabled={busy} onClick={() => {
          setReset(true);
          setPassword("");
          setError("");
          setNotice("");
        }}>{t("Reset password")}</Button>}
      </Card>
    </main>
  );
}
