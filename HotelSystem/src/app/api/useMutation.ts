import { useRef, useState } from "react";
import { ApiError, errorMessage } from "./client";

export function useMutation<T, R>(save: (body: T, key: string) => Promise<R>, recoveryKey?: string, formatError: (error:unknown)=>string = errorMessage) {
  const [recovered] = useState<{ body: T; signature: string; key: string } | null>(() => {
    if (!recoveryKey) return null;
    try {
      const raw = sessionStorage.getItem(recoveryKey);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (typeof value.key !== "string" || typeof value.signature !== "string" || JSON.stringify(value.body) !== value.signature)
        throw new Error("Invalid pending request");
      return value;
    } catch { return null; }
  });
  const request = useRef<{ body: T; signature: string; key: string } | null>(recovered);
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(recovered ? "An earlier request needs confirmation. Retry its original request before starting another." : "");
  const [uncertain, setUncertain] = useState(Boolean(recovered));
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  async function submit(body: T): Promise<R | undefined> {
    if (running.current) return;
    if (typeof crypto.randomUUID !== "function") { setError("This browser needs a secure context to save requests."); return; }
    const signature = JSON.stringify(body);
    if (uncertain && request.current?.signature !== signature) {
      setError("Resolve the original request before changing its payload."); return;
    }
    if (!request.current || request.current.signature !== signature)
      request.current = { body, signature, key: crypto.randomUUID() };
    if (recoveryKey) {
      try { sessionStorage.setItem(recoveryKey, JSON.stringify(request.current)); }
      catch { setError("Session request recovery is unavailable; no request was sent."); return; }
    }
    running.current = true; setPending(true); setError(""); setConflict(false); setFailure(undefined);
    try {
      const result = await save(request.current.body, request.current.key);
      request.current = null; setUncertain(false);
      if (recoveryKey) { try { sessionStorage.removeItem(recoveryKey); } catch { /* A confirmed commit must remain success even if cleanup is unavailable. */ } }
      return result;
    } catch (failure) {
      setFailure(failure);
      const ambiguous = !(failure instanceof ApiError) || failure.uncertain;
      setUncertain(ambiguous); setConflict(failure instanceof ApiError && failure.code === "version_conflict");
      setError(formatError(failure));
      if (!ambiguous) {
        request.current = null;
        if (recoveryKey) { try { sessionStorage.removeItem(recoveryKey); } catch { /* Stored replay remains safe; no second write is implied. */ } }
      }
    } finally { running.current = false; setPending(false); }
  }
  function reviewedLatest() { if (!uncertain) { request.current = null; setError(""); setConflict(false); } }
  async function retryOriginal() { return request.current ? submit(request.current.body) : undefined; }
  return { submit, retryOriginal, pending, error, uncertain, conflict, reviewedLatest, failure };
}
