import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileBrowser } from "@/features/files/file-browser";

const observedAt = "2026-09-16T08:00:00.000Z";

describe("Codex Files browser", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("uses only the scoped Codex API for metadata-only files and empty directories", async () => {
    window.history.replaceState({}, "", "/agents/codex/files");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requestPath = String(input);
      if (requestPath === "/api/agents/codex/files/preview?path=metadata.bin") {
        return {
          ok: true,
          json: async () => ({
            panelId: "codex",
            runtime: "codex",
            data: {
              id: "metadata.bin",
              name: "metadata.bin",
              path: "metadata.bin",
              entryType: "file",
              kind: "Unsupported file",
              size: "3 B",
              sizeBytes: 3,
              modifiedAt: observedAt,
              previewState: "metadata-only",
            },
          }),
        };
      }
      if (requestPath === "/api/agents/codex/files?path=empty-directory") {
        return {
          ok: true,
          json: async () => ({
            panelId: "codex",
            runtime: "codex",
            data: {
              path: "empty-directory",
              parentPath: "",
              items: [],
              observedAt,
              truncated: false,
            },
          }),
        };
      }
      throw new Error(`Unexpected request: ${requestPath}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FileBrowser
        initialDirectory={{
          path: "",
          parentPath: null,
          observedAt,
          truncated: false,
          items: [
            {
              id: "empty-directory",
              name: "empty-directory",
              path: "empty-directory",
              entryType: "directory",
              kind: "Directory",
              size: "—",
              sizeBytes: null,
              modifiedAt: observedAt,
              previewState: "unavailable",
            },
            {
              id: "metadata.bin",
              name: "metadata.bin",
              path: "metadata.bin",
              entryType: "file",
              kind: "Unsupported file",
              size: "3 B",
              sizeBytes: 3,
              modifiedAt: observedAt,
              previewState: "metadata-only",
            },
          ],
        }}
        initialFile={null}
        panelId="codex"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /metadata\.bin/u }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Preview not available" })).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/agents/codex/files/preview?path=metadata.bin",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByRole("complementary", { name: "File metadata" })).toHaveTextContent(
      "metadata-only",
    );

    fireEvent.click(screen.getByRole("button", { name: /empty-directory/u }));
    await waitFor(() =>
      expect(
        screen.getByText("The approved directory contains no visible entries.", { exact: true }),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/agents/codex/files?path=empty-directory",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    expect(
      screen.getByLabelText("Current workspace directory empty-directory"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Hermes/u)).not.toBeInTheDocument();
  });
});
