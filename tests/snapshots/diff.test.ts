import { describe, expect, it } from "vitest";
import { diffSnapshotVsCurrent } from "~/server/snapshots/diff";

function emptyBlob() {
  return {
    member: {},
    contracts: [],
    sepa: [],
    attachments: [],
    relationships: [],
    memberAbteilungen: [],
    sollstellungen: [],
  };
}

describe("diffSnapshotVsCurrent", () => {
  it("reports an empty member-diff when both states match", () => {
    const snap = { ...emptyBlob(), member: { vorname: "Anna", nachname: "Müller" } };
    const live = { ...emptyBlob(), member: { vorname: "Anna", nachname: "Müller" } };
    const out = diffSnapshotVsCurrent(snap, live);
    expect(Object.keys(out.member)).toEqual([]);
    expect(out.contracts).toEqual({ added: 0, removed: 0, changedIds: [] });
  });

  it("reports drifted scalar fields on the member row", () => {
    const snap = { ...emptyBlob(), member: { plz: "97520" } };
    const live = { ...emptyBlob(), member: { plz: "97516" } };
    const out = diffSnapshotVsCurrent(snap, live);
    expect(out.member.plz).toEqual({ before: "97520", after: "97516" });
  });

  it("counts added / removed dependent rows", () => {
    const snap = {
      ...emptyBlob(),
      contracts: [
        { id: "c1", betrag: "50.00" },
        { id: "c2", betrag: "10.00" },
      ],
    };
    const live = {
      ...emptyBlob(),
      contracts: [
        { id: "c2", betrag: "10.00" },
        { id: "c3", betrag: "5.00" },
      ],
    };
    const out = diffSnapshotVsCurrent(snap, live);
    expect(out.contracts.added).toBe(1);
    expect(out.contracts.removed).toBe(1);
    expect(out.contracts.changedIds).toEqual([]);
  });

  it("flags dependent rows whose fields drifted by id", () => {
    const snap = { ...emptyBlob(), sepa: [{ id: "m1", status: "active" }] };
    const live = { ...emptyBlob(), sepa: [{ id: "m1", status: "revoked" }] };
    const out = diffSnapshotVsCurrent(snap, live);
    expect(out.sepa.added).toBe(0);
    expect(out.sepa.removed).toBe(0);
    expect(out.sepa.changedIds).toEqual(["m1"]);
  });
});
