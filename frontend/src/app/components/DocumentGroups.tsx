import { useState } from "react";
import { Check, Folder, Pencil, Plus } from "lucide-react";
import { groupColor, groupStyle, groupsUrl, sendJson } from "../data/documents";
import type { DocumentGroup } from "../data/documents";
import { useI18n } from "../data/preferences";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";

const palette = [
  "#64748b", "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#f43f5e",
];

export function DocumentGroups({ groups, selected, select, saved }: {
  groups: DocumentGroup[];
  selected: string;
  select: (id: string) => void;
  saved: (group: DocumentGroup) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function start(group?: DocumentGroup) {
    setEditing(group?.id ?? "");
    setName(group?.name ?? "");
    setColor(groupColor(group?.color ?? "blue"));
    setError("");
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const group = await sendJson<DocumentGroup>(groupsUrl + (editing ? "/" + editing : ""),
        editing ? "PUT" : "POST", { name, color });
      saved(group);
      setEditing(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 bg-white gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2"><Folder className="size-4" />{t("Groups")}</h2>
        <Button variant="outline" size="sm" onClick={() => start()} disabled={busy}>
          <Plus aria-hidden="true" />{t("Create group")}
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
        <Button variant={selected ? "outline" : "secondary"} className="min-h-16 justify-start"
          aria-pressed={!selected} onClick={() => select("")}>{t("All groups")}</Button>
        {groups.map((group) => (
          <div key={group.id} style={groupStyle(group.color)}
            className={"flex min-h-16 min-w-0 items-center rounded-lg border " + (selected === group.id ? "ring-2 ring-slate-700 ring-offset-2" : "")}>
            <Button variant="ghost" className="h-full min-w-0 flex-1 justify-start hover:bg-white/30"
              aria-pressed={selected === group.id} onClick={() => select(group.id)}>
              <Folder aria-hidden="true" style={{ color: groupColor(group.color) }} />
              <span className="truncate">{group.name}</span>
            </Button>
            <Button size="icon" variant="ghost" aria-label={t("Edit group") + " " + group.name}
              onClick={() => start(group)} disabled={busy}><Pencil aria-hidden="true" /></Button>
          </div>
        ))}
      </div>
      {editing !== undefined && (
        <form className="space-y-3 rounded-lg border p-3" style={groupStyle(color)}
          onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <Input className="max-w-xs" aria-label={t("Group name")} placeholder={t("Group name")}
            value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required disabled={busy} />
          <fieldset className="space-y-2" disabled={busy}>
            <legend className="font-medium text-sm">{t("Group color")}</legend>
            <div className="flex flex-wrap gap-2">
              {palette.map((sample) => (
                <button key={sample} type="button" aria-label={sample.toUpperCase()} aria-pressed={color === sample}
                  style={{ backgroundColor: sample }}
                  className="grid size-8 place-items-center rounded-full border border-black/15 text-white
                    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800"
                  onClick={() => setColor(sample)}>
                  {color === sample && <Check aria-hidden="true" className="size-4 drop-shadow-sm" />}
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="color" className="h-8 w-10 cursor-pointer rounded border bg-white p-0.5"
                value={color} onInput={(event) => setColor(event.currentTarget.value)} />
              {t("Custom color")}
              <span className="font-mono text-slate-700">{color.toUpperCase()}</span>
            </label>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !name.trim()}>{t("Save")}</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(undefined)}>{t("Cancel")}</Button>
          </div>
          {error && <p role="alert" className="w-full text-red-700">{t(error)}</p>}
        </form>
      )}
    </Card>
  );
}
