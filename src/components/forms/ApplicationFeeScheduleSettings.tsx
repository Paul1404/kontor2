import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { toast } from "~/components/ui/toaster";
import type { ApplicationFeeSchedule } from "~/lib/application-fee-schedule";
import { formatCurrency } from "~/lib/format";
import { orpc } from "~/lib/orpc";

const fields = [
  ["familie", "familie", "Familie"],
  ["kind", "kind", "Kinder ohne Eltern"],
  ["kindElternMitglied", "kind_eltern_mitglied", "Kinder mit Eltern"],
  ["jugendlich", "jugendlich", "Jugendliche ohne Eltern"],
  ["jugendlichElternMitglied", "jugendlich_eltern_mitglied", "Jugendliche mit Eltern"],
  ["jungerErwachsener", "junger_erwachsener", "Junge Erwachsene"],
  ["erwachsener", "erwachsener", "Erwachsene"],
] as const;
export function ApplicationFeeScheduleSettings() {
  const client = useQueryClient();
  const cfg = useQuery({
    queryKey: ["organization", "feeSchedule"],
    queryFn: () => orpc.organization.get(),
  });
  const tariffs = useQuery({ queryKey: ["feeTypes", "list"], queryFn: () => orpc.feeTypes.list() });
  const [schedule, setSchedule] = useState<ApplicationFeeSchedule | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty && cfg.data) setSchedule(cfg.data.applicationFeeSchedule);
  }, [cfg.data, dirty]);
  const save = useMutation({
    mutationFn: (value: ApplicationFeeSchedule | null) =>
      orpc.organization.scheduleApplicationFees({ schedule: value }),
    onSuccess: async () => {
      setDirty(false);
      await client.invalidateQueries({ queryKey: ["organization"] });
      toast.success("Beitragswechsel gespeichert.");
    },
    onError: (e) => toast.error(e.message),
  });
  const change = (next: ApplicationFeeSchedule) => {
    setSchedule(next);
    setDirty(true);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Beitragswechsel im Online-Antrag</CardTitle>
        <CardDescription>
          Beiträge und Altersgrenzen gelten ab dem gewählten Datum nach Europe/Berlin. Eingereichte
          Anträge behalten ihren gespeicherten Betrag.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {schedule ? (
          <div className="space-y-4">
            <label htmlFor="schedule-effective" className="block text-sm">
              Gültig ab
              <Input
                id="schedule-effective"
                type="date"
                value={schedule.effectiveFrom}
                onChange={(e) => change({ ...schedule, effectiveFrom: e.target.value })}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["kindMax", "Kinder unter"],
                  ["jugendlichMax", "Jugendliche unter"],
                  ["jungerErwachsenerMax", "Junge Erwachsene unter"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} htmlFor={`schedule-age-${key}`} className="text-sm">
                  {label}
                  <Input
                    id={`schedule-age-${key}`}
                    type="number"
                    min={1}
                    max={120}
                    value={schedule.altersgrenzen[key]}
                    onChange={(e) =>
                      change({
                        ...schedule,
                        altersgrenzen: { ...schedule.altersgrenzen, [key]: Number(e.target.value) },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="space-y-3">
              {fields.map(([key, role, label]) => (
                <div key={key} className="grid gap-2 sm:grid-cols-2">
                  <label htmlFor={`schedule-money-${key}`} className="text-sm">
                    {label} (Jahresbeitrag in €)
                    <Input
                      id={`schedule-money-${key}`}
                      inputMode="decimal"
                      value={schedule.staffel[key]}
                      onChange={(e) =>
                        change({
                          ...schedule,
                          staffel: { ...schedule.staffel, [key]: e.target.value.replace(",", ".") },
                        })
                      }
                    />
                  </label>
                  <label className="text-sm">
                    Beitragsart für {label}
                    <select
                      className="mt-1 block w-full rounded-md border border-input bg-background p-2"
                      value={schedule.feeTypes?.[role] ?? ""}
                      onChange={(e) => {
                        const feeTypes = { ...schedule.feeTypes };
                        const art = Number(e.target.value);
                        if (art) feeTypes[role] = art;
                        else delete feeTypes[role];
                        change({ ...schedule, feeTypes });
                      }}
                    >
                      <option value="">Beitragsstaffel verwenden</option>
                      {tariffs.data
                        ?.filter((t) => t.nichAktiv !== "J")
                        .map((t) => (
                          <option key={t.art} value={t.art}>
                            {t.bezeichnung} ({formatCurrency(t.betrag1)})
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Bei einer zugeordneten Beitragsart gilt deren Betrag. Ohne Zuordnung gilt die geplante
              Beitragsstaffel.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={save.isPending || !dirty}
                onClick={() => save.mutate(schedule)}
              >
                Beitragswechsel speichern
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={() => save.mutate(null)}
              >
                Beitragswechsel entfernen
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            disabled={!cfg.data || save.isPending}
            onClick={() => {
              if (cfg.data?.beitragsstaffel)
                change({
                  effectiveFrom: "",
                  staffel: cfg.data.beitragsstaffel,
                  altersgrenzen: {
                    kindMax: cfg.data.kategorieKindMaxAlter,
                    jugendlichMax: cfg.data.kategorieJugendlichMaxAlter,
                    jungerErwachsenerMax: cfg.data.kategorieJungerErwachsenerMaxAlter,
                  },
                });
            }}
          >
            Beitragswechsel planen
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
