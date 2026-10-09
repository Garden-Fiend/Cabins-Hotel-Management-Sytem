import { RouterProvider } from "react-router-dom";

import { ReservationDemoProvider } from "./ReservationDemoContext";
import { router } from "./router";

export default function App() {
  return (
    <ReservationDemoProvider>
      <RouterProvider router={router} />
    </ReservationDemoProvider>
  );
}
