import {fireEvent,render,screen,within} from "@testing-library/react";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {ApiContext} from "../../app/api/store";
import type {ApiContextValue} from "../../app/api/store";
import type {BillingDocumentDto} from "../../app/api/billingDocuments";
import {checkedDocument} from "../../app/api/billingDocuments";
import {ApiError} from "../../app/api/client";
import type {ApiClient} from "../../app/api/client";
import {ReservationDemoProvider} from "../../app/ReservationDemoContext";
import {ApiBillingDocuments,BillingDocumentsSection} from "./BillingDocumentsSection";
import {BillingDocumentPrintPage} from "../../pages/BillingDocumentPrintPage";

export function billFixture(final=false):BillingDocumentDto {
 const guest={id:"guest",company_id:"company",name:"Captured guest",phone:"123",email:""};
 return {id:"bill",company_id:"company",reservation_id:"reservation",source_pricing_id:"pricing",source_reservation_version:1,document_type:"operational_bill",status:final?"finalized":"draft",number:final?"HMS-BILL-00000001":null,currency:"PHP",total_minor:118500,version:final?2:1,created_at:"2026-10-15T01:00:00Z",finalized_at:final?"2026-10-15T02:00:00Z":null,created_by:"local-development",finalized_by:final?"local-development":null,attribution:"local_development",created_request_key:"key",finalized_request_key:final?"final-key":null,capture_hash:"a".repeat(64),
 capture:{schema_version:1,reservation_reference:"HMS-1",reservation_status:"confirmed",guest,allocation_id:"allocation",scheduled_start:"2026-11-10T06:00:00Z",scheduled_end:"2026-11-10T12:00:00Z",pricing:{id:"pricing",revision:2,reservation_version:1,captured_at:"2026-10-15T01:00:00Z",snapshot:{schema_version:5,calculation_version:"direct-unit-overrides-v1",currency:"PHP",hotel_timezone:"Asia/Manila",tax_status:"not_configured",tax_minor:0,total_minor:118500,pipeline_version:2,lines:[{kind:"accommodation",room_id:"room",room_number:"101",room_type_id:"type",room_type_label:"Historical standard",duration_id:"duration",duration_source_id:"6-hours",rate_id:"rate",rate_source_id:"standard-hourly",booking_kind:"hourly",quantity:1,unit_amount_minor:110000,amount_minor:110000,currency:"PHP"}],charges:[{id:"charge",product_id:"meal",label:"Historical meal",quantity:2,usage:"purchase",unit_amount_minor:15000,amount_minor:30000,currency:"PHP"}],price_overrides:[{id:"override",preset_id:"offer",preset_version:1,label:"Captured offer",scope:"room",line_id:"room:room",target_id:"type",rate_id:"rate",currency:"PHP",original_unit_amount_minor:110000,replacement_unit_amount_minor:90000,quantity:1,effect_minor:20000,provenance:"preset_final_price",applied_at:"2026-10-15T01:00:00Z"}],price_override_total_minor:20000,discounts:[{id:"discount",label:"Captured courtesy",scope:"reservation",method:"fixed",value:"10",target_id:"",currency:"PHP",provenance:"manual",applied_at:"2026-10-15T01:00:00Z",amount_minor:1000,order:0,allocations:[{line_id:"room:room",amount_minor:1000}]}],discount_total_minor:1000,adjustments:[{id:"adjustment",amount_minor:-500,reason:"Captured correction"}]}}},
 lines:[{source_line_id:"room:room",source_kind:"accommodation",source_id:"rate",label:"Room 101 - Historical standard",quantity:1,original_unit_amount_minor:110000,effective_unit_amount_minor:90000,original_amount_minor:110000,effective_amount_minor:90000,discount_minor:1000,final_amount_minor:89000},{source_line_id:"charge",source_kind:"purchase",source_id:"meal",label:"Historical meal",quantity:2,original_unit_amount_minor:15000,effective_unit_amount_minor:15000,original_amount_minor:30000,effective_amount_minor:30000,discount_minor:0,final_amount_minor:30000}]};
}
function setup(initial:BillingDocumentDto[]=[],version=1){
 let records=initial;
 const client={baseUrl:"http://test",billingDocuments:vi.fn(async()=>records),billingDocument:vi.fn(async(id:string)=>records.find(d=>d.id===id)!),createBillingDraft:vi.fn<ApiClient["createBillingDraft"]>(async()=>{const doc=billFixture();records=[doc];return doc;}),finalizeBill:vi.fn<ApiClient["finalizeBill"]>(async()=>{const doc=billFixture(true);records=[doc];return doc;})};
 const api={client,data:{references:{company:{id:"company",name:"Current hotel"}},reservations:[{id:"reservation",version,status:"confirmed",pricing:{snapshot:{total_minor:130000}}}]},loadReservation:vi.fn(async()=>({id:"reservation",version})),refresh:vi.fn()} as unknown as ApiContextValue;
 const ui=<ApiContext.Provider value={api}><MemoryRouter><ApiBillingDocuments reservationId="reservation"/></MemoryRouter></ApiContext.Provider>;
 return {client,api,ui,setRecords:(next:BillingDocumentDto[])=>{records=next;}};
}
beforeEach(()=>{sessionStorage.clear();vi.restoreAllMocks();});
const createButton=()=>screen.getByRole("button",{name:"Create Billing Draft"});
async function review(){fireEvent.click(await screen.findByRole("button",{name:"View draft"}));return screen.findByRole("dialog",{name:"Billing Document"});}

describe("billing documents original detail integration",()=>{
 it("loads an empty list and creates a confirmed captured draft",async()=>{
  const test=setup();render(test.ui);await screen.findByText("No billing documents have been created for this reservation.");fireEvent.click(createButton());
  const dialog=await screen.findByRole("dialog",{name:"Billing Document"});expect(test.client.createBillingDraft).toHaveBeenCalledWith("reservation",{expected_reservation_version:1},expect.any(String));
  expect(within(dialog).getByText("Guest: Captured guest")).toBeTruthy();expect(within(dialog).getByText("Historical meal")).toBeTruthy();expect(within(dialog).getByText(/Final payable total/).textContent).toContain("1,185.00");expect(createButton().hasAttribute("disabled")).toBe(true);
 });
 it("prevents duplicate clicks through source loading and persistence",async()=>{
  const test=setup();let release!:()=>void;const pause=new Promise<void>(resolve=>{release=resolve;});vi.mocked(test.api.loadReservation).mockImplementation(async()=>{await pause;return {version:1} as never;});render(test.ui);await screen.findByText("No billing documents have been created for this reservation.");fireEvent.click(createButton());fireEvent.click(createButton());expect(test.api.loadReservation).toHaveBeenCalledTimes(1);release();await screen.findByRole("dialog",{name:"Billing Document"});expect(test.client.createBillingDraft).toHaveBeenCalledTimes(1);
 });
 it("requires explicit confirmation and renders a finalized read-only result",async()=>{
  const test=setup([billFixture()]);render(test.ui);const dialog=await review();fireEvent.click(within(dialog).getByRole("button",{name:"Finalize Bill"}));expect(test.client.finalizeBill).not.toHaveBeenCalled();expect(within(dialog).getByRole("alertdialog").textContent).toContain("immutable");fireEvent.click(within(dialog).getByRole("button",{name:"Confirm finalization"}));await within(dialog).findByText("Finalized · HMS-BILL-00000001");expect(within(dialog).queryByRole("button",{name:/Edit|Delete|Reopen|Finalize Bill/})).toBeNull();expect(test.client.billingDocument).toHaveBeenCalled();
 });
 it("retries an ambiguous draft using its original durable key after remount",async()=>{
  const test=setup();test.client.createBillingDraft.mockRejectedValueOnce(new ApiError("Lost response",0,"network_error",true));const view=render(test.ui);await screen.findByText("No billing documents have been created for this reservation.");fireEvent.click(createButton());await screen.findByRole("button",{name:"Retry original draft request"});const originalKey=test.client.createBillingDraft.mock.calls[0][2];view.unmount();render(test.ui);fireEvent.click(await screen.findByRole("button",{name:"Retry original draft request"}));await screen.findByRole("dialog",{name:"Billing Document"});expect(test.client.createBillingDraft.mock.calls[1][2]).toBe(originalKey);
 });
 it("retries uncertain finalization without a new key or optimistic success",async()=>{
  const test=setup([billFixture()]);test.client.finalizeBill.mockRejectedValueOnce(new ApiError("Lost response",0,"network_error",true));render(test.ui);const dialog=await review();fireEvent.click(within(dialog).getByRole("button",{name:"Finalize Bill"}));fireEvent.click(within(dialog).getByRole("button",{name:"Confirm finalization"}));await within(dialog).findByRole("button",{name:"Retry original finalization request"});expect(within(dialog).queryByText("Finalized · HMS-BILL-00000001")).toBeNull();const key=test.client.finalizeBill.mock.calls[0][2];fireEvent.click(within(dialog).getByRole("button",{name:"Retry original finalization request"}));await within(dialog).findByText("Finalized · HMS-BILL-00000001");expect(test.client.finalizeBill.mock.calls[1][2]).toBe(key);
 });
 it("handles stale source errors without changing captured contents",async()=>{
  const test=setup([billFixture()]);test.client.finalizeBill.mockRejectedValueOnce(new ApiError("Changed",409,"stale_billing_source"));render(test.ui);const dialog=await review();fireEvent.click(within(dialog).getByRole("button",{name:"Finalize Bill"}));fireEvent.click(within(dialog).getByRole("button",{name:"Confirm finalization"}));await within(dialog).findByText(/draft's reservation changed/);expect(within(dialog).getByText("Guest: Captured guest")).toBeTruthy();expect(within(dialog).queryByText("Finalized · HMS-BILL-00000001")).toBeNull();
 });
 it("keeps a confirmed finalization when its follow-up GET fails",async()=>{
  const test=setup([billFixture()]);render(test.ui);const dialog=await review();test.client.billingDocument.mockRejectedValueOnce(new ApiError("Read offline"));fireEvent.click(within(dialog).getByRole("button",{name:"Finalize Bill"}));fireEvent.click(within(dialog).getByRole("button",{name:"Confirm finalization"}));await within(dialog).findByText(/Commit confirmed, but reloading failed/);expect(within(dialog).getByText("Finalized · HMS-BILL-00000001")).toBeTruthy();expect(within(dialog).queryByRole("button",{name:"Retry original finalization request"})).toBeNull();expect(test.client.finalizeBill).toHaveBeenCalledTimes(1);
 });
 it("marks stale drafts and shows differences from current live billing",async()=>{
  const test=setup([billFixture()],2);render(test.ui);const dialog=await review();expect(within(dialog).getByText(/Current Reservation Billing:/).textContent).toContain("1,300.00");expect(within(dialog).getByText(/Current Reservation Billing:/).textContent).toContain("1,185.00");expect(within(dialog).getByRole("button",{name:"Finalize Bill"}).hasAttribute("disabled")).toBe(true);expect(createButton().hasAttribute("disabled")).toBe(false);
 });
 it("does not substitute demo or an empty list when reads fail",async()=>{
  const test=setup();test.client.billingDocuments.mockRejectedValue(new ApiError("Offline"));render(test.ui);await screen.findByText("Offline");expect(screen.queryByText("No billing documents have been created for this reservation.")).toBeNull();expect(createButton().hasAttribute("disabled")).toBe(true);
 });
 it("keeps document APIs isolated from demo mode",()=>{
  const fetch=vi.spyOn(globalThis,"fetch");render(<ReservationDemoProvider><MemoryRouter><BillingDocumentsSection reservationId="demo"/></MemoryRouter></ReservationDemoProvider>);expect(screen.getByText(/Billing documents are API-backed functionality/)).toBeTruthy();expect(screen.queryByRole("button",{name:"Create Billing Draft"})).toBeNull();expect(fetch).not.toHaveBeenCalled();
 });
 it.each([false,true])("prints captured historical values with the correct draft/final status (%s)",async final=>{
  const test=setup([billFixture(final)]);render(<ApiContext.Provider value={test.api}><MemoryRouter initialEntries={["/billing-documents/bill/print"]}><Routes><Route path="/billing-documents/:documentId/print" element={<BillingDocumentPrintPage/>}/></Routes></MemoryRouter></ApiContext.Provider>);await screen.findByText("Operational Billing Statement");expect(screen.getByText("Guest: Captured guest")).toBeTruthy();expect(screen.getByText(/Final payable total/).textContent).toContain("1,185.00");expect(screen.getByText(final?"Finalized · HMS-BILL-00000001":"DRAFT — not finalized")).toBeTruthy();expect(test.api.loadReservation).not.toHaveBeenCalled();
 });
 it("rejects invalid monetary or ownership responses",()=>{
  expect(()=>checkedDocument({...billFixture(),total_minor:1},"company","reservation",true)).toThrow("Invalid billing-document");expect(()=>checkedDocument(billFixture(),"foreign")).toThrow();
 });
});
