import { QrCode } from "@/components/QrCode";

interface Props {
  eventName: string;
  url: string;
  count: number;
  onClose: () => void;
}

/**
 * Printable A4 sheet of QR cards. Each card pairs the event QR with a
 * sequential number (table / seat). Defaults to 12 per page (4×3) — change
 * `count` from the caller.
 */
export function QrSheet({ eventName, url, count, onClose }: Props) {
  const items = Array.from({ length: Math.max(1, Math.min(count, 60)) }, (_, i) => i + 1);
  function doPrint() { window.print(); }
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/80 print:bg-white" onClick={onClose}>
      <div className="qr-sheet-shell mx-auto my-6 max-w-[820px] rounded-2xl bg-white p-6 text-black shadow-2xl print:my-0 print:rounded-none print:p-0 print:shadow-none" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between print:hidden">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">QR sheet · {eventName}</div>
            <div className="text-sm text-neutral-700">Each card prints with a unique number — place one per table or seat.</div>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100">Close</button>
            <button onClick={doPrint} className="rounded-lg bg-black px-4 py-1.5 text-sm font-bold text-white">Print / Save PDF</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 print:gap-2">
          {items.map((n) => (
            <div key={n} className="flex flex-col items-center justify-between rounded-xl border border-neutral-200 p-3 print:break-inside-avoid">
              <div className="w-full text-start">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-neutral-500">LAQTA</div>
                <div className="truncate text-xs font-bold text-neutral-900">{eventName}</div>
              </div>
              <QrCode value={url} size={280} alt={`QR ${n}`} className="my-2 h-32 w-32" />
              <div className="w-full text-center">
                <div className="text-[9px] uppercase tracking-wider text-neutral-500">scan to register</div>
                <div className="mt-1 inline-block rounded-md bg-black px-2 py-0.5 text-[11px] font-black text-white">#{n}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-center text-[10px] text-neutral-500 print:mt-1" dir="ltr">{url}</div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          body { background: white !important; }
          .qr-sheet-shell { max-width: none !important; }
        }
      `}</style>
    </div>
  );
}
