import {multiReservationInput,hasMultiChanges} from "./multiInputs";
import {singleCanonical} from "./multiPresentation";
import type {MultiEditInput} from "./contracts";
import { useRef, useState } from "react";
import { ReservationDemoContext } from "../reservationDemoStore";
import { useApi } from "./useApi";
import { richConfiguration, richReservation } from "./richPresentation";
import { presentReservation, apiInstant } from "./presentation";
import {formatHotelDate} from '../../lib/hotelTime';
import { useMutation } from "./useMutation";
import type { CreateInput, GuestInput, LifecycleAction, LifecycleInput } from "./contracts";
import { reservationEditInput, type ReservationEditInput } from "./reservationEditInput";
import { manualDiscountInputs } from "./discountInputs";
import { breakfastInputs } from "./breakfastInputs";
import { toMinorUnits } from "../../lib/money";
import { definitionIntent, type DefinitionIntent } from "./definitionInputs";
import {sourceInput,agreementInput,presentSource,presentAgreement} from './sourceInputs';
import {ApiError,errorMessage} from './client';
function configurationError(error:unknown){
  if(error instanceof ApiError&&error.code==='version_conflict')return 'Source or agreement changed. Your draft is retained. Load latest versions and review before retrying.';
  if(error instanceof ApiError&&error.uncertain)return 'The outcome is not confirmed. Keep your draft and confirm the original configuration request.';
  return errorMessage(error);
}

export function RichApiBridge({ children }: { children: React.ReactNode }) {
  const api = useApi();
  const scope = `hms-pending:${api.client.baseUrl}:${api.data?.references.company.id}`;
  const create = useMutation(api.createReservation, `${scope}:create`);
  const guest = useMutation(api.createGuest, `${scope}:guest`);
  const patch = useMutation((input: { id: string; body: ReservationEditInput }, key: string) => api.patchReservation(input.id, input.body, key), `${scope}:patch`);
  const lifecycle = useMutation((input: { id: string; action: LifecycleAction; body: LifecycleInput }, key: string) => api.lifecycleReservation(input.id, input.action, input.body, key), `${scope}:lifecycle`);
  const readiness = useMutation((input: { id: string; body: { expected_version: number; housekeeping: "clean" | "cleaning" } }, key: string) => api.roomReadiness(input.id, input.body, key), `${scope}:readiness`);
  const definition = useMutation((input: DefinitionIntent, key: string) => api.saveDefinition(input.kind, input.id, input.body, key), `${scope}:definition`);
  const sourceSave=useMutation(async(input:{id?:string;body:ReturnType<typeof sourceInput>},key:string)=>{const result=await api.client.saveSource(input.id,input.body,key);await api.refresh();return result;},`${scope}:source`,configurationError);
  const agreementSave=useMutation(async(input:{sourceId:string;id?:string;body:ReturnType<typeof agreementInput>},key:string)=>{const result=await api.client.saveAgreement(input.sourceId,input.id,input.body,key);await api.refresh();return result;},`${scope}:agreement`,configurationError);
  const retirement = useMutation(async(input:{kind:"rooms"|"room-types";id:string;body:{expected_version:number;action:"archive"|"restore"|"delete"}},key:string)=>{
    const saved=await api.client.retireDefinition(input.kind,input.id,input.body,key);
    await api.refresh();
    return saved;
  },`${scope}:retirement`);
  const multiCreate=useMutation(api.createMulti,`${scope}:multi-create`);
  const multiEdit=useMutation((input:{id:string;body:MultiEditInput},key:string)=>api.editAllocations(input.id,input.body,key),`${scope}:multi-edit`);
  const multiLife=useMutation((input:{id:string;action:string;body:{expected_version:number;allocation_id?:string;guest_has_vacated?:boolean}},key:string)=>api.roomLifecycle(input.id,input.action,input.body,key),`${scope}:multi-lifecycle`);
  const [reviewMessage, setReviewMessage] = useState("");
  const reviewed = useRef<{ id: string; version: number } | null>(null);
  const lastEdit = useRef<string | null>(null);
  if (!api.data) return null;
  const { references, reservations, guests } = api.data;
  const configuration = richConfiguration(references);
  configuration.rooms = configuration.rooms.map(room => {
    const pointer = references.rooms.find(r => r.id === room.id)?.current_occupancy_allocation_id;
    const owner = reservations.find(r => r.status === "cancelled" && (r.allocation?.id === pointer || (r.allocation===null && r.allocations.some(a=>a.id===pointer))));
    return { ...room, occupancyLockReservationId: owner?.id };
  });
  const unsupported = () => { throw new Error("This operation is not available in API mode. No records were changed."); };
  return <ReservationDemoContext.Provider value={{ mode: "api", actor: "local-development",
    capabilities: { manage_channels: references.capabilities?.includes('configuration.sources.v1')??false, edit_channel_terms: false, override_accommodation: false,
      verify_collection: false, confirm_commission: false, record_settlement: false, reconcile_settlement: false },
    reservations: reservations.map(r => richReservation(r, references)), stays: reservations.flatMap(r => presentReservation(r).stays),
    guests, configuration, settlements: [],
    setReservations: unsupported, setStays: unsupported, setGuests: unsupported, setConfiguration: unsupported, setSettlements: unsupported,
    commands: {
      saveSource:async(source,isNew)=>{const result=await sourceSave.submit({id:isNew?undefined:source.id,body:sourceInput(source,isNew)});if(!result)throw new Error('Source save was not confirmed. Your draft is retained. Review the API message or confirm the original source request.');return presentSource(result);},
      saveAgreement:async(agreement,source,isNew)=>{const result=await agreementSave.submit({sourceId:source.id,id:isNew?undefined:agreement.id,body:agreementInput(agreement,source,isNew)});if(!result)throw new Error('Agreement save was not confirmed. Your draft is retained. Review the API message or confirm the original agreement request.');},
      loadChannels:async()=>{const refs=await api.client.references();await api.refresh();return {sources:refs.booking_sources.map(presentSource),agreements:(refs.source_agreements??[]).map(presentAgreement)};},
      retireDefinition: async(kind,id,version,action)=>{
        const result=await retirement.submit({kind,id,body:{expected_version:version,action}});
        if(!result)throw new Error("Operation not confirmed. Review the API message or confirm the original retirement request.");
      },
      canEditMultiple:references.capabilities?.includes("reservation.multi-room.v1"),
      canEditCustomStays:references.capabilities?.includes("reservation.independent-stays.v1"),
      allocationLifecycle:async(original,action,allocationId)=>{const result=await multiLife.submit({id:original.id,action,body:{expected_version:original.serverVersion!,...(allocationId?{allocation_id:allocationId}:{})}});if(!result)throw new Error("Room lifecycle was not confirmed. Reload/review or retry the unchanged operation.");},
      canEditGuest: references.capabilities?.includes("reservation.guest-edit.v1"),
      canEditStay: references.capabilities?.includes("reservation.stay-edit.v1"),
      canEditAdjustments: references.capabilities?.includes("reservation.adjustments.v1"),
      canEditDiscounts: references.capabilities?.includes("reservation.manual-discounts.v1"),
      canEditPresets: references.capabilities?.includes("reservation.discount-presets.v1"),
      loadPresets: async () => richConfiguration(await api.client.references()).discounts,
      savePreset: references.capabilities?.includes("reservation.discount-presets.v1") ? async (preset, isNew) => {
        const result = await definition.submit({ kind: "discount-presets", id: isNew ? undefined : preset.id, body: {
          label:preset.label,scope:preset.scope,method:preset.method,value:preset.serverValue ?? String(preset.value),currency:"PHP",enabled:preset.enabled,
          target_room_type_id:preset.scope === "room" ? preset.targetRoomTypeId ?? null : null,target_product_id:preset.scope === "item" ? preset.targetItemId ?? null : null,
          ...(preset.method === "final_price" ? {value:"0",replacement_unit_amount_minor:preset.scope === "item" ? preset.serverReplacementMinor : null,rate_prices:preset.scope === "room" ? preset.serverRatePrices : []} : {}),
          ...(!isNew ? {expected_version:preset.serverVersion} : {}),
        }});
        if (!result) throw new Error("Preset save was not confirmed. Your draft is retained. " + (definition.error || "Review the API error before retrying."));
      } : undefined,
      canEditExtraCharges: references.capabilities?.includes("reservation.extra-charges.v1"),
      canEditInclusions: references.capabilities?.includes("reservation.inclusions.v1"),
      canEditBreakfast: references.capabilities?.includes("reservation.breakfast.v1"),
      loadBreakfast: async () => {
        const latest = await api.client.references();
        return { version: latest.company.breakfast_version!, items: (latest.breakfast_eligible_items ?? []).map(i => ({ inventoryItemId: i.product_id, kind: i.kind, enabled: i.enabled })) };
      },
      saveBreakfast: references.capabilities?.includes("reservation.breakfast.v1") ? async (items, version) => {
        const result = await definition.submit({ kind: "breakfast", body: { expected_version: version, items: items.map(i => ({ product_id: i.inventoryItemId, kind: i.kind, enabled: i.enabled })) } });
        if (!result) throw new Error("Breakfast configuration save was not confirmed. Your draft is retained. " + (definition.error || "Review the API error before retrying."));
      } : undefined,
      canEditPurchases: references.capabilities?.includes("reservation.purchases.v1"),
      canEditRoomStatus: references.capabilities?.includes("room.status.v1"),
      error: retirement.error || create.error || patch.error || guest.error || lifecycle.error || readiness.error || definition.error || multiCreate.error || multiEdit.error || multiLife.error,
      busy: sourceSave.pending || agreementSave.pending || retirement.pending || lifecycle.pending || readiness.pending || definition.pending || create.pending || patch.pending || guest.pending || multiCreate.pending || multiEdit.pending || multiLife.pending || api.refreshing,
      saveDefinition: references.capabilities?.includes("configuration.definitions.v1") ? async (section, id, values, version, defaultInclusions) => {
        const result = await definition.submit(definitionIntent(section, id, values, configuration, version, defaultInclusions));
        if (!result) throw new Error("Configuration save was not confirmed. Your draft is retained. " + (definition.error || "Resolve the API error before retrying."));
      } : undefined,
      readiness: references.capabilities?.includes("room.readiness.v1") ? async (room, state) => {
        if (!room.serverVersion) throw new Error("Reload room data before changing readiness.");
        const saved = await readiness.submit({ id: room.id, body: { expected_version: room.serverVersion, housekeeping: state } });
        if (!saved) throw new Error("Readiness change was not confirmed. Reload/review stale state or retry the unchanged action.");
      } : undefined,
      lifecycle: references.capabilities?.includes("reservation.lifecycle.v1") ? async (original, action, vacated) => {
        const body: LifecycleInput = { expected_version: original.serverVersion! };
        if (action === "cancel") body.guest_has_vacated = vacated;
        const result = original.aggregateStatus ? await multiLife.submit({id:original.id,action,body}) : await lifecycle.submit({ id: original.id, action, body });
        if (!result) throw new Error("Lifecycle change was not confirmed. " + (lifecycle.error || "Refresh/review conflicts or retry the unchanged command."));
      } : undefined,
      conflict: patch.conflict || multiEdit.conflict,
      reviewMessage,
      reviewLatest: async () => {
        if (!lastEdit.current) return;
        try {
          const latest = await api.loadReservation(lastEdit.current);
          reviewed.current = { id: latest.id, version: latest.version };
          if(latest.allocation===null)setReviewMessage(`Latest version ${latest.version}: ${latest.allocations.filter(a=>!a.removed_at).map(a=>`room ${a.room_number}: ${formatHotelDate(apiInstant(a.scheduled_start),{dateStyle:"short",timeStyle:"short"})} to ${formatHotelDate(apiInstant(a.scheduled_end),{dateStyle:"short",timeStyle:"short"})}, ${a.state}, ${a.adults} adults, ${a.children} children`).join('; ')}. Your room/financial draft is unchanged. Review before saving.`);
          else setReviewMessage(`Latest server version ${latest.version}: guest ${latest.guest.name}; room ${latest.pricing.snapshot.lines[0].room_number}; arrival ${latest.allocation.scheduled_start}; duration ${latest.allocation.duration_id}; note “${latest.note}”; adults ${latest.allocation.adults}, children ${latest.allocation.children}. discounts ${latest.pricing.snapshot.discounts?.map(d => `${d.label}: ${d.method} ${d.value}`).join(", ") || "none"}; total PHP ${(latest.pricing.snapshot.total_minor / 100).toFixed(2)}. Your draft is unchanged. Review it before saving again.`);
          patch.reviewedLatest();multiEdit.reviewedLatest();
          if (latest.pricing.snapshot.price_overrides?.length) setReviewMessage(current => `${current} Captured unit prices: ${latest.pricing.snapshot.price_overrides!.map(o=>`${o.label}: PHP ${(o.original_unit_amount_minor/100).toFixed(2)} to ${(o.replacement_unit_amount_minor/100).toFixed(2)} x ${o.quantity}`).join(", ")}.`);
        } catch (error) { setReviewMessage(error instanceof Error ? error.message : "Unable to load latest version. No retry authorized."); }
      },
      create: async input => {
        if((input.rooms?.length??0)>1||input.rooms?.some(r=>r.useReservationStay===false)){const result=await multiCreate.submit(multiReservationInput(input,references));if(!result)throw new Error("Multi-room reservation was not confirmed. Your draft is retained; resolve the API error and retry unchanged.");return richReservation(result,references);}

        const room = references.rooms.find(r => r.number === input.roomNumber);
        if (!room) throw new Error("Select a server-owned room.");
        const body: CreateInput = { guest_id: input.guestId, booking_source_id: input.bookingSourceId, room_id: room.id,
          ...(input.adjustments?.length ? { adjustments: input.adjustments.map(a => ({ id: a.id, amount_minor: toMinorUnits(a.amount, "PHP"), reason: a.reason })) } : {}),
          ...(input.breakfast ? { breakfast: breakfastInputs(input.breakfast) } : {}),
          ...(input.inclusions ? { inclusions: input.inclusions.map(i => ({ product_id: i.catalogId, quantity: i.quantity, ...(i.overridden ? { overridden: true } : {}) })) } : {}),
          duration_id: input.durationId, scheduled_start: input.start.toISOString(), adults: input.adults, children: input.children, note: input.note, ...(input.discounts?.length ? { discounts: manualDiscountInputs(input.discounts, room.id) } : {}), ...(input.charges?.length ? { charges: input.charges.map(c => ({ id: c.id, product_id: c.catalogId, quantity: c.quantity, usage: c.usage ?? "extra_charge" })) } : {}) };
        const result = await create.submit(body);
        if (!result) throw new Error("Reservation was not confirmed. Resolve the API error below and retry the same draft.");
        return richReservation(result, references);
      },
      patch: async (original, input) => {
        lastEdit.current = original.id;
        const canonical=reservations.find(r=>r.id===original.id);
        if(original.aggregateStatus||(input.rooms?.length??0)>1||input.rooms?.some(r=>r.useReservationStay===false)){
          if(!canonical)throw new Error("Reload the canonical reservation before editing.");
          if(!hasMultiChanges(original,input)){
            if(multiEdit.uncertain)throw new Error("Resolve the original room edit before closing this draft.");
            return richReservation(canonical,references);
          }
          const body={...multiReservationInput(input,references,original,canonical),expected_version:reviewed.current?.id===original.id?reviewed.current.version:original.serverVersion!};
          const result=await multiEdit.submit({id:original.id,body});if(!result)throw new Error("Room edit was not confirmed. Your draft is retained; review the server conflict before retrying.");reviewed.current=null;return richReservation(result,references);
        }
        const commandBody = reservationEditInput(original, input, singleCanonical(canonical), references,
          reviewed.current?.id === original.id ? reviewed.current.version : original.serverVersion!);
        if (!commandBody) return original;
        const result = await patch.submit({ id: original.id, body: commandBody });
        if (!result) throw new Error("Edit was not confirmed. Your draft is retained. Resolve the API error below before retrying.");
        reviewed.current = null;
        return richReservation(result, references);
      },
      createGuest: async input => {
        const result = await guest.submit(input as GuestInput);
        if (!result) throw new Error("Guest was not confirmed. Keep the same details and retry after resolving the API error.");
        return result;
      },
    },
  }}>
    {(sourceSave.error||agreementSave.error)&&<div role="alert" className="m-4 rounded-xl border border-rose-300 p-4">{sourceSave.error||agreementSave.error}
      {sourceSave.uncertain&&<button onClick={()=>void sourceSave.retryOriginal()}>Confirm original source request</button>}
      {agreementSave.uncertain&&<button onClick={()=>void agreementSave.retryOriginal()}>Confirm original agreement request</button>}
    </div>}
    {retirement.error && <div role="alert" className="m-4 rounded-xl border border-rose-300 p-4">{retirement.error}
      {retirement.uncertain && <button onClick={()=>void retirement.retryOriginal()}>Confirm original retirement request</button>}
      {!retirement.uncertain && <button onClick={()=>void api.refresh()}>Reload configuration</button>}
    </div>}
    {reviewMessage && <p role="status" className="m-4 rounded-xl border bg-sky-50 p-3">{reviewMessage}</p>}
    {(create.error || patch.error || guest.error || lifecycle.error || readiness.error || definition.error || multiCreate.error || multiEdit.error || multiLife.error) && <div role="alert" className="m-4 rounded-xl border border-rose-300 bg-rose-50 p-4">
      {create.error || patch.error || guest.error || lifecycle.error || readiness.error || definition.error || multiCreate.error || multiEdit.error || multiLife.error}
      {multiCreate.uncertain && <button className="ml-3 underline" onClick={()=>{
        if(document.querySelector('[role="dialog"][aria-label="Create reservation"]')){
          setReviewMessage("Use Create Reservation in the unchanged draft to confirm its original request, or close it before recovering here.");return;
        }
        void multiCreate.retryOriginal();
      }}>Confirm original multi-room request</button>}
      {multiEdit.uncertain && <button className="ml-3 underline" onClick={()=>{
        if(document.querySelector('[role="dialog"][aria-label="Edit reservation"]')){
          setReviewMessage("Use Save Changes in the unchanged draft to confirm its original room edit, or close it before recovering here.");return;
        }
        void multiEdit.retryOriginal();
      }}>Confirm original room edit request</button>}
      {multiLife.uncertain && <button className="ml-3 underline" onClick={()=>void multiLife.retryOriginal()}>Confirm original room lifecycle request</button>}
      {definition.uncertain && <button className="ml-3 underline" onClick={() => void definition.retryOriginal()}>Confirm original configuration request</button>}
      {readiness.uncertain && <button className="ml-3 underline" onClick={() => void readiness.retryOriginal()}>Confirm original readiness request</button>}
      {lifecycle.uncertain && <button className="ml-3 underline" onClick={() => void lifecycle.retryOriginal()}>Confirm original lifecycle request</button>}
      {create.uncertain && <button className="ml-3 underline" onClick={() => {
        if (document.querySelector('[role="dialog"][aria-label="Create reservation"]')) {
          setReviewMessage("Use Create Reservation in the open, unchanged draft to confirm its original request, or close it before recovering here."); return;
        }
        void create.retryOriginal();
      }}>Confirm original reservation request</button>}
      {patch.uncertain && <button className="ml-3 underline" onClick={() => {
        if (document.querySelector('[role="dialog"][aria-label="Edit reservation"]')) {
          setReviewMessage("Use Save Changes in the open, unchanged draft to confirm its original edit, or close it before recovering here."); return;
        }
        void patch.retryOriginal();
      }}>Confirm original edit request</button>}
      {guest.uncertain && <button className="ml-3 underline" onClick={() => {
        if (document.querySelector('[role="dialog"]')) {
          setReviewMessage("Retry the unchanged guest details in the open pane, or close it before recovering here."); return;
        }
        void guest.retryOriginal();
      }}>Confirm original guest request</button>}
    </div>}
    {children}
  </ReservationDemoContext.Provider>;
}
