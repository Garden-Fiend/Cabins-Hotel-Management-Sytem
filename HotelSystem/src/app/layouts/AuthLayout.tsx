import { Outlet } from "react-router-dom";

export function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            Hotel System
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            Welcome back
          </h1>
        </div>

        <Outlet />
      </div>
    </div>
  );
}
