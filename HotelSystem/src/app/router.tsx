import { createBrowserRouter } from "react-router-dom";

import { AppLayout } from "./layouts/AppLayout";
import { AuthLayout } from "./layouts/AuthLayout";
import { DashboardPage } from "../pages/DashboardPage";
import { GuestsPage } from "../pages/GuestsPage";
import { LoginPage } from "../pages/LoginPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ReservationsPage } from "../pages/ReservationsPage";
import { RoomsPage } from "../pages/RoomsPage";
import { ConfigurationPage } from "../pages/ConfigurationPage";
import { InventoryPage } from "../pages/InventoryPage";
import { ReservationDetailPage } from "../pages/ReservationDetailPage";
import { ReservationPrintPage } from "../pages/ReservationPrintPage";

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [{ path: "/login", element: <LoginPage /> }],
  },
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "/reservations", element: <ReservationsPage /> },
      { path: "/reservations/:reservationId/print", element: <ReservationPrintPage /> },
      { path: "/reservations/:reservationId", element: <ReservationDetailPage /> },
      { path: "/rooms", element: <RoomsPage /> },
      { path: "/guests", element: <GuestsPage /> },
      { path: "/configuration", element: <ConfigurationPage /> },
      { path: "/inventory", element: <InventoryPage /> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);
