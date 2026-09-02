import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { useSessionStore } from "@/stores/session";
import { useSettingsStore, watchSystemTheme } from "@/stores/settings";

export default function App() {
  const unlocked = useSessionStore((s) => s.unlocked);
  const check = useSessionStore((s) => s.check);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);

  useEffect(() => {
    if (unlocked) return;
    void check();
  }, [unlocked, check]);

  useEffect(() => {
    void hydrateSettings();
    return watchSystemTheme();
  }, [hydrateSettings]);

  return <RouterProvider router={router} />;
}
