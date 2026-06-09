import { Eraser, Expand, RotateCw, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";

/**
 * Signature capture for the public application form. Three ways to provide a
 * signature, matching svums: draw it with finger/mouse on the inline canvas,
 * draw it in a distraction-free fullscreen overlay (better on phones, with a
 * landscape hint), or upload an image of a signature. Either way the result is
 * emitted as a PNG data URI via `onChange`.
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
  // A signature captured fullscreen or uploaded is shown as an image preview;
  // an inline drawing stays on the canvas itself.
  const [preview, setPreview] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

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
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty.current = true;
  };

  // Inline drawing: emit the canvas as-is once the stroke ends.
  const endInline = useCallback(() => {
    drawing.current = false;
    if (dirty.current && canvasRef.current) {
      setPreview(null);
      onChange(canvasRef.current.toDataURL("image/png"));
    }
  }, [onChange]);

  const clear = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    setPreview(null);
    onChange(null);
  }, [onChange]);

  const onUpload = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPreview(reader.result);
        onChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const showImage = Boolean(preview ?? (value && !value.startsWith("data:image/png")));
  const imageSrc = preview ?? value ?? undefined;

  return (
    <div className="flex flex-col gap-2">
      {showImage ? (
        <img
          src={imageSrc}
          alt="Unterschrift"
          className="h-40 w-full rounded-md border border-input bg-white object-contain"
        />
      ) : (
        <div ref={containerRef} className="w-full">
          <canvas
            ref={canvasRef}
            width={width}
            height={160}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={endInline}
            onPointerLeave={endInline}
            className="h-40 w-full touch-none rounded-md border border-input bg-white"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          <Eraser className="size-4" /> Löschen
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setFullscreen(true)}>
          <Expand className="size-4" /> Vollbild
        </Button>
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 text-xs text-muted-foreground hover:text-foreground">
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

      {fullscreen ? (
        <FullscreenSignature
          start={start}
          move={move}
          onClose={() => setFullscreen(false)}
          onApply={(dataUri) => {
            setPreview(dataUri);
            onChange(dataUri);
            setFullscreen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function FullscreenSignature({
  start,
  move,
  onApply,
  onClose,
}: {
  start: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  move: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onApply: (dataUri: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const touched = useRef(false);
  const [size, setSize] = useState({ w: 320, h: 200 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) {
        setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const clear = () => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    touched.current = false;
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Unterschrift</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground sm:hidden">
          <RotateCw className="size-3.5" /> Für mehr Platz ins Querformat drehen
        </span>
      </div>
      <div ref={wrapRef} className="min-h-0 flex-1">
        <canvas
          ref={ref}
          width={size.w}
          height={size.h}
          onPointerDown={start}
          onPointerMove={(e) => {
            move(e);
            touched.current = true;
          }}
          className="size-full touch-none rounded-lg border border-input bg-white"
        />
      </div>
      <div className="mt-3 flex justify-between gap-2">
        <Button type="button" variant="outline" onClick={clear}>
          <Eraser className="size-4" /> Löschen
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (ref.current && touched.current) onApply(ref.current.toDataURL("image/png"));
              else onClose();
            }}
          >
            Übernehmen
          </Button>
        </div>
      </div>
    </div>
  );
}
