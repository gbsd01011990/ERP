import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { marke: { DEFAULT: "#2f5d3a", hell: "#e8f0ea", dunkel: "#1f3f27" } },
    },
  },
} satisfies Config;
