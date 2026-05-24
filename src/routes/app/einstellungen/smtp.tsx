import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/einstellungen/smtp")({
  component: SmtpPage,
});

function SmtpPage() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["smtp"], queryFn: () => orpc.settings.getSmtp() });

  const [form, setForm] = useState({
    host: "",
    port: 587,
    secure: true,
    username: "",
    password: "",
    fromAddress: "",
    fromName: "",
  });
  const [testTo, setTestTo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (cfg.data) {
      setForm({
        host: cfg.data.host,
        port: cfg.data.port,
        secure: cfg.data.secure,
        username: cfg.data.username ?? "",
        password: "",
        fromAddress: cfg.data.fromAddress,
        fromName: cfg.data.fromName ?? "",
      });
    }
  }, [cfg.data]);

  const save = useMutation({
    mutationFn: () =>
      orpc.settings.updateSmtp({
        host: form.host,
        port: form.port,
        secure: form.secure,
        username: form.username || null,
        password: form.password || null,
        fromAddress: form.fromAddress,
        fromName: form.fromName || null,
      }),
    onSuccess: () => {
      setMsg("Gespeichert.");
      qc.invalidateQueries({ queryKey: ["smtp"] });
    },
    onError: (err) => setMsg(`Fehler: ${(err as Error).message}`),
  });

  const test = useMutation({
    mutationFn: () => orpc.settings.sendTestMail({ to: testTo }),
    onSuccess: () => setMsg(`Test-Mail an ${testTo} versendet.`),
    onError: (err) => setMsg(`Fehler: ${(err as Error).message}`),
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">SMTP-Konfiguration</h1>
      <Card>
        <CardHeader>
          <CardTitle>MTA Zugangsdaten</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Labeled label="Host">
              <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
            </Labeled>
            <Labeled label="Port">
              <Input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                required
              />
            </Labeled>
            <Labeled label="Benutzername">
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Labeled>
            <Labeled label="Passwort (leer lassen für unverändert)">
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={cfg.data?.passwordSet ? "Vorhanden" : "Nicht gesetzt"}
              />
            </Labeled>
            <Labeled label="Absenderadresse">
              <Input
                type="email"
                value={form.fromAddress}
                onChange={(e) => setForm({ ...form, fromAddress: e.target.value })}
                required
              />
            </Labeled>
            <Labeled label="Absendername">
              <Input value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} />
            </Labeled>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.secure}
                onChange={(e) => setForm({ ...form, secure: e.target.checked })}
              />
              TLS (SSL/STARTTLS)
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={save.isPending}>
                <Save className="size-4" /> Speichern
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test-Mail versenden</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Labeled label="Empfänger">
            <Input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              className="w-72"
            />
          </Labeled>
          <Button onClick={() => test.mutate()} disabled={!testTo || test.isPending}>
            <Mail className="size-4" /> Senden
          </Button>
          {msg ? <span className="text-sm text-muted-foreground">{msg}</span> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
