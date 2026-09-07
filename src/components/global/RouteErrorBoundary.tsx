import { useNavigate, useRouteError, isRouteErrorResponse, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, StatePanel } from "@/components/ui";

/**
 * S-004 error state (SCREENS-SPEC): "shell-level ErrorBoundary with recover/reload".
 * Wired as `errorElement` on every top-level route — a render crash in any screen
 * renders this panel instead of a blank webview.
 *
 * Classification (ERROR-HANDLING §1): a thrown `BridgeError` keeps its typed code;
 * router-level error responses keep their status; anything else is `INTERNAL`
 * (unexpected, retryable). This is a render-crash surface, not the §3.7 command
 * aggregation path — the two are deliberately separate.
 */
export function RouteErrorBoundary() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const error = useRouteError();

  let code = "INTERNAL";
  let userMessage = t("errors.boundaryMessage");
  if (isRouteErrorResponse(error)) {
    userMessage =
      `${error.status} ${error.statusText}`.trim() === ""
        ? userMessage
        : `${error.status} ${error.statusText}`;
  } else if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    code = (error as { code: string }).code;
    const msg = (error as { userMessage?: unknown }).userMessage;
    if (typeof msg === "string" && msg !== "") userMessage = msg;
  }

  return (
    <div
      role="alert"
      data-screen-state="error"
      data-testid="route-error-boundary"
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-oneapp)] p-8"
    >
      <StatePanel state="error" message={userMessage} errorCode={code} />
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" onClick={() => window.location.reload()}>
          {t("errors.boundaryReload")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate("/app/dashboard", { replace: true })}
        >
          {t("errors.boundaryRecover")}
        </Button>
        <Link
          to="/app/help/errors"
          className="rounded px-3 py-1.5 text-xs font-medium text-[var(--color-oneprimary)] underline-offset-2 hover:underline"
        >
          {t("errors.boundaryHelp")}
        </Link>
      </div>
    </div>
  );
}
