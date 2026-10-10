import { useId, useState } from "react";

/** Small contextual help that works with a mouse, keyboard and touch. */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  const [engaged, setEngaged] = useState(false);
  const [pinned, setPinned] = useState(false);
  const visible = engaged || pinned;
  return <span className="relative inline-flex align-middle" onMouseEnter={() => setEngaged(true)} onMouseLeave={() => setEngaged(false)}>
    <button type="button" aria-label={`Help: ${label}`} aria-describedby={visible ? id : undefined} aria-expanded={visible}
      className="inline-flex size-6 items-center justify-center rounded-full text-slate-500 hover:bg-blue-100 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
      onFocus={() => setEngaged(true)} onBlur={() => { setEngaged(false); setPinned(false); }}
      onClick={event => { event.preventDefault(); event.stopPropagation(); setPinned(!pinned); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEngaged(false); setPinned(false); } }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></svg>
    </button>
    {visible && <span id={id} role="tooltip" className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[75vw] rounded-xl bg-slate-900 p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-xl">{children}</span>}
  </span>;
}
