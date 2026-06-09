import { Eraser, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";

/**
 * Signature capture for the public application form. Two ways to provide a
 * signature, matching svums: draw it with finger/mouse on the canvas, or
 * upload an image of a signature. Either way the result is emitted as a PNG
 * data URI via `onChange`.
 */
export function SignaturePad({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (dataUri: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [width, setWidth] = useState(600);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Keep the canvas backing resolution in sync with its CSS width so strokes
  // land under the pointer on every screen size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty.current = true;
  };

  const end = useCallback(() => {
    drawing.current = false;
    if (dirty.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL("image/png"));
    }
  }, [onChange]);

  const clear = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  }, [onChange]);

  const onUpload = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onChange(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-2">
      {value && !value.startsWith("data:image/png") ? (
        // An uploaded image preview (drawn signatures stay on the canvas).
        <img
          src={value}
          alt="Hochgeladene Unterschrift"
          className="h-24 w-full rounded-md border border-input object-contain bg-background"
        />
      ) : (
        <div ref={containerRef} className="w-full">
          <canvas
            ref={canvasRef}
            width={width}
            height={160}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            className="h-40 w-full touch-none rounded-md border border-input bg-background"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          <Eraser className="size-4" /> Löschen
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
          <Upload className="size-4" /> Bild hochladen
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
        </label>
      </div>
    </div>
  );
}
