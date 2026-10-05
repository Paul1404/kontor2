import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type ApplicationPersonCandidates,
  ApplicationPersonLinks,
} from "../../src/components/antrag/person-links";

const candidate = (id: string, name: string) => ({
  id,
  name,
  kind: "member" as const,
  memberNo: `M-${id}`,
  kontaktNo: null,
  mitgliedsnummer: null,
  geburtsdatum: "1990-04-12",
  ort: "Untereuerheim",
  plz: "97508",
  score: 80,
  reasons: ["Name und Geburtsdatum"],
});
const people: ApplicationPersonCandidates[] = [
  {
    key: "primary",
    label: "Antragsteller und Zahler",
    name: "Paula Test",
    candidates: [candidate("payer", "Paula Test"), candidate("partner", "Peter Test")],
  },
  {
    key: "partner",
    label: "Partner",
    name: "Peter Test",
    candidates: [candidate("partner", "Peter Test")],
  },
  { key: "child:0", label: "Kind 1", name: "Klara Test", candidates: [] },
];
function Fixture() {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [disabled, setDisabled] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setDisabled((value) => !value)}>
        Genehmigung läuft
      </button>
      <ApplicationPersonLinks
        people={people}
        personLinks={links}
        disabled={disabled}
        onChange={(key, id) =>
          setLinks((current) => {
            const next = { ...current };
            if (id) next[key] = id;
            else delete next[key];
            return next;
          })
        }
        renderApplicationLink={() => null}
      />
      <output>{JSON.stringify(links)}</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
