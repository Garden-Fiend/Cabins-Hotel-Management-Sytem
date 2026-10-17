import type { AnyReservationDto, MultiReservationDto, MultiCreateInput, MultiEditInput } from "./contracts";
import type { CreateInput, GuestDto, GuestInput, PatchInput, ReferencesDto, ReservationDto, LifecycleAction, LifecycleInput, DefinitionKind, DefinitionMap } from "./contracts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly uncertain: boolean;
  details?: unknown;
  constructor(message: string, status = 0, code = "network_error", uncertain = false) {
    super(message); this.name = "ApiError";
    this.status = status; this.code = code; this.uncertain = uncertain;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "version_conflict") return "This reservation changed on the server. Your draft is retained. Load the latest version before reviewing and retrying.";
    if (error.code === "room_conflict") return "The server reports that this room is already booked. Your draft is retained.";
    if (error.uncertain) return "The server response could not be confirmed. Your draft is retained. Retry the same request to confirm its outcome; do not create another booking.";
  }
  return error instanceof Error ? error.message : "Request failed. Your draft is retained.";
}

export function runtimeConfiguration(env: { VITE_HMS_DATA_MODE?: string; VITE_HMS_API_URL?: string }) {
  const mode = env.VITE_HMS_DATA_MODE ?? "demo";
  if (mode !== "demo" && mode !== "api") throw new Error("VITE_HMS_DATA_MODE must be demo or api.");
  if (mode === "demo") return { mode } as const;
  if (!env.VITE_HMS_API_URL) throw new Error("API mode requires VITE_HMS_API_URL. Demo fallback is disabled.");
  const url = new URL(env.VITE_HMS_API_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("API URL must be an HTTP(S) URL without credentials, query or fragment.");
  return { mode, baseUrl: url.href.replace(/\/$/, "") } as const;
}

export class ApiClient {
  readonly baseUrl: string;
  constructor(baseUrl: string) { this.baseUrl = baseUrl.replace(/\/$/, ""); }
  private async request<T>(path: string, method = "GET", body?: unknown, key?: string, signal?: AbortSignal): Promise<T> {
    let response: Response;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      response = await fetch(`${this.baseUrl}/api/v1${path}`, { method, signal: controller.signal,
        headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(key ? { "Idempotency-Key": key } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch {
      window.clearTimeout(timeout); signal?.removeEventListener("abort", abort);
      throw new ApiError("API unavailable. No demo data was substituted.", 0, "network_error", method !== "GET");
    }
    try {
    let result: unknown;
    try { result = await response.json(); }
    catch { throw new ApiError("Invalid server response.", response.status, "invalid_response", method !== "GET"); }
    if (!response.ok) {
      const fault = result as { code?: string; message?: string; detail?: string; field_errors?: { field: string; message: string }[] };
      const fields = fault.field_errors?.map(item => `${item.field}: ${item.message}`).join("; ");
      const failure = new ApiError(fields || fault.message || fault.detail || `API request failed (${response.status}).`,
        response.status, fault.code ?? "http_error", response.status >= 500 && method !== "GET");
      failure.details=result; throw failure;
    }
    return result as T;
    } finally {
      window.clearTimeout(timeout); signal?.removeEventListener("abort", abort);
    }
  }
  private async all<T extends { id: string }>(path: string, signal?: AbortSignal): Promise<T[]> {
    const result: T[] = [], seen = new Set<string>();
    for (let offset = 0; ; offset += 100) {
      const page = await this.request<T[]>(`${path}?limit=100&offset=${offset}`, "GET", undefined, undefined, signal);
      if (!Array.isArray(page)) throw new ApiError("Invalid paginated response.", 0, "invalid_response");
      for (const item of page) {
        if (!item.id || seen.has(item.id)) throw new ApiError("List changed while loading. Reload to get a consistent list.", 0, "invalid_response");
        seen.add(item.id); result.push(item);
      }
      if (page.length < 100) return result;
    }
  }
  references(signal?: AbortSignal) { return this.request<ReferencesDto>("/reference-data", "GET", undefined, undefined, signal); }
  collections(id:string,offset=0){return this.request<import('./collections').CollectionRead>(`/reservations/${encodeURIComponent(id)}/collections?offset=${offset}`);}
  allocatePayment(id:string,body:import('./collections').AllocationInput,key:string){return this.request<{summary:import('./collections').CollectionSummary}>(`/reservations/${encodeURIComponent(id)}/payment-allocations`,'POST',body,key);}
  recordCollection(id:string,body:import('./collections').CollectionInput&{expected_version:number},key:string){return this.request<{summary:import('./collections').CollectionSummary}>(`/reservations/${encodeURIComponent(id)}/collections`,'POST',body,key);}
  reviewObligation(id:string,body:import('./collections').ObligationInput&{expected_version:number;expected_pricing_id:string;expected_capture_id:string|null},key:string){return this.request<{summary:import('./collections').CollectionSummary}>(`/reservations/${encodeURIComponent(id)}/guest-obligation`,'POST',body,key);}
  bookingFinancialHistory(id:string){return this.request<import('./bookingFinancials').BookingFinancialCapture[]>(`/reservations/${encodeURIComponent(id)}/booking-financials`);}
  correctBookingFinancials(id:string,body:{expected_version:number;booking_source_id:string;booking_financials:import('./bookingFinancials').BookingFinancialInput;reason:string},key:string){return this.request<import('./contracts').AnyReservationDto>(`/reservations/${encodeURIComponent(id)}/edit-booking-financials`,'POST',body,key);}
  guests(signal?: AbortSignal) { return this.all<GuestDto>("/guests", signal); }
  reservations(signal?: AbortSignal) { return this.all<AnyReservationDto>("/reservations", signal); }
  reservation(id: string) { return this.request<AnyReservationDto>(`/reservations/${encodeURIComponent(id)}`); }
  billingDocuments(id:string) { return this.all<import("./billingDocuments").BillingDocumentDto>(`/reservations/${encodeURIComponent(id)}/billing-documents`); }
  billingDocument(id:string, signal?:AbortSignal) { return this.request<import("./billingDocuments").BillingDocumentDto>(`/billing-documents/${encodeURIComponent(id)}`,"GET",undefined,undefined,signal); }
  createBillingDraft(id:string,body:{expected_reservation_version:number},key:string) { return this.request<import("./billingDocuments").BillingDocumentDto>(`/reservations/${encodeURIComponent(id)}/billing-documents`,"POST",body,key); }
  finalizeBill(id:string,body:{expected_version:number},key:string) { return this.request<import("./billingDocuments").BillingDocumentDto>(`/billing-documents/${encodeURIComponent(id)}/finalize`,"POST",body,key); }
  createMulti(body:MultiCreateInput,key:string){return this.request<MultiReservationDto>("/multi-room-reservations","POST",body,key);}
  editAllocations(id:string,body:MultiEditInput,key:string){return this.request<MultiReservationDto>(`/reservations/${encodeURIComponent(id)}/edit-allocations`,"POST",body,key);}
  roomLifecycle(id:string,action:string,body:{expected_version:number;allocation_id?:string;guest_has_vacated?:boolean},key:string){return this.request<MultiReservationDto>(`/reservations/${encodeURIComponent(id)}/room-lifecycle/${action}`,"POST",body,key);}
  createGuest(body: GuestInput, key: string) { return this.request<GuestDto>("/guests", "POST", body, key); }
  createReservation(body: CreateInput, key: string) { return this.request<ReservationDto>("/reservations", "POST", body, key); }
  patchReservation(id: string, body: PatchInput, key: string) { return this.request<ReservationDto>(`/reservations/${encodeURIComponent(id)}`, "PATCH", body, key); }
  editDetails(id: string, body: PatchInput & { guest_id: string }, key: string) { return this.request<ReservationDto>(`/reservations/${encodeURIComponent(id)}/edit-details`, "POST", body, key); }
  editInclusions(id: string, body: import("./contracts").InclusionsEditInput, key: string) { return this.request<ReservationDto>(`/reservations/${encodeURIComponent(id)}/edit-inclusions`, "POST", body, key); }
  editBreakfast(id: string, body: import("./contracts").BreakfastEditInput, key: string) { return this.request<ReservationDto>(`/reservations/${encodeURIComponent(id)}/edit-breakfast`, "POST", body, key); }
  editStay(id: string, body: import("./contracts").StayEditInput, key: string) { return this.request<ReservationDto>(`/reservations/${encodeURIComponent(id)}/edit-stay`, "POST", body, key); }
  editDiscounts(id: string, body: import("./contracts").DiscountsEditInput, key: string) { return this.request<ReservationDto>(`/reservations/${encodeURIComponent(id)}/edit-discounts`, "POST", body, key); }
  editBilling(id: string, body: import("./contracts").BillingEditInput, key: string) { return this.request<ReservationDto>(`/reservations/${encodeURIComponent(id)}/edit-billing`, "POST", body, key); }
  editCharges(id: string, body: import("./contracts").ChargesEditInput, key: string) { return this.request<ReservationDto>(`/reservations/${encodeURIComponent(id)}/edit-charges`, "POST", body, key); }
  editStayCharges(id: string, body: import("./contracts").StayChargesEditInput, key: string) { return this.request<ReservationDto>(`/reservations/${encodeURIComponent(id)}/edit-stay-charges`, "POST", body, key); }
  lifecycleReservation(id: string, action: LifecycleAction, body: LifecycleInput, key: string) {
    return this.request<ReservationDto>(`/reservations/${encodeURIComponent(id)}/${action}`, "POST", body, key);
  }
  roomReadiness(id: string, body: { expected_version: number; housekeeping: "clean" | "cleaning" }, key: string) {
    return this.request<ReferencesDto["rooms"][number]>(`/rooms/${encodeURIComponent(id)}/readiness`, "POST", body, key);
  }
  retireDefinition(kind: "rooms" | "room-types", id: string, body: {expected_version:number;action:"archive"|"restore"|"delete"}, key: string) {
    return this.request<{id:string;version:number;action:string}>(`/configuration/${kind}/${encodeURIComponent(id)}/retirement`, "POST", body, key);
  }
  saveSource(id:string|undefined,body:ReturnType<typeof import('./sourceInputs').sourceInput>,key:string){return this.request<import('./sourceInputs').SourceDto>(`/configuration/booking-sources${id?`/${encodeURIComponent(id)}`:''}`,id?'PATCH':'POST',body,key);}
  saveAgreement(sourceId:string,id:string|undefined,body:ReturnType<typeof import('./sourceInputs').agreementInput>,key:string){return this.request<import('./sourceInputs').AgreementDto>(`/configuration/booking-sources/${encodeURIComponent(sourceId)}/agreements${id?`/${encodeURIComponent(id)}`:''}`,id?'PATCH':'POST',body,key);}
  saveDefinition<K extends DefinitionKind>(kind: K, id: string | undefined, body: DefinitionMap[K] & { expected_version?: number }, key: string) {
    return this.request<{ id: string; version: number }>(`/configuration/${kind}${id ? `/${encodeURIComponent(id)}` : ""}`, id ? "PATCH" : "POST", body, key);
  }
}
