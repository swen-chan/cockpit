import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const loopbackHostPattern = /^127\.0\.0\.1(?::([1-9][0-9]{0,4}))?$/u;

export function isApprovedLoopbackHost(host: string | null): host is string {
  if (host === null) return false;
  const match = loopbackHostPattern.exec(host);
  if (!match) return false;
  return match[1] === undefined || Number(match[1]) <= 65_535;
}

export function isApprovedOrigin(host: string, origin: string | null): boolean {
  return origin === null || origin === `http://${host}`;
}

export function isUnexpectedCrossSiteRequest(headers: Headers): boolean {
  return headers.get("sec-fetch-site") === "cross-site"
    && headers.get("sec-fetch-mode") === "no-cors";
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  if (!isApprovedLoopbackHost(host)
    || !isApprovedOrigin(host, request.headers.get("origin"))
    || isUnexpectedCrossSiteRequest(request.headers)) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return NextResponse.next();
}
