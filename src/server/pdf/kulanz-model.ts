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
  /** SEPA return fee already folded into the member's openSum, if any. */
  rueckgebuhr: string;
};

export type KulanzClubInput = {
  vereinsname: string;
  anschriftStrasse: string | null;
  anschriftPlz: string | null;
  anschriftOrt: string | null;
  /** Contact address members reply to (e.g. mitgliedschaft@verein.de). */
  kontaktEmail: string | null;
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
  /**
   * Where the member sends the signed Kündigungsbestätigung. Without this the
   * tear-off slip has no destination. `adresseLines` is the postal address;
   * `email` offers the faster digital route when the Verein has a contact
   * mailbox configured.
   */
  rueckantwort: {
    adresseLines: string[];
    email: string | null;
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
    /**
     * Canonical reference: the Mitgliedsnummer for real members, or "A" + the
     * address number ("A123") for contact-only payers that never had one.
     */
    reference: string;
    /** True when this row is a contact/payer with no real Mitgliedsnummer. */
    isContact: boolean;
    name: string;
  };
  postings: KulanzPosting[];
  openSum: string;
  /** Letter date (ISO yyyy-mm-dd). */
  runDate: string;
  /** Payment deadline (ISO yyyy-mm-dd). */
  deadlineDate: string;
  vereinsname: string;
  /** Contact mailbox for a formless cancellation by email, or null. */
  kontaktEmail: string | null;
  /**
   * Waive the SEPA return fee out of goodwill: drop it from the amount due and
   * state in the letter that it was erlassen. Off by default.
   */
  waiveReturnFee?: boolean;
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
  /** Canonical reference value shown in the info block ("123" or "A123"). */
  reference: string;
  /** Label for that value: "Mitgliedsnummer" for members, "Referenz" for contacts. */
  referenceLabel: string;
  datum: string;
  intro: string;
  kulanz: string;
  /**
   * Offer to cancel by a formless email instead of returning the signed slip,
   * or null when no contact mailbox is configured.
   */
  kulanzEmail: string | null;
  verwendungszweck: string;
  postings: KulanzPostingRow[];
  /**
   * Combined SEPA return fees charged as a separate line, or null when there
   * are none or they were waived (see `rueckgebuhrWaived`).
   */
  rueckgebuhr: string | null;
  /** Combined SEPA return fees waived out of goodwill, or null when none/charged. */
  rueckgebuhrWaived: string | null;
  /** Sentence stating the fee was waived, shown when `rueckgebuhrWaived` is set. */
  feeWaiverNote: string | null;
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

  const adresseLines = [
    input.vereinsname,
    input.anschriftStrasse,
    [input.anschriftPlz, input.anschriftOrt].filter(Boolean).join(" "),
  ].filter((l): l is string => (l ?? "").trim() !== "");
  const email = input.kontaktEmail?.trim() ? input.kontaktEmail.trim() : null;

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
    rueckantwort: { adresseLines, email },
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
    `Füllen Sie dazu die Kündigungsbestätigung auf der zweiten Seite aus und senden Sie sie uns unterschrieben bis zum ${deadline} zurück. ` +
    `In diesem Fall verzichten wir auf die offene Forderung und beenden Ihre Mitgliedschaft.`;

  // Contact-only payers never had a Mitgliedsnummer; label their reference
  // neutrally instead of printing a number under a heading they do not hold.
  const referenceLabel = input.member.isContact ? "Referenz" : "Mitgliedsnummer";
  const refWord = input.member.isContact ? "Referenz" : "Mitgliedsnummer";

  const email = input.kontaktEmail?.trim();
  const kulanzEmail = email
    ? `Schneller geht es per E-Mail an ${email}. Schreiben Sie uns bis zum ${deadline} formlos, ` +
      `dass Sie Ihre Mitgliedschaft beenden möchten, und nennen Sie Ihren Namen und Ihre ${refWord}. ` +
      `Dann benötigen wir die unterschriebene Kündigungsbestätigung nicht.`
    : null;

  const postings: KulanzPostingRow[] = input.postings.map((p) => ({
    jahrFaellig: `${p.billingYear} · ${fmtKulanzDate(p.falligkeitsdatum)}`,
    bezeichnung: p.description,
    offen: `${fmtKulanzMoney(p.openAmount)} €`,
  }));

  // SEPA return fees are folded into the member's openSum upstream, but the
  // posting rows only show the Beitrag. When charged, surface the combined fee
  // as its own line so the visible rows reconcile with the printed total. When
  // waived out of goodwill, drop it from the total instead and state so.
  let feeCents = 0;
  for (const p of input.postings) feeCents += Math.round(Number.parseFloat(p.rueckgebuhr) * 100);
  const waive = !!input.waiveReturnFee && feeCents > 0;
  const feeFmt = feeCents > 0 ? `${fmtKulanzMoney((feeCents / 100).toFixed(2))} €` : null;
  const rueckgebuhr = waive ? null : feeFmt;
  const rueckgebuhrWaived = waive ? feeFmt : null;

  const openSumCents = Math.round(Number.parseFloat(input.openSum) * 100);
  const dueCents = waive ? openSumCents - feeCents : openSumCents;

  const feeWaiverNote = waive
    ? `Die angefallene SEPA-Rücklastgebühr in Höhe von ${feeFmt} erlassen wir Ihnen aus Kulanz. ` +
      `Bitte überweisen Sie nur den offenen Mitgliedsbeitrag.`
    : null;

  return {
    recipientLines,
    vertretungFor: r.vertretungFor,
    salutation: kulanzSalutation(r.anrede, r.name),
    reference: input.member.reference,
    referenceLabel,
    datum: fmtKulanzDate(input.runDate),
    intro,
    kulanz,
    kulanzEmail,
    verwendungszweck: `Mitgliedsbeitrag · ${input.member.name} · ${refWord} ${input.member.reference}`,
    postings,
    rueckgebuhr,
    rueckgebuhrWaived,
    feeWaiverNote,
    openSum: `${fmtKulanzMoney((dueCents / 100).toFixed(2))} €`,
    deadline,
    slip: {
      intro: `Hiermit kündige ich meine Mitgliedschaft beim ${input.vereinsname}.`,
      memberLine: `${input.member.name} · ${referenceLabel} ${input.member.reference}`,
    },
  };
}
