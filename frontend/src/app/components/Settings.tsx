import { useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { ApiError, sendJson } from "../data/documents";
import { canChooseExportFolder, chooseExportFolder, clearExportFolder, getExportFolder } from "../data/exportFolder";
import { useI18n } from "../data/preferences";
import type { Language } from "../data/preferences";
import type { Account } from "./AccountForm";
import { meetsPasswordRequirements, PasswordField } from "./PasswordField";
import type { AccountContext } from "./RootLayout";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { demoMode } from "../demo/mode";

export function Settings() {
  const { account, onSignedOut, onAccountChanged } = useOutletContext<AccountContext>();
  const { language, t } = useI18n();
  const [choice, setChoice] = useState<Language>(language);
  const [folder, setFolder] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [passwordVersion, setPasswordVersion] = useState(0);

  useEffect(() => {
    if (!canChooseExportFolder) return;
    let active = true;
    getExportFolder(account.email).then((value) => {
      if (active) setFolder(value?.name);
    }).catch(() => {
      if (active) setFeedback("Could not save to the export folder.");
    });
    return () => { active = false; };
  }, [account.email]);

  async function run(action: () => Promise<string | undefined>) {
    setBusy(true);
    setFeedback("");
    try {
      setFeedback(await action() ?? "");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onSignedOut();
      else if (!(error instanceof DOMException && error.name === "AbortError")) {
        setFeedback(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-12 space-y-6">
      <h1 className="text-4xl font-semibold">{t("Settings")}</h1>
      <div className="grid gap-5 md:grid-cols-2 items-start">
        <Card className="bg-white p-6 gap-4">
          <h2 className="text-xl font-semibold">{t("Local account")}</h2>
          <p className="break-all">{account.email}</p>
          <p className="text-sm text-slate-600">{t("Your account, documents, and results are stored on this device.")}</p>
          <label className="space-y-2">
            <span className="block font-medium">{t("Application language")}</span>
            <select className="w-full border rounded-lg px-3 py-2 bg-white"
              value={choice} disabled={busy} onChange={(event) => setChoice(event.target.value as Language)}>
              <option value="en">English</option>
              <option value="pl">Polski</option>
            </select>
          </label>
          <Button className="self-start" variant="outline" disabled={busy} onClick={() => void run(async () => {
            onAccountChanged(await sendJson<Account>("/api/auth/language", "PUT", { language: choice }));
            return "Language saved.";
          })}>{t("Save language")}</Button>
        </Card>
        {!demoMode && <><PasswordChange key={passwordVersion} busy={busy} save={(currentPassword, newPassword) => void run(async () => {
          await sendJson("/api/auth/change-password", "POST", { currentPassword, newPassword });
          setPasswordVersion((previous) => previous + 1);
          return "Password changed.";
        })} />
        <RecoveryCode /></>}
        <Card className="bg-white p-6 gap-4">
          <h2 className="text-xl font-semibold">{t("Export folder")}</h2>
          <p>{folder ?? t("Browser downloads")}</p>
          {canChooseExportFolder ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
                setFolder(await chooseExportFolder(account.email));
                return undefined;
              })}>{t("Choose folder")}</Button>
              {folder && <Button variant="ghost" disabled={busy} onClick={() => void run(async () => {
                await clearExportFolder(account.email);
                setFolder(undefined);
                return undefined;
              })}>{t("Use browser downloads")}</Button>}
            </div>
          ) : (
            <p className="text-sm text-slate-600">{t("Folder selection is unavailable in this browser. Exports use browser downloads.")}</p>
          )}
        </Card>
        {demoMode ? <Card className="bg-white p-6 gap-4">
          <h2 className="text-xl font-semibold">{t("Demo workspace")}</h2>
          <p className="text-sm text-slate-600">{t("Account and password management are available in the full application.")}</p>
          <Button variant="outline" className="self-start" disabled={busy} onClick={() => {
            if (!window.confirm(t("Reset the demo and remove your local changes?"))) return;
            void run(async () => {
              await sendJson("/api/demo/reset", "POST", {});
              sessionStorage.removeItem("documind:last-upload:" + account.email.toLowerCase());
              localStorage.removeItem("documind.demo.language");
              await clearExportFolder(account.email).catch(() => undefined);
              window.location.reload();
              return undefined;
            });
          }}>{t("Reset demo")}</Button>
        </Card> : <Card className="bg-white p-6 gap-4">
          <h2 className="text-xl font-semibold">{t("Access")}</h2>
          <p className="text-sm text-slate-600">{t("Only your account can open your documents.")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
              await sendJson("/api/auth/revoke-other-sessions", "POST", {});
              return "Other sessions will be signed out within a minute.";
            })}>{t("Sign out other sessions")}</Button>
            <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
              await sendJson("/api/auth/logout", "POST", {});
              onSignedOut();
              return undefined;
            })}>{t("Sign out")}</Button>
          </div>
        </Card>}
      </div>
      {feedback && <p role="status" className="rounded-lg border bg-white p-4">{t(feedback)}</p>}
    </div>
  );
}

function RecoveryCode() {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const result = await sendJson<{ code: string }>("/api/auth/recovery-code", "POST", { password });
      setCode(result.code);
      setPassword("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="bg-white p-6 gap-4">
      <h2 className="text-xl font-semibold">{t("Recovery code")}</h2>
      <p className="text-sm text-slate-600">{t("Save a recovery code to reset your password on this device.")}</p>
      {code ? (
        <>
          <code className="break-all rounded bg-slate-100 p-3 select-all">{code}</code>
          <Button variant="outline" className="self-start" onClick={() => setCode("")}>{t("Hide recovery code")}</Button>
        </>
      ) : (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (password) void generate(); }}>
          <PasswordField id="recovery-current-password" label="Current password" value={password}
            onChange={setPassword} autoComplete="current-password" disabled={busy} />
          <Button variant="outline" disabled={busy || !password}>{t("Generate recovery code")}</Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{t(error)}</p>}
    </Card>
  );
}

function PasswordChange({ busy, save }: { busy: boolean; save: (current: string, next: string) => void }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const valid = current.length > 0 && meetsPasswordRequirements(next) && confirm === next;

  return (
    <Card className="bg-white p-6 gap-4">
      <h2 className="text-xl font-semibold">{t("Change password")}</h2>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (valid) save(current, next); }}>
        <PasswordField id="current-password" label="Current password" value={current}
          onChange={setCurrent} autoComplete="current-password" disabled={busy} />
        <PasswordField id="new-password" label="New password" value={next}
          onChange={setNext} autoComplete="new-password" showRequirements disabled={busy} />
        <PasswordField id="confirm-password" label="Confirm new password" value={confirm}
          onChange={setConfirm} autoComplete="new-password" disabled={busy} />
        {confirm && confirm !== next && <p className="text-sm text-red-700">{t("Passwords do not match.")}</p>}
        <Button disabled={busy || !valid}>{t("Change password")}</Button>
      </form>
    </Card>
  );
}
