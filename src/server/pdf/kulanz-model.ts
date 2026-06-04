/**
 * Pure builder for the Kulanz letter: a Zahlungserinnerung that also offers a
 * Sonderkündigung out of goodwill. The member can either pay the open amount or
 * return the attached Kündigungsbestätigung, in which case the open claim is
 * waived. Kept free of DB/IO so it is unit-testable, and free of em/en dashes
 * per the house style.
 *
 * The procedure resolves the recipient (member or guardian), the open postings
 * and the club data; this builder turns those primitives into the flat strings
 * the react-pdf template renders.
 */

export type KulanzPosting = {
  billingYear: number;
  falligkeitsdatum: string;
  description: string;
  openAmount: string;
};

export type KulanzClubInput = {
  vereinsname: string;
  anschriftStrasse: string | null;
  anschriftPlz: string | null;
  anschriftOrt: string | null;
  vereinsIban: string;
  vereinsBic: string;
  vereinsBankname: string | null;
  glaeubigerId: string;
  logoDataUri: string | null;
};

export type KulanzClubModel = {
  vereinsname: string;
  senderLine: string;
  glaeubigerId: string;
  logoDataUri: string | null;
  bank: {
    empfaenger: string;
    iban: string;
    bic: string;
    bankname: string | null;
  };
};

export type KulanzRecipientInput = {
  anrede: string | null;
  name: string;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  /** Set when the recipient is a guardian: name of the member they represent. */
  vertretungFor: string | null;
};

export type KulanzLetterInput = {
  recipient: KulanzRecipientInput;
  /** Identity of the member the dues belong to. */
  member: {
    mitgliedsnummer: string;
    name: string;
  };
  postings: KulanzPosting[];
  openSum: string;
  /** Letter date (ISO yyyy-mm-dd). */
  runDate: string;
  /** Payment deadline (ISO yyyy-mm-dd). */
  deadlineDate: string;
  vereinsname: string;
};

export type KulanzPostingRow = {
  jahrFaellig: string;
  bezeichnung: string;
  offen: string;
};

export type KulanzLetterModel = {
  recipientLines: string[];
  vertretungFor: string | null;
  salutation: string;
  mitgliedsnummer: string;
  datum: string;
  intro: string;
  kulanz: string;
  verwendungszweck: string;
  postings: KulanzPostingRow[];
  openSum: string;
  deadline: string;
  /** Tear-off Kündigungsbestätigung response slip. */
  slip: {
    intro: string;
    memberLine: string;
  };
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Format an ISO date (yyyy-mm-dd) as dd.mm.yyyy. Passes other strings through. */
export function fmtKulanzDate(value: string): string {
  if (!value) return value;
  const m = ISO_DATE.exec(value);
  if (!m) return value;
  const [y, mo, d] = value.split("-");
  return `${d}.${mo}.${y}`;
}

/** Format a decimal string as German money, e.g. "12,50". */
export function fmtKulanzMoney(value: string): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Group an IBAN into blocks of four for readability. */
export function fmtKulanzIban(value: string): string {
  const clean = (value ?? "").replace(/\s+/g, "").toUpperCase();
  return clean.replace(/(.{4})/g, "$1 ").trim();
}

function lastWord(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

/** Resolve the salutation from the (free-text) Anrede, terminated with a comma. */
export function kulanzSalutation(anrede: string | null | undefined, name: string): string {
  const a = (anrede ?? "").trim().toLowerCase();
  if (a.startsWith("herr")) return `Sehr geehrter Herr ${lastWord(name)},`;
  if (a.startsWith("frau")) return `Sehr geehrte Frau ${lastWord(name)},`;
  return "Sehr geehrte Damen und Herren,";
}

export function buildKulanzClubModel(input: KulanzClubInput): KulanzClubModel {
  const senderLine = [
    input.vereinsname,
    input.anschriftStrasse,
    [input.anschriftPlz, input.anschriftOrt].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    vereinsname: input.vereinsname,
    senderLine,
    glaeubigerId: input.glaeubigerId,
    logoDataUri: input.logoDataUri,
    bank: {
      empfaenger: input.vereinsname,
      iban: fmtKulanzIban(input.vereinsIban),
      bic: input.vereinsBic,
      bankname: input.vereinsBankname,
    },
  };
}

export function buildKulanzLetterModel(input: KulanzLetterInput): KulanzLetterModel {
  const r = input.recipient;
  const recipientLines = [
    r.name,
    [r.strasse, r.hausnummer].filter(Boolean).join(" "),
    [r.plz, r.ort].filter(Boolean).join(" "),
  ].filter((l) => l.trim() !== "");

  const deadline = fmtKulanzDate(input.deadlineDate);

  const intro =
    `bei der Prüfung unserer Buchhaltung sind die unten aufgeführten Mitgliedsbeiträge noch offen. ` +
    `Wir bitten Sie, den offenen Betrag bis spätestens ${deadline} auf das unten genannte Konto zu überweisen.`;

  const kulanz =
    `Falls Sie Ihre Mitgliedschaft nicht fortführen möchten, bieten wir Ihnen aus Kulanz eine Sonderkündigung an. ` +
    `Senden Sie uns dazu die untenstehende Kündigungsbestätigung unterschrieben bis zum ${deadline} zurück. ` +
    `In diesem Fall verzichten wir auf die offene Forderung und beenden Ihre Mitgliedschaft.`;

  const postings: KulanzPostingRow[] = input.postings.map((p) => ({
    jahrFaellig: `${p.billingYear} · ${fmtKulanzDate(p.falligkeitsdatum)}`,
    bezeichnung: p.description,
    offen: `${fmtKulanzMoney(p.openAmount)} €`,
  }));

  return {
    recipientLines,
    vertretungFor: r.vertretungFor,
    salutation: kulanzSalutation(r.anrede, r.name),
    mitgliedsnummer: input.member.mitgliedsnummer,
    datum: fmtKulanzDate(input.runDate),
    intro,
    kulanz,
    verwendungszweck: `Mitgliedsbeitrag · ${input.member.name} · Mitgliedsnr ${input.member.mitgliedsnummer}`,
    postings,
    openSum: `${fmtKulanzMoney(input.openSum)} €`,
    deadline,
    slip: {
      intro: `Hiermit kündige ich meine Mitgliedschaft beim ${input.vereinsname}.`,
      memberLine: `${input.member.name} · Mitgliedsnummer ${input.member.mitgliedsnummer}`,
    },
  };
}
