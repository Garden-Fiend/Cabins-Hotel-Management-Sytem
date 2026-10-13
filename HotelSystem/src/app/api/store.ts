import { createContext } from "react";
import type { ApiClient } from "./client";
import type { CreateInput, GuestDto, GuestInput, ReferencesDto, ReservationDto, LifecycleAction, LifecycleInput, DefinitionKind, DefinitionMap } from "./contracts";

export interface ApiData { references: ReferencesDto; guests: GuestDto[]; reservations: ReservationDto[] }
export interface ApiContextValue {
  client: ApiClient; data: ApiData | null; loadError: string; refreshing: boolean;
  refresh: () => Promise<void>;
  loadReservation: (id: string) => Promise<ReservationDto>;
  createGuest: (body: GuestInput, key: string) => Promise<GuestDto>;
  createReservation: (body: CreateInput, key: string) => Promise<ReservationDto>;
  patchReservation: (id: string, body: import("./reservationEditInput").ReservationEditInput, key: string) => Promise<ReservationDto>;
  lifecycleReservation: (id: string, action: LifecycleAction, body: LifecycleInput, key: string) => Promise<ReservationDto>;
  roomReadiness: (id: string, body: { expected_version: number; housekeeping: "clean" | "cleaning" }, key: string) => Promise<ReferencesDto["rooms"][number]>;
  saveDefinition: (kind: DefinitionKind, id: string | undefined, body: DefinitionMap[DefinitionKind] & { expected_version?: number }, key: string) => Promise<{ id: string; version: number }>;
}
export const ApiContext = createContext<ApiContextValue | null>(null);
