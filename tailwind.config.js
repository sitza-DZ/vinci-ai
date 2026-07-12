/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        neonMagenta: "#FF4DFF",
        neonCyan: "#00E5FF",
        bgDark: "#0A0D13",
        bgDarker: "#07090D",
        neonGlow: "#2FD0C4",
      },
      fontFamily: {
        display: ["Orbitron", "sans-serif"],
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};