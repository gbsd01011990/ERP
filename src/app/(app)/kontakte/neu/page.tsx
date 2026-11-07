import { benutzerPflicht } from "@/lib/auth";
import { KontaktFormular } from "../kontakt-formular";

export default async function NeuerKontakt() {
  await benutzerPflicht(["ADMIN", "BUERO"]);
  return <KontaktFormular />;
}
