import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { useSessionStore } from "@/stores/session";

export default function App() {
  const unlocked = useSessionStore((s) => s.unlocked);
  const check = useSessionStore((s) => s.check);

  useEffect(() => {
    if (unlocked) return;
    void check();
  }, [unlocked, check]);

  return <RouterProvider router={router} />;
}
