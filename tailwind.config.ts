import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Markenfarben kommen als CSS-Variablen vom Mandanten (src/lib/mandanten.ts)
      colors: { marke: { DEFAULT: "var(--marke)", hell: "var(--marke-hell)", dunkel: "var(--marke-dunkel)" }, akzent: "var(--akzent)" },
    },
  },
} satisfies Config;
