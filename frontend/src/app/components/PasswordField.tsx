import { useState } from "react";
import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useI18n } from "../data/preferences";

const requirements = [
  { label: "At least 12 characters", test: (value: string) => value.length >= 12 },
  { label: "An uppercase letter (A–Z)", test: (value: string) => /[A-Z]/.test(value) },
  { label: "A lowercase letter (a–z)", test: (value: string) => /[a-z]/.test(value) },
  { label: "A number (0–9)", test: (value: string) => /[0-9]/.test(value) },
  { label: "A special character (e.g. ! or #)", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

export const meetsPasswordRequirements = (value: string) =>
  requirements.every(({ test }) => test(value));

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  disabled?: boolean;
  showRequirements?: boolean;
}

export function PasswordField({
  id, label, value, onChange, autoComplete, disabled, showRequirements,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();
  const checklistId = id + "-requirements";

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t(label)}</Label>
      <div className="relative">
        <Input id={id} type={visible ? "text" : "password"} autoComplete={autoComplete}
          className="pr-12" required maxLength={256} value={value} disabled={disabled}
          autoCapitalize="none" spellCheck={false}
          aria-describedby={showRequirements ? checklistId : undefined}
          onChange={(event) => onChange(event.target.value)} />
        <Button type="button" variant="ghost" size="icon"
          className="absolute inset-y-0 right-0 text-slate-600"
          aria-controls={id} aria-label={t((visible ? "Hide " : "Show ") + label.toLowerCase())}
          onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
      {showRequirements && (
        <ul id={checklistId} className="space-y-1 text-sm">
          {requirements.map(({ label, test }) => {
            const met = test(value);
            const Icon = met ? Check : Circle;
            return (
              <li key={label} className={"flex items-center gap-2 " + (met ? "text-emerald-700" : "text-slate-600")}>
                <Icon className="size-4" aria-hidden="true" />
                <span className="sr-only">{t(met ? "Met. " : "Required. ")}</span>
                {t(label)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
