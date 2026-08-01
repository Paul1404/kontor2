import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Inbox, Loader2, Mail, Save, ShieldAlert, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { orpc } from "~/lib/orpc";

export const Route = createFileRoute("/app/einstellungen/smtp")({
  component: SmtpPage,
});

type Msg = { kind: "ok" | "error" | "info"; text: string };

function SmtpPage() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["smtp"], queryFn: () => orpc.settings.getSmtp() });

  const [form, setForm] = useState({
    host: "",
    port: 587,
    secure: false,
    requireTls: true,
    allowInvalidCerts: false,
    username: "",
    password: "",
    fromAddress: "",
    fromName: "",
  });
  const [testTo, setTestTo] = useState("");
  const [msg, setMsg] = useState<Msg | null>(null);

  useEffect(() => {
    if (cfg.data) {
      setForm({
        host: cfg.data.host,
        port: cfg.data.port,
        secure: cfg.data.secure,
        requireTls: cfg.data.requireTls ?? true,
        allowInvalidCerts: cfg.data.allowInvalidCerts ?? false,
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
        requireTls: form.requireTls,
        allowInvalidCerts: form.allowInvalidCerts,
        username: form.username || null,
        password: form.password || null,
        fromAddress: form.fromAddress,
        fromName: form.fromName || null,
      }),
    onSuccess: () => {
      setMsg({ kind: "ok", text: "Konfiguration gespeichert." });
      qc.invalidateQueries({ queryKey: ["smtp"] });
    },
    onError: (err) => setMsg({ kind: "error", text: (err as Error).message }),
  });

  const test = useMutation({
    mutationFn: () => orpc.settings.sendTestMail({ to: testTo }),
    onSuccess: () => setMsg({ kind: "ok", text: `Test-Mail an ${testTo} versendet.` }),
    onError: (err) => setMsg({ kind: "error", text: (err as Error).message }),
  });

  const imapTest = useMutation({
    mutationFn: () => orpc.settings.testImap(),
    onSuccess: (result) =>
      setMsg({
        kind: "ok",
        text: `IMAP-Zugriff funktioniert. Ordner „${result.mailbox}“ wurde schreibgeschützt geöffnet.`,
      }),
    onError: (err) => setMsg({ kind: "error", text: (err as Error).message }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="E-Mail-Konfiguration"
        description="Gemeinsame Zugangsdaten für SMTP-Versand und schreibgeschützten IMAP-Zugriff."
      />

      {msg ? <MessageBanner msg={msg} onDismiss={() => setMsg(null)} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Mailserver</CardTitle>
          <CardDescription>
            Kontor² verwendet Benutzername und Passwort für SMTP und IMAP.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm sm:col-span-2">
              <Inbox className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="font-medium">Ein Zugang für Versand und Protokollansicht</p>
                <p className="mt-1 text-muted-foreground">
                  SMTP nutzt den eingestellten Port. Für ältere versendete Nachrichten verbindet
                  sich Kontor² automatisch per IMAPS auf demselben Host über Port 993 und öffnet den
                  Ordner „Gesendet“ ausschließlich lesend.
                </p>
              </div>
            </div>
            <Field label="Host" hint="Gemeinsamer Server für SMTP und IMAP">
              <Input
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="smtp.example.de"
                required
              />
            </Field>
            <Field label="Port" hint="587 STARTTLS · 465 SMTPS · 25 unverschlüsselt">
              <Input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                required
              />
            </Field>
            <Field label="Benutzername" hint="Gemeinsamer Login für SMTP und IMAP">
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="postmaster@example.de"
              />
            </Field>
            <Field label="Passwort" hint="Leer lassen, um den aktuellen Wert beizubehalten">
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={cfg.data?.passwordSet ? "•••••••• (vorhanden)" : "Nicht gesetzt"}
              />
            </Field>
            <Field label="Absenderadresse" hint="From-Header der gesendeten Nachrichten">
              <Input
                type="email"
                value={form.fromAddress}
                onChange={(e) => setForm({ ...form, fromAddress: e.target.value })}
                placeholder="info@verein.de"
                required
              />
            </Field>
            <Field label="Absendername" hint="Klartextname vor der Absenderadresse">
              <Input
                value={form.fromName}
                onChange={(e) => setForm({ ...form, fromName: e.target.value })}
                placeholder="TSV Musterstadt"
              />
            </Field>

            <div className="sm:col-span-2">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Transportsicherheit
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Switch
                  id="smtp-secure"
                  label="Implizites TLS (SMTPS)"
                  description="Direkter TLS-Tunnel ab Verbindung (Port 465)."
                  checked={form.secure}
                  onChange={(e) => setForm({ ...form, secure: e.target.checked })}
                />
                <Switch
                  id="smtp-require-tls"
                  label="STARTTLS erzwingen"
                  description="Bei Port 587: TLS vor dem Auth-Handshake verlangen."
                  checked={form.requireTls}
                  onChange={(e) => setForm({ ...form, requireTls: e.target.checked })}
                />
                <Switch
                  id="smtp-allow-invalid"
                  label="Zertifikatsprüfung deaktivieren"
                  description="Erforderlich bei self-signed oder Hostname-Mismatch im MTA-Zertifikat."
                  checked={form.allowInvalidCerts}
                  onChange={(e) => setForm({ ...form, allowInvalidCerts: e.target.checked })}
                />
              </div>
              {form.allowInvalidCerts ? (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span>
                    Die TLS-Zertifikatsprüfung ist abgeschaltet. Verbindung bleibt verschlüsselt,
                    aber der Server wird nicht authentifiziert. Nur in vertrauenswürdigen Netzwerken
                    aktivieren.
                  </span>
                </div>
              ) : null}
            </div>

            <div className="sm:col-span-2 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Speichern
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gesendet-Ordner</CardTitle>
          <CardDescription>
            Prüft die Anmeldung und öffnet den automatisch erkannten Ordner schreibgeschützt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            disabled={imapTest.isPending || !cfg.data?.passwordSet || !cfg.data?.username}
            onClick={() => imapTest.mutate()}
          >
            {imapTest.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Inbox className="size-4" />
            )}
            IMAP-Zugriff testen
          </Button>
          {!cfg.data?.username || !cfg.data?.passwordSet ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Für IMAP müssen Benutzername und Passwort gespeichert sein.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test-Mail</CardTitle>
          <CardDescription>
            Sendet eine Probemail über die gespeicherte Konfiguration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field
              label="Empfänger"
              hint="Adresse, an die die Testmail gehen soll"
              className="sm:flex-1 sm:max-w-sm"
            >
              <Input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="empfang@example.de"
              />
            </Field>
            <Button
              onClick={() => test.mutate()}
              disabled={!testTo || test.isPending}
              variant="outline"
              className="sm:mb-0"
            >
              {test.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mail className="size-4" />
              )}
              Senden
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as `children`, so the label wraps and is implicitly associated.
    <label className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function MessageBanner({ msg, onDismiss }: { msg: Msg; onDismiss: () => void }) {
  const styles =
    msg.kind === "ok"
      ? "border-success/30 bg-success/10 text-foreground"
      : msg.kind === "error"
        ? "border-destructive/30 bg-destructive/10 text-foreground"
        : "border-border bg-muted text-foreground";
  const Icon = msg.kind === "ok" ? CheckCircle2 : msg.kind === "error" ? XCircle : Mail;
  const iconColor =
    msg.kind === "ok"
      ? "text-success"
      : msg.kind === "error"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-4 text-sm shadow-soft ${styles}`}
      role="status"
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${iconColor}`} />
      <span className="flex-1 break-words">{msg.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        schließen
      </button>
    </div>
  );
}
