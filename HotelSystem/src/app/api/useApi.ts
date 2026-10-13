import { useContext } from "react";
import { ApiContext } from "./store";
export function useApi() {
  const value = useContext(ApiContext);
  if (!value) throw new Error("API provider is required; demo fallback is disabled.");
  return value;
}
