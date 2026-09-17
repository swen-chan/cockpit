import "server-only";

import type { WorkspaceDirectory, WorkspaceFile } from "@/contracts/cockpit";
import { readWorkspaceDirectory, readWorkspacePreview } from "@/server/adapters/files";
import { resolveCockpitRuntimeConfig } from "@/server/config/runtime";
import { toSafeDiagnostic, type SafeDiagnostic } from "@/server/security/errors";
import { assertSourceReadAllowed } from "@/server/security/prerender-guard";

export interface LoadFilesOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  workspaceRoot?: string;
}

export interface FilesPageData {
  directory: WorkspaceDirectory;
  initialFile: WorkspaceFile | null;
  directoryFailure?: SafeDiagnostic | undefined;
  previewFailure?: SafeDiagnostic | undefined;
}

function workspaceRoot(options: LoadFilesOptions): string {
  if (options.workspaceRoot !== undefined) return options.workspaceRoot;
  return resolveCockpitRuntimeConfig(options.environment ?? process.env).workspaceRoot;
}

export async function loadWorkspaceDirectory(
  relativePath: string = "",
  options: LoadFilesOptions = {},
): Promise<WorkspaceDirectory> {
  return readWorkspaceDirectory(workspaceRoot(options), relativePath, options.now ?? new Date());
}

export async function loadWorkspacePreview(
  relativePath: string,
  options: LoadFilesOptions = {},
): Promise<WorkspaceFile> {
  return readWorkspacePreview(workspaceRoot(options), relativePath);
}

export async function loadFilesPageData(options: LoadFilesOptions = {}): Promise<FilesPageData> {
  assertSourceReadAllowed();
  const now = options.now ?? new Date();
  let directory: WorkspaceDirectory;
  try {
    directory = await loadWorkspaceDirectory("", { ...options, now });
  } catch (error) {
    return {
      directory: {
        path: "",
        parentPath: null,
        items: [],
        observedAt: now.toISOString(),
        truncated: false,
      },
      initialFile: null,
      directoryFailure: toSafeDiagnostic(error, "workspace", now),
    };
  }

  const firstFile = directory.items.find((entry) => entry.entryType === "file");
  if (!firstFile) return { directory, initialFile: null };
  try {
    return {
      directory,
      initialFile: await loadWorkspacePreview(firstFile.path, options),
    };
  } catch (error) {
    return {
      directory,
      initialFile: firstFile,
      previewFailure: toSafeDiagnostic(error, "workspace", now),
    };
  }
}
