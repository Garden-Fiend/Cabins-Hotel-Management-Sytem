import { RouterProvider } from "react-router-dom";
import { lazy, Suspense } from "react";
import { runtimeConfiguration } from "./api/client";

import { ReservationDemoProvider } from "./ReservationDemoContext";
import { router } from "./router";
const ApiApp = lazy(() => import("./api/ApiApp"));

export default function App() {
  let configuration;
  try { configuration = runtimeConfiguration({ VITE_HMS_DATA_MODE: import.meta.env.VITE_HMS_DATA_MODE,
    VITE_HMS_API_URL: import.meta.env.VITE_HMS_API_URL }); }
  catch (error) { return <div role="alert">{error instanceof Error ? error.message : "Invalid mode configuration"}</div>; }
  if (configuration.mode === "api") return <Suspense fallback={<p role="status">Loading API mode…</p>}>
    <ApiApp baseUrl={configuration.baseUrl} />
  </Suspense>;
  return (
    <ReservationDemoProvider>
      <RouterProvider router={router} />
    </ReservationDemoProvider>
  );
}
