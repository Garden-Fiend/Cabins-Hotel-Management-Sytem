import { expect, it } from "vitest";
import { breakfastInputs, breakfastIdentity, mergeBreakfastInputs } from "./breakfastInputs";
import { reservationEditInput } from "./reservationEditInput";
import type { ReservationSnapshot } from "../../types/reservation";
import type { ReservationDto, ReferencesDto } from "./contracts";

it("sends selection intent without labels, quantity or client prices and clears skipped recipes", () => {
  expect(breakfastInputs([{ stayDate: "2026-12-21", guestNumber: 1, status: "included", mealId: "meal", beverageId: "drink", mealLabel: "Forged", unitPrice: 0 }])).toEqual([{ service_date: "2026-12-21", guest_number: 1, status: "included", meal_id: "meal", beverage_id: "drink" }]);
  expect(breakfastInputs([{ stayDate: "2026-12-21", guestNumber: 1, status: "skipped", mealId: "meal" }])).toEqual([{ service_date: "2026-12-21", guest_number: 1, status: "skipped" }]);
});

it("merges reviewed local slot edits while preserving untouched remote selections", () => {
  const original = [{ service_date: "2026-12-21", guest_number: 1, status: "included" as const, meal_id: "meal", beverage_id: "drink" }];
  const current = [...original, { service_date: "2026-12-22", guest_number: 1, status: "skipped" as const }].map(i=>({...i,quantity:1 as const,unit_amount_minor:0 as const,amount_minor:0 as const}));
  expect(mergeBreakfastInputs(original, [{ ...original[0], meal_id: "new" }], current)).toEqual([{...original[0],meal_id:"new"},{service_date:"2026-12-22",guest_number:1,status:"skipped"}]);
  expect(breakfastIdentity([...original].reverse())).toBe(breakfastIdentity(original));
});

it("uses a versioned breakfast command with no client financial facts", () => {
  const original = { id:"booking",guestId:"guest",note:"",discounts:[],adjustments:[],rooms:[{roomNumber:"101",adults:1,children:0,charges:[],inclusions:[],breakfast:[],checkIn:new Date(2026,11,20),durationId:"night"}] } as unknown as ReservationSnapshot;
  const canonical = {id:"booking",guest:{id:"guest"},allocation:{room_id:"room",adults:1,children:0,breakfast:[]},pricing:{snapshot:{}}} as unknown as ReservationDto;
  const refs = { capabilities:["reservation.breakfast.v1"] } as ReferencesDto;
  const input = {note:"",adults:1,children:0,breakfast:[{stayDate:"2026-12-21",guestNumber:1,status:"skipped" as const}],breakfastDates:["2026-12-21"]};
  expect(reservationEditInput(original,input,canonical,refs,2)).toEqual({expected_version:2,guest_id:"guest",breakfast:[{service_date:"2026-12-21",guest_number:1,status:"skipped"}]});
  expect(()=>reservationEditInput(original,input,canonical,{...refs,capabilities:[]},2)).toThrow("Breakfast");
});

it("retains the draft instead of silently discarding an edited breakfast excluded by reviewed remote counts", () => {
  const original = { id:"booking",guestId:"guest",note:"",discounts:[],adjustments:[],rooms:[{roomNumber:"101",adults:1,children:1,charges:[],inclusions:[],breakfast:[],checkIn:new Date(2026,11,20),durationId:"night"}] } as unknown as ReservationSnapshot;
  const canonical = {id:"booking",guest:{id:"guest"},allocation:{room_id:"room",adults:1,children:0,breakfast:[]},pricing:{snapshot:{}}} as unknown as ReservationDto;
  const refs = { capabilities:["reservation.breakfast.v1"] } as ReferencesDto;
  const input = {note:"",adults:1,children:1,breakfast:[{stayDate:"2026-12-21",guestNumber:2,status:"included" as const,mealId:"meal",beverageId:"drink"}],breakfastDates:["2026-12-21"]};
  expect(()=>reservationEditInput(original,input,canonical,refs,2)).toThrow(/guest count/);
});
