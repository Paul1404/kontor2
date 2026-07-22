import { createFileRoute, redirect } from "@tanstack/react-router";
import { LegalSection, PublicLegalLayout } from "~/components/public/PublicLegalLayout";
import { isPublicProductRequest } from "~/lib/current-product-host";

export const Route = createFileRoute("/impressum")({
  beforeLoad: () => {
    if (!isPublicProductRequest()) throw redirect({ to: "/app" });
  },
  head: () => ({
    meta: [
      { title: "Impressum | Kontor2" },
      {
        name: "description",
        content: "Anbieterkennzeichnung und Kontakt für kontor2.com.",
      },
      { property: "og:title", content: "Impressum | Kontor2" },
      { property: "og:url", content: "https://kontor2.com/impressum" },
    ],
    links: [{ rel: "canonical", href: "https://kontor2.com/impressum" }],
  }),
  component: ImpressumPage,
});

function ImpressumPage() {
  return (
    <PublicLegalLayout eyebrow="Rechtliches" title="Impressum">
      <LegalSection title="Angaben gemäß § 5 DDG">
        <address className="not-italic">
          Paul Dresch
          <br />
          Schweinfurter Weg 6
          <br />
          97508 Untereuerheim
          <br />
          Deutschland
        </address>
      </LegalSection>

      <LegalSection title="Kontakt">
        <p>
          Telefon: <a href="tel:+4915203274369">+49 1520 3274369</a>
          <br />
          E-Mail: <a href="mailto:hallo@kontor2.com">hallo@kontor2.com</a>
        </p>
      </LegalSection>

      <LegalSection title="Verantwortlich für den Inhalt">
        <p>Verantwortlich nach § 18 Abs. 2 MStV ist Paul Dresch, Anschrift wie oben.</p>
      </LegalSection>

      <LegalSection title="Verbraucherstreitbeilegung">
        <p>
          Ich bin nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
        </p>
      </LegalSection>
    </PublicLegalLayout>
  );
}
