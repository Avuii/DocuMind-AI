import { useState } from "react";
import { sendJson } from "../data/documents";
import { useI18n } from "../data/preferences";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Party = "seller" | "buyer";
type Kind = "nip" | "regon" | "krs" | "vat";
type Company = Partial<Record<"name" | "address" | "nip" | "regon" | "krs" | "vatId", string | null>>;
type Result = {
  source: "VAT" | "KRS" | "GUS" | "CEIDG" | "VIES";
  outcome: "found" | "notFound" | "notConfigured" | "notApplicable" | "ambiguous" | "unavailable";
  company: Company | null;
  status: string | null;
  date: string | null;
  reference: string | null;
};

const sources = { VAT: "VAT White List", KRS: "KRS", GUS: "GUS REGON", CEIDG: "CEIDG", VIES: "VIES" };
const outcomes = {
  found: "Found in registry", notFound: "Not found in registry", notConfigured: "API key required",
  notApplicable: "No matching identifier to query", ambiguous: "Multiple or conflicting matches",
  unavailable: "Registry unavailable",
};
const companyFields = [
  ["name", "Company name"], ["address", "Registered address"], ["nip", "NIP"],
  ["regon", "REGON"], ["krs", "KRS"], ["vatId", "EU VAT number"],
] as const;

function formKey(party: Party, key: keyof Company) {
  if (key === "name") return party === "seller" ? "vendor_name" : "buyer_name";
  return party + "_" + (key === "vatId" ? "vat_id" : key);
}

export function RegistryLookup({ values, apply, disabled }: {
  values: Readonly<Partial<Record<string, string>>>;
  apply: (updates: Record<string, string>) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [party, setParty] = useState<Party>("seller");
  const [kind, setKind] = useState<Kind>("nip");
  const [input, setInput] = useState<string>();
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const number = input ?? values[formKey(party, kind === "vat" ? "vatId" : kind)] ?? "";
  const locked = busy || disabled;

  function clear() {
    setResults([]);
    setMessage("");
  }

  async function check() {
    setBusy(true);
    clear();
    try {
      setResults(await sendJson<Result[]>("/api/registries/lookup", "POST", { kind, number: number.trim() }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer font-medium">{t("Check company in registries")}</summary>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (!locked && number.trim()) void check();
      }}>
        <label className="flex flex-col gap-1 text-sm">
          {t("Company")}
          <select className="h-9 rounded-md border bg-white px-2" value={party} disabled={locked}
            onChange={(event) => { setParty(event.target.value as Party); setInput(undefined); clear(); }}>
            <option value="seller">{t("Seller")}</option>
            <option value="buyer">{t("Buyer")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("Identifier type")}
          <select className="h-9 rounded-md border bg-white px-2" value={kind} disabled={locked}
            onChange={(event) => { setKind(event.target.value as Kind); setInput(undefined); clear(); }}>
            <option value="nip">NIP</option>
            <option value="regon">REGON</option>
            <option value="krs">KRS</option>
            <option value="vat">{t("EU VAT number")}</option>
          </select>
        </label>
        <label className="flex min-w-32 flex-1 flex-col gap-1 text-sm">
          {t("Identifier")}
          <Input value={number} maxLength={40} disabled={locked} placeholder={kind === "vat" ? "DE123456789" : undefined}
            onChange={(event) => { setInput(event.target.value); clear(); }} />
        </label>
        <Button disabled={locked || !number.trim()}>{t(busy ? "Checking registries…" : "Check registries")}</Button>
      </form>
      {message && <p className="mt-3 text-sm" role="status">{t(message)}</p>}
      {results.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {results.map((result) => {
            const proposed = companyFields.flatMap(([key, label]) => {
              const value = result.company?.[key];
              return value ? [{ key: formKey(party, key), label, value }] : [];
            });
            const changes = proposed.filter(({ key, value }) => values[key]?.trim() !== value);
            return (
              <li key={result.source} className="space-y-2 rounded-lg border bg-white p-3 text-sm">
                <p><strong>{t(sources[result.source])}</strong> · {t(outcomes[result.outcome])}
                  {result.status && " · " + t(result.status)}{result.date && " · " + result.date}</p>
                {result.reference && <p>{t("Registry reference")} · {result.reference}</p>}
                {proposed.length > 0 && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    {proposed.map(({ key, label, value }) => (
                      <div key={key} className="contents">
                        <dt className="text-slate-600">{t(label)}</dt>
                        <dd className="break-words whitespace-pre-line">
                          {values[key]?.trim() && values[key]?.trim() !== value && (
                            <span className="block text-xs text-slate-600">{t("Current value")} · {values[key]}</span>
                          )}
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {changes.length > 0 && <Button type="button" variant="outline" size="sm" disabled={locked}
                  onClick={() => {
                    apply(Object.fromEntries(changes.map(({ key, value }) => [key, value])));
                    setMessage("Registry data copied to the form.");
                  }}>{t("Use registry data")}</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
