import { useEffect } from "react";
import { useAssumptionStore } from "@/stores/assumptions";
import { StatePanel, Button } from "@/components/ui";
export function AssumptionsPage() {
  const load = useAssumptionStore((x) => x.load);
  const s = useAssumptionStore();
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Assumption Register</h1>
      {s.status === "loading" && <StatePanel state="loading" message="Loading assumptions" />}
      {s.status === "error" && (
        <StatePanel
          state="error"
          message={s.error?.userMessage ?? "Assumptions could not be loaded."}
          onRetry={() => void s.load()}
        />
      )}{" "}
      {s.status === "empty" && (
        <StatePanel state="empty" message="Add assumptions (e.g., wage_inflation 4%)." />
      )}
      {(s.status === "success" || s.status === "populated") && (
        <table>
          <caption className="sr-only">Assumption register</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th>Unit</th>
              <th>Owner</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {s.assumptions.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.unit ?? "—"}</td>
                <td>{a.owner}</td>
                <td>{a.source ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Button
        onClick={() =>
          void s.upsert({
            name: "new_assumption",
            unit: null,
            owner: "Finance",
            source: null,
            values: {},
          })
        }
      >
        Add assumption
      </Button>
    </main>
  );
}
