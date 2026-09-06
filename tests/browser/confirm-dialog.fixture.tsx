import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmDialog } from "../../src/components/ui/confirm-dialog";

function Fixture() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [closedWith, setClosedWith] = useState("");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Brief schreiben
      </button>
      <button type="button" onClick={() => setLoading((value) => !value)}>
        Ladestatus wechseln
      </button>
      <output>{closedWith}</output>
      <ConfirmDialog
        open={open}
        title="Brief"
        loading={loading}
        onConfirm={() => {}}
        onOpenChange={(next) => {
          if (!loading) {
            setClosedWith(name);
            setOpen(next);
          }
        }}
      >
        <label>
          Absender
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Brieftext
          <textarea value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
      </ConfirmDialog>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
