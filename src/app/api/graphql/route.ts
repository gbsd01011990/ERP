import { yoga } from "@/graphql/server";

// Next.js-Route: GET (GraphiQL, Abfragen per URL) und POST (Standard) gehen an Yoga.
const handler = (request: Request) => yoga.handleRequest(request, {});

export { handler as GET, handler as POST, handler as OPTIONS };
