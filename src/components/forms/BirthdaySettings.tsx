import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { toast } from "~/components/ui/toaster";
import { orpc } from "~/lib/orpc";
export function BirthdaySettings() {
  const query = useQuery({
    queryKey: ["birthdayReminder.get"],
    queryFn: () => orpc.birthdayReminder.get(),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Geburtstagserinnerung</CardTitle>
      </CardHeader>
      <CardContent>
        {query.data ? (
          <BirthdaySettingsForm data={query.data} />
        ) : (
          <p>{query.error?.message ?? "Wird geladen…"}</p>
        )}
      </CardContent>
    </Card>
  );
}
function BirthdaySettingsForm({
  data,
}: {
  data: Awaited<ReturnType<typeof orpc.birthdayReminder.get>>;
}) {
  const [enabled, setEnabled] = useState(data.settings.enabled);
  const [time, setTime] = useState(data.settings.time);
  const [ids, setIds] = useState<string[]>(data.settings.userIds);
  const [emails, setEmails] = useState(data.settings.emails.join("\n"));
  const save = useMutation({
    mutationFn: () =>
      orpc.birthdayReminder.save({
        enabled,
        time,
        userIds: ids,
        emails: emails
          .split(/[\n;,]/)
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => toast.success("Geburtstagserinnerung gespeichert"),
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => orpc.birthdayReminder.test(),
    onSuccess: (r) =>
      toast.success(
        r.sent
          ? "Test an Ihre E-Mail-Adresse gesendet"
          : "Test wurde übersprungen. Bitte Versandprotokoll prüfen.",
      ),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Montags für die Geburtstage von Montag bis Sonntag. Zeitzone: Europe/Berlin. Jeder Empfänger
        erhält eine eigene Nachricht.
      </p>
      <label>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{" "}
        Aktivieren
      </label>
      <label htmlFor="birthday-time">
        Uhrzeit
        <Input
          id="birthday-time"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </label>
      <fieldset>
        <legend>Benutzer als Empfänger</legend>
        {data.users.map((u) => (
          <label className="block text-sm" key={u.id}>
            <input
              type="checkbox"
              checked={ids.includes(u.id)}
              onChange={(e) =>
                setIds(e.target.checked ? [...ids, u.id] : ids.filter((id) => id !== u.id))
              }
            />{" "}
            {u.name} ({u.email})
          </label>
        ))}
      </fieldset>
      <label>
        Weitere E-Mail-Adressen
        <textarea
          className="block w-full rounded border p-2"
          aria-label="Weitere E-Mail-Adressen"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          placeholder="Eine Adresse pro Zeile"
        />
      </label>
      <div className="flex gap-2">
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          Speichern
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => test.mutate()}
          disabled={test.isPending}
        >
          Test an mich senden
        </Button>
      </div>
    </div>
  );
}
