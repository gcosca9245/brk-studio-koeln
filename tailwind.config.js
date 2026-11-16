/** Tailwind-Konfiguration – Farben, Schrift und Raster als Design-Tokens (BRK Studio) */
module.exports = {
  content: ['./index.html', './impressum.html', './datenschutz.html', './assets/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        night: '#0A0A0A',   // Hintergrund dunkel
        paper: '#F5F5F5',   // Hintergrund hell (Off-White)
        ink: '#1A1A1A',     // Text auf Hell
        coal: '#2A2A2A',    // Flächen/Linien auf Dunkel
        iron: '#4A4A4A',    // Sekundärtext auf Hell
        ash: '#B0B0B0',     // Sekundärtext auf Dunkel
        brass: '#C9A96E',   // sehr sparsamer Akzent
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      screens: { xs: '420px' },
    },
  },
  plugins: [],
};
