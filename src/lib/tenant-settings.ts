export type LegacyImportSource = "linear_webverein";
export type CancellationDateMode = "anytime" | "month_end" | "year_end";

export type DunningLevelText = {
  title: string;
  introduction: string;
  closing: string;
};

export type TenantPolicy = {
  legacyImportSources: LegacyImportSource[];
  legacyArchiveEnabled: boolean;
  cancellationDateMode: CancellationDateMode;
  cancellationStatuteReference: string | null;
  outstandingClaimsStatuteReference: string | null;
  privacyStatuteReference: string | null;
  familyPartnerRequired: boolean;
  familyChildMaxAge: number;
  departmentPerPersonRequired: boolean;
  dunningTexts: {
    level1: DunningLevelText | null;
    level2: DunningLevelText | null;
    level3: DunningLevelText | null;
  };
};

export const DEFAULT_DUNNING_TEXTS: Record<1 | 2 | 3, DunningLevelText> = {
  1: {
    title: "Zahlungserinnerung",
    introduction:
      "bei der Prüfung unserer Buchhaltung haben wir festgestellt, dass die aufgeführten Beiträge noch offen sind. Bitte begleichen Sie den Betrag bis spätestens",
    closing:
      "Sollte sich Ihre Zahlung mit dieser Erinnerung überschnitten haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.",
  },
  2: {
    title: "1. Mahnung",
    introduction:
      "die aufgeführten Beiträge sind weiterhin offen. Bitte begleichen Sie den ausstehenden Betrag bis spätestens",
    closing: "Bitte nehmen Sie bei Rückfragen oder Unklarheiten Kontakt mit dem Verein auf.",
  },
  3: {
    title: "Letzte Mahnung",
    introduction:
      "trotz unserer bisherigen Schreiben sind die aufgeführten Beiträge weiterhin offen. Bitte begleichen Sie den Gesamtbetrag bis spätestens",
    closing:
      "Nach Ablauf der Frist prüft der Verein das weitere Vorgehen nach seinen geltenden Regeln.",
  },
};

/** Neutral policy for newly configured clubs. No legacy source is assumed. */
export const DEFAULT_TENANT_POLICY: TenantPolicy = {
  legacyImportSources: [],
  legacyArchiveEnabled: false,
  cancellationDateMode: "anytime",
  cancellationStatuteReference: null,
  outstandingClaimsStatuteReference: null,
  privacyStatuteReference: null,
  familyPartnerRequired: false,
  familyChildMaxAge: 18,
  departmentPerPersonRequired: false,
  dunningTexts: { level1: null, level2: null, level3: null },
};

export function normalizeTenantPolicy(value: TenantPolicy | null | undefined): TenantPolicy {
  if (!value) return structuredClone(DEFAULT_TENANT_POLICY);
  return {
    ...DEFAULT_TENANT_POLICY,
    ...value,
    legacyImportSources: [...new Set(value.legacyImportSources ?? [])].filter(
      (source): source is LegacyImportSource => source === "linear_webverein",
    ),
    dunningTexts: { ...DEFAULT_TENANT_POLICY.dunningTexts, ...value.dunningTexts },
  };
}
