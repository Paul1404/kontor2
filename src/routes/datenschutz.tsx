import { createFileRoute, redirect } from "@tanstack/react-router";
import { LegalSection, PublicLegalLayout } from "~/components/public/PublicLegalLayout";
import { isPublicProductRequest } from "~/lib/current-product-host";

export const Route = createFileRoute("/datenschutz")({
  beforeLoad: () => {
    if (!isPublicProductRequest()) throw redirect({ to: "/app" });
  },
  head: () => ({
    meta: [
      { title: "Datenschutz | Kontor2" },
      {
        name: "description",
        content: "Datenschutzerklärung für die Produktseite kontor2.com.",
      },
      { property: "og:title", content: "Datenschutz | Kontor2" },
      { property: "og:url", content: "https://kontor2.com/datenschutz" },
    ],
    links: [{ rel: "canonical", href: "https://kontor2.com/datenschutz" }],
  }),
  component: DatenschutzPage,
});

function DatenschutzPage() {
  return (
    <PublicLegalLayout
      eyebrow="Stand: 22. Juli 2026"
      title="Datenschutzerklärung"
      intro={
        <p>
          Diese Erklärung gilt für die öffentliche Produktseite kontor2.com. Für die
          Vereinsverwaltung auf einer Vereins-Subdomain ist grundsätzlich der jeweilige Verein
          verantwortlich.
        </p>
      }
    >
      <LegalSection title="1. Verantwortlicher">
        <address className="not-italic">
          Paul Dresch
          <br />
          Schweinfurter Weg 6
          <br />
          97508 Untereuerheim
          <br />
          E-Mail: <a href="mailto:hallo@kontor2.com">hallo@kontor2.com</a>
        </address>
      </LegalSection>

      <LegalSection title="2. Aufruf der Produktseite und Hosting">
        <p>
          Beim Aufruf der Website verarbeitet die Hosting-Infrastruktur technisch erforderliche
          Verbindungsdaten. Dazu können IP-Adresse, Zeitpunkt, aufgerufene Adresse, übertragene
          Datenmenge, Browser, Betriebssystem, Referrer sowie Status- und Fehlerangaben gehören. Die
          Verarbeitung dient der sicheren Auslieferung, Fehleranalyse und Abwehr von Missbrauch.
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.
        </p>
        <p>
          Kontor2 wird bei Railway Corporation, 548 Market St PMB 68956, San Francisco, CA 94104,
          USA, betrieben. Anwendung, Datenbank, Zwischenspeicher und Dateispeicher sind derzeit in
          der Railway-Region EU West in Amsterdam bereitgestellt. Railway verarbeitet Daten als
          Auftragsverarbeiter. Für mögliche Übermittlungen in die USA sieht die Vereinbarung mit
          Railway geeignete Garantien einschließlich EU-Standardvertragsklauseln vor.
        </p>
        <p>
          Protokolldaten werden gelöscht, sobald sie für Betrieb und Sicherheit nicht mehr
          erforderlich sind. Bei einem konkreten Sicherheitsvorfall können betroffene Einträge bis
          zur abschließenden Klärung aufbewahrt werden.
        </p>
      </LegalSection>

      <LegalSection title="3. Keine Reichweitenmessung und keine externen Schriften">
        <p>
          Auf der Produktseite werden keine Analyse-, Werbe- oder Trackingdienste eingesetzt. Die
          verwendeten Schriften und Bilder werden direkt von Kontor2 ausgeliefert. Beim bloßen
          Seitenaufruf wird deshalb keine Verbindung zu Google Fonts oder einem vergleichbaren
          Mediendienst hergestellt.
        </p>
      </LegalSection>

      <LegalSection title="4. Lokale Einstellungen und Cookies">
        <p>
          Die Produktseite setzt keine Analyse- oder Werbe-Cookies. Kontor2 kann eine bereits auf
          diesem Gerät gewählte Darstellungsoption, etwa den Hell- oder Dunkelmodus, aus dem lokalen
          Browserspeicher lesen. Diese Information bleibt auf dem Gerät und wird nicht an uns
          übertragen.
        </p>
        <p>
          Auf Vereins-Subdomains werden technisch erforderliche Sitzungscookies für Anmeldung,
          Zugriffsschutz und Mitgliederportal eingesetzt. Sie dienen ausschließlich der vom Nutzer
          angeforderten Funktion und werden nicht für Werbung oder seitenübergreifendes Tracking
          verwendet.
        </p>
      </LegalSection>

      <LegalSection title="5. Kontaktaufnahme">
        <p>
          Wenn Sie per E-Mail Kontakt aufnehmen, verarbeiten wir Ihre Kontaktdaten, den Inhalt der
          Nachricht und die zur Bearbeitung erforderlichen Begleitinformationen. Zweck ist die
          Beantwortung Ihrer Anfrage und gegebenenfalls die Vorbereitung einer Pilotvereinbarung.
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO bei vorvertraglicher Kommunikation, sonst
          Art. 6 Abs. 1 lit. f DSGVO.
        </p>
        <p>
          Die Nachricht wird gelöscht, wenn die Anfrage abschließend geklärt ist und keine
          gesetzlichen Aufbewahrungspflichten oder berechtigten Dokumentationsinteressen
          entgegenstehen.
        </p>
      </LegalSection>

      <LegalSection title="6. Vereinsinstanzen">
        <p>
          Jeder Verein erhält einen getrennten Bereich mit eigener Datenhaltung. Der jeweilige
          Verein entscheidet über Zwecke, Umfang und Dauer der Verarbeitung seiner Mitglieder-,
          Benutzer- und Finanzdaten. Betroffene wenden sich deshalb zuerst an den Verein. Dessen
          Datenschutzerklärung wird in der Vereinsinstanz verlinkt. Kontor2 verarbeitet die Daten im
          Rahmen des technischen Betriebs nach den Weisungen des Vereins.
        </p>
        <p>
          Für die Adressvervollständigung werden Postleitzahl und eingegebene Straßenfragmente
          serverseitig an OpenPLZ übermittelt. Falls dort kein Ergebnis vorliegt, kann Nominatim von
          OpenStreetMap als Ersatzdienst abgefragt werden. E-Mails aus einer Vereinsinstanz werden
          über den vom Verein eingerichteten Mailserver versendet. Für diese Verarbeitungen gelten
          ergänzend die Hinweise des jeweiligen Vereins.
        </p>
      </LegalSection>

      <LegalSection title="7. Empfänger und Drittlandübermittlungen">
        <p>
          Empfänger personenbezogener Daten sind nur die für Betrieb und Kommunikation notwendigen
          Dienstleister sowie der jeweils verantwortliche Verein. Eine Weitergabe zu Werbezwecken
          findet nicht statt. Soweit ein Dienstleister Daten außerhalb des Europäischen
          Wirtschaftsraums verarbeitet, erfolgt dies nur auf Grundlage einer anerkannten
          Übermittlungsgrundlage oder geeigneter Garantien nach Art. 44 ff. DSGVO.
        </p>
      </LegalSection>

      <LegalSection title="8. Rechte betroffener Personen">
        <p>
          Sie haben nach Maßgabe der gesetzlichen Voraussetzungen das Recht auf Auskunft,
          Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und
          Widerspruch. Eine erteilte Einwilligung können Sie jederzeit mit Wirkung für die Zukunft
          widerrufen.
        </p>
        <p>
          Außerdem können Sie sich bei einer Datenschutzaufsichtsbehörde beschweren. Für den hier
          Verantwortlichen ist regelmäßig das Bayerische Landesamt für Datenschutzaufsicht,
          Promenade 18, 91522 Ansbach, zuständig.
        </p>
      </LegalSection>

      <LegalSection title="9. Externe Links">
        <p>
          Beim Anklicken eines externen Links verlassen Sie Kontor2. Für die Verarbeitung auf der
          Zielseite ist deren Anbieter verantwortlich.
        </p>
      </LegalSection>
    </PublicLegalLayout>
  );
}
