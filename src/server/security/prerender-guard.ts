import "server-only";

const BUILD_SOURCE_READ_GUARD = "COCKPIT_BUILD_SOURCE_READ_GUARD";

export function assertSourceReadAllowed(): void {
  if (process.env[BUILD_SOURCE_READ_GUARD] === "1") {
    throw new Error("A local Agent source reader was invoked during the guarded production build.");
  }
}
