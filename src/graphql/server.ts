import "server-only";
import { createSchema, createYoga, maskError } from "graphql-yoga";
import { GraphQLError } from "graphql";
import { ZodError } from "zod";
import { aktuellerBenutzer } from "@/lib/auth";
import { benutzerAusSchluessel } from "@/lib/api-schluessel";
import { FachFehler } from "@/lib/dienste/fehler";
import { typeDefs } from "./typen.graphql";
import { resolvers, type Kontext } from "./resolver";

/** Fachliche Fehler und Eingabefehler zeigen wir; alles andere bleibt maskiert. */
function fehler(err: unknown, nachricht: string, dev?: boolean) {
  const original = err instanceof GraphQLError ? err.originalError : err;
  if (original instanceof FachFehler) {
    return new GraphQLError(original.message, { extensions: { code: original.code } });
  }
  if (original instanceof ZodError) {
    return new GraphQLError(original.issues.map((i) => `${i.path.join(".") || "eingabe"}: ${i.message}`).join("; "), {
      extensions: { code: "UNGUELTIG" },
    });
  }
  return maskError(err, nachricht, dev);
}

export const yoga = createYoga<object, Kontext>({
  schema: createSchema<Kontext>({ typeDefs, resolvers }),
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Response },
  maskedErrors: { maskError: fehler },
  // GraphiQL nur für angemeldete Browser-Sitzungen, siehe route.ts
  graphiql: { title: "ERP-Schnittstelle" },
  landingPage: false,
  context: async ({ request }): Promise<Kontext> => {
    const auth = request.headers.get("authorization") ?? "";
    if (auth.toLowerCase().startsWith("bearer ")) {
      const r = await benutzerAusSchluessel(auth.slice(7).trim());
      if (!r) throw new GraphQLError("API-Schlüssel ungültig oder widerrufen.", { extensions: { code: "NICHT_ANGEMELDET", http: { status: 401 } } });
      return { benutzer: r.benutzer, nurLesen: r.nurLesen };
    }
    // Browser-Sitzung (GraphiQL in der App)
    const b = await aktuellerBenutzer();
    if (!b) throw new GraphQLError("Anmeldung fehlt: Header 'Authorization: Bearer erp_…' senden.", { extensions: { code: "NICHT_ANGEMELDET", http: { status: 401 } } });
    return { benutzer: b, nurLesen: false };
  },
});
