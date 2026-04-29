/**
 * Logs PocketBase errors with the per-field validation `.response.data`
 * detail surfaced — otherwise a "Failed to create record" hides the
 * real cause.
 */
export function warn(label: string, err: unknown) {
  type PBErr = {
    message?: string;
    response?: { data?: unknown; message?: string };
    data?: unknown;
    status?: number;
  };
  const e = err as PBErr | undefined;
  console.warn(
    `[llm-canvas] ${label}`,
    e?.message ?? err,
    'status=', e?.status,
    'detail=', e?.response?.data ?? e?.data ?? null,
  );
}
