import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#050505",
        panel: "#0a0a0a",
        message: "#111111",
        line: "#222222",
        brand: "#008F7A",
        danger: "#D9534F",
        bright: "#E0E0E0",
        dim: "#888888",
        mute: "#444444"
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "JetBrains Mono",
          "Cascadia Code",
          "Source Code Pro",
          "Menlo",
          "Consolas",
          "monospace"
        ]
      }
    }
  },
  plugins: []
};

export default config;
