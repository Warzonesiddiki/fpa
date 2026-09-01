import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { WizardPage } from "@/pages/s002-wizard";

/** S-002 renders inside the app router (the success path navigates to S-010, S-002 spec).
 *  The dashboard route is a marker element so navigation is assertable without loading
 *  the full shell (B18-3: test-only). */
export function renderWizard(initialEntry = "/wizard") {
  const router = createMemoryRouter(
    [
      { path: "/wizard", element: <WizardPage /> },
      { path: "/app/dashboard", element: <div>Dashboard S-010</div> },
      { path: "*", element: <div>unexpected route</div> },
    ],
    { initialEntries: [initialEntry] },
  );
  return { ...render(<RouterProvider router={router} />), router };
}
