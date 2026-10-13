/** New API purchases use stable UUIDs; reject unavailable entropy or repeated candidates. */
export function createChargeId(existing: readonly { id: string }[], generate = () => {
  if (!globalThis.crypto?.randomUUID) throw new Error("Secure UUID generation is unavailable. Use HTTPS or localhost; no purchase was added.");
  return globalThis.crypto.randomUUID();
}): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = generate();
    if (id && !existing.some(item => item.id === id)) return id;
  }
  throw new Error("Unable to create a unique purchase identity. No purchase was added.");
}

/** Preserve the existing demo identity format independently of API persistence. */
export function createDemoChargeId(): string {
  return `charge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
