/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        parchment: "#f4f1e8",
        ink: "#20262a",
        ember: "#b64926",
      },
      fontFamily: {
        display: ["Georgia", "Cambria", "Times New Roman", "serif"],
        ui: ["Inter", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        panel: "0 18px 45px rgba(39, 42, 43, 0.12)",
      },
    },
  },
  plugins: [],
};
