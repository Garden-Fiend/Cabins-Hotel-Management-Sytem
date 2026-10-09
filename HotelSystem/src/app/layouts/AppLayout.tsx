import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";

const navigation = [
  { to: "/", label: "Dashboard" },
  { to: "/reservations", label: "Reservations" },
  { to: "/rooms", label: "Rooms" },
  { to: "/guests", label: "Guests" },
  { to: "/configuration", label: "Configuration" },
  { to: "/inventory", label: "Inventory" },
];

export function AppLayout() {
  const [isNavigationCollapsed, setIsNavigationCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside
          className={`shrink-0 bg-slate-900 text-slate-100 ${
            isNavigationCollapsed ? "w-full md:w-16" : "w-full md:w-64"
          }`}
        >
          <div
            className={`flex items-center border-b border-slate-700 ${
              isNavigationCollapsed
                ? "justify-center px-2 py-3"
                : "justify-between px-6 py-5"
            }`}
          >
            {!isNavigationCollapsed && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Hotel System
                </p>
                <h1 className="mt-2 text-xl font-semibold text-white">
                  Operations
                </h1>
              </div>
            )}
            <button
              type="button"
              aria-label={
                isNavigationCollapsed ? "Expand navigation" : "Collapse navigation"
              }
              aria-expanded={!isNavigationCollapsed}
              title={isNavigationCollapsed ? "Expand navigation" : "Collapse navigation"}
              onClick={() => setIsNavigationCollapsed((collapsed) => !collapsed)}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                className={`size-5 transition-transform ${
                  isNavigationCollapsed ? "rotate-180" : ""
                }`}
              >
                <path
                  d="m12.5 4.5-5 5.5 5 5.5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
          </div>

          <nav
            aria-label="Main navigation"
            className={
              isNavigationCollapsed
                ? "grid grid-cols-5 gap-1 p-2 md:grid-cols-1"
                : "space-y-2 p-4"
            }
          >
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                aria-label={item.label}
                title={isNavigationCollapsed ? item.label : undefined}
                className={({ isActive }) =>
                  [
                    "block rounded-lg py-2 text-sm font-medium transition-colors",
                    isNavigationCollapsed
                      ? "px-1 text-center md:px-2"
                      : "px-3",
                    isActive
                      ? "bg-slate-700 text-white"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white",
                  ].join(" ")
                }
              >
                {isNavigationCollapsed ? (
                  <span aria-hidden="true" className="md:hidden">
                    {item.label.slice(0, 1)}
                  </span>
                ) : null}
                <span className={isNavigationCollapsed ? "hidden md:inline" : ""}>
                  {isNavigationCollapsed ? item.label.slice(0, 1) : item.label}
                </span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Property Overview
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                Hotel Management
              </h2>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                Admin User
              </span>
              <Link
                to="/login"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Login
              </Link>
            </div>
          </header>

          <main className="min-w-0 overflow-x-auto p-4 sm:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
