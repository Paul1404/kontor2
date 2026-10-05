import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { orEmpty } from "~/lib/format";
import type { DuplicateCandidate } from "~/server/domain/member/duplicate-detection";

export type ApplicationPersonCandidates = {
  key: string;
  label: string;
  name: string;
  candidates: DuplicateCandidate[];
};

export function ApplicationPersonLinks({
  people,
  personLinks,
  disabled,
  onChange,
  renderApplicationLink,
}: {
  people: ApplicationPersonCandidates[];
  personLinks: Record<string, string>;
  disabled: boolean;
  onChange: (key: string, memberId: string | null) => void;
  renderApplicationLink: (id: string) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Prüfe jede Person einzeln. Verknüpfte Datensätze werden weiterverwendet. Ohne Verknüpfung
        wird die jeweilige Person neu angelegt.
      </p>
      {people.map((person) => (
        <div key={person.key} className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm font-medium">
            {person.label}: {person.name}
          </p>
          {person.candidates.length > 0 ? (
            <p className="flex items-center gap-2 text-xs font-medium text-amber-800 dark:text-amber-300">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Mögliche Dubletten gefunden ({person.candidates.length})
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {personLinks[person.key] ? "Bestehenden Datensatz verwenden" : "Neu anlegen"}
            {!person.candidates.length ? ". Keine möglichen Dubletten gefunden." : ""}
          </p>
          {person.candidates.map((c) => {
            const selected = personLinks[person.key] === c.id && c.kind === "member";
            const usedElsewhere = Object.entries(personLinks).some(
              ([key, memberId]) => key !== person.key && memberId === c.id,
            );
            return (
              <div
                key={`${c.kind}-${c.id}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card px-2 py-1.5 text-sm"
              >
                <Badge variant={c.kind === "member" ? "secondary" : "outline"}>
                  {c.kind === "member"
                    ? (c.memberNo ?? c.kontaktNo ?? c.mitgliedsnummer ?? "Mitglied")
                    : "Antrag"}
                </Badge>
                <span className="font-medium">{orEmpty(c.name)}</span>
                <span className="text-xs text-muted-foreground">
                  {orEmpty([c.geburtsdatum, c.ort].filter(Boolean).join(" · "))}
                </span>
                <span className="text-xs text-muted-foreground">{c.reasons.join(", ")}</span>
                {c.kind === "member" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={selected ? "default" : "outline"}
                    className="ml-auto"
                    disabled={usedElsewhere || disabled}
                    aria-label={`${selected ? "Verknüpfung lösen" : "Verknüpfen"}: ${person.label}, ${person.name}, ${c.name}`}
                    onClick={() => onChange(person.key, selected ? null : c.id)}
                  >
                    {usedElsewhere
                      ? "Bereits zugeordnet"
                      : selected
                        ? "Verknüpfung lösen"
                        : "Verknüpfen"}
                  </Button>
                ) : (
                  renderApplicationLink(c.id)
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
