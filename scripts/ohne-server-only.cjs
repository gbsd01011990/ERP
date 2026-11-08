// Für Skripte und Tests außerhalb von Next.js: "server-only" durch ein leeres Modul ersetzen.
const Module = require("node:module");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return require.resolve("./leer.cjs");
  return original.call(this, request, ...rest);
};
