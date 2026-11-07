import { NextResponse, type NextRequest } from "next/server";

// Grobe Vorprüfung: ohne Sitzungs-Cookie direkt zum Login.
// Die echte Prüfung der Sitzung passiert serverseitig in benutzerPflicht().
export function middleware(req: NextRequest) {
  if (!req.cookies.has("erp_sitzung")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next|favicon.ico|api/webhooks).*)"],
};
