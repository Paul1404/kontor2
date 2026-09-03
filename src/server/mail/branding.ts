import { normalizeHex } from "~/lib/branding-color";
import type { DB } from "~/server/db/client";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";

/** Club identity as it appears in the header and footer of every mail. */
export type MailOrganization = {
  displayName: string;
  legalName: string;
  addressLines: string[];
  contactEmail: string | null;
  contactPhone: string | null;
  brandColor: string;
  logoDataUri: string | null;
};

/**
 * Logo attachment referenced from the HTML as `cid:vereinslogo@kontor2`.
 * A `data:` URI in `<img src>` is stripped by Gmail and several other clients,
 * so the logo travels as an inline attachment instead.
 */
export type MailInlineAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
  cid: string;
  contentDisposition: "inline";
};

export const MAIL_LOGO_CID = "vereinslogo@kontor2";

const FALLBACK: MailOrganization = {
  displayName: "Vereinsverwaltung",
  legalName: "Vereinsverwaltung",
  addressLines: [],
  contactEmail: null,
  contactPhone: null,
  brandColor: "#a6864e",
  logoDataUri: null,
};

/**
 * Load the club identity used by every outgoing mail. Deliberately resilient:
 * a mail must never fail to go out because the branding could not be read, so
 * any error falls back to a neutral identity.
 */
export async function loadMailOrganization(db: DB): Promise<MailOrganization> {
  try {
    const [organization] = await db
      .select({
        displayName: organizationSettingsTable.anzeigename,
        legalName: organizationSettingsTable.vereinsname,
        street: organizationSettingsTable.anschriftStrasse,
        postalCode: organizationSettingsTable.anschriftPlz,
        city: organizationSettingsTable.anschriftOrt,
        membershipEmail: organizationSettingsTable.mitgliedschaftEmail,
        contactEmail: organizationSettingsTable.kontaktEmail,
        contactPhone: organizationSettingsTable.kontaktTelefon,
        primaryColor: organizationSettingsTable.primaryColor,
        logo: organizationSettingsTable.logo,
      })
      .from(organizationSettingsTable)
      .limit(1);
    const legalName = organization?.legalName?.trim() || FALLBACK.legalName;
    const locality = [organization?.postalCode?.trim(), organization?.city?.trim()]
      .filter(Boolean)
      .join(" ");
    return {
      displayName: organization?.displayName?.trim() || legalName,
      legalName,
      addressLines: [organization?.street?.trim(), locality].filter((line): line is string =>
        Boolean(line),
      ),
      contactEmail:
        organization?.membershipEmail?.trim() || organization?.contactEmail?.trim() || null,
      contactPhone: organization?.contactPhone?.trim() || null,
      brandColor: normalizeHex(organization?.primaryColor) || FALLBACK.brandColor,
      logoDataUri: validLogoDataUri(organization?.logo),
    };
  } catch {
    return { ...FALLBACK };
  }
}

/**
 * Only PNG/JPEG data URIs are accepted, and the bytes have to match the label.
 * The renderer decides the decoder from the MIME type and, when the bytes do
 * not fit, drops the image without an error, so a mislabelled upload would
 * silently disappear from every letter and mail.
 */
export function validLogoDataUri(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  const match = /^data:image\/(png|jpeg);base64,([a-z0-9+/]+=*)$/i.exec(trimmed);
  if (!match) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2]!, "base64");
  } catch {
    return null;
  }
  const isPng = bytes
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const declaredPng = match[1]!.toLowerCase() === "png";
  return (declaredPng ? isPng : isJpeg) ? trimmed : null;
}

export function buildLogoAttachment(dataUri: string): MailInlineAttachment {
  const match = /^data:image\/(png|jpeg);base64,(.+)$/i.exec(dataUri);
  const subtype = match?.[1]?.toLowerCase() === "jpeg" ? "jpeg" : "png";
  return {
    filename: `vereinslogo.${subtype === "jpeg" ? "jpg" : "png"}`,
    content: Buffer.from(match?.[2] ?? "", "base64"),
    contentType: `image/${subtype}`,
    cid: MAIL_LOGO_CID,
    contentDisposition: "inline",
  };
}
