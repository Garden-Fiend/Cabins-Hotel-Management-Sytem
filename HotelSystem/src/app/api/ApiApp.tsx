import { useState } from "react";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import { AppLayout } from "../layouts/AppLayout";
import { ApiClient } from "./client";
import { ApiProvider } from "./ApiProvider";
import { useApi } from "./useApi";
import { ApiUnsupported } from "../../pages/api/ApiPages";
import { DashboardPage } from "../../pages/DashboardPage";
import { ReservationsPage } from "../../pages/ReservationsPage";
import { ReservationDetailPage } from "../../pages/ReservationDetailPage";
import { ReservationPrintPage } from "../../pages/ReservationPrintPage";
import { GuestsPage } from "../../pages/GuestsPage";
import { RoomsPage } from "../../pages/RoomsPage";
import { ConfigurationPage } from "../../pages/ConfigurationPage";
import { DiscountsPage } from "../../pages/DiscountsPage";
import { InventoryPage } from "../../pages/InventoryPage";
import { ApiGuestForm } from "../../components/reservations/ApiReservationForms";
import { RichApiBridge } from "./RichApiBridge";

function ReadOnly({ children }: { children: React.ReactNode }) {
  return <><p className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-3">Configuration writes are not yet available in API mode. Missing metadata/catalog fields are unavailable; no demo fixtures are loaded.</p><fieldset disabled className="min-w-0">{children}</fieldset></>;
}
function GuestView() { return <><ApiGuestForm /><GuestsPage /></>; }
function InventoryView() {
  const api = useApi();
  return api.data?.references.capabilities?.includes("configuration.catalog.v1") ? <InventoryPage /> : <ReadOnly><InventoryPage /></ReadOnly>;
}

function ApiGate() {
  const api = useApi();
  if (!api.data) return <div className="p-6">
    <h1 className="text-xl font-bold">API mode · PostgreSQL</h1>
    {api.loadError ? <><p role="alert">{api.loadError}</p><button onClick={() => void api.refresh()}>Retry loading API data</button></>
      : <p role="status">Loading persisted hotel data…</p>}
  </div>;
  return <>
    <div className="bg-sky-100 p-3 text-sm">API mode · Saved records come from PostgreSQL. Demo data is separate.
      <button className="ml-3 underline" disabled={api.refreshing} onClick={() => void api.refresh()}>Refresh API data</button>
      {api.refreshing && <span role="status"> Refreshing…</span>}
      {api.loadError && <p role="alert">{api.loadError} Displaying the last confirmed records.</p>}
    </div>
    <RichApiBridge><Outlet /></RichApiBridge>
  </>;
}

const apiRouter = createBrowserRouter([{ element: <ApiGate />, children: [{ element: <AppLayout mode="api" />, children: [
  { index: true, element: <DashboardPage /> },
  { path: "/reservations", element: <ReservationsPage /> },
  { path: "/reservations/:reservationId", element: <ReservationDetailPage /> },
  { path: "/reservations/:reservationId/print", element: <ReservationPrintPage /> },
  { path: "/guests", element: <GuestView /> },
  { path: "/rooms", element: <RoomsPage /> },
  { path: "/configuration", element: <ConfigurationPage /> },
  { path: "/discounts", element: <DiscountsPage /> },
  { path: "/inventory", element: <InventoryView /> },
  { path: "*", element: <ApiUnsupported /> },
] }] }]);

export default function ApiApp({ baseUrl }: { baseUrl: string }) {
  const [client] = useState(() => new ApiClient(baseUrl));
  return <ApiProvider client={client}><RouterProvider router={apiRouter} /></ApiProvider>;
}
