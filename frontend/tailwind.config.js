/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      // El proyecto usa rounded-[28px] y similares; arbitrary values funcionan con
      // JIT por defecto en Tailwind 3.
    },
  },
  // Safelist para clases generadas dinámicamente con template literals
  // (ej. `bg-${color}-500`). Si después de migrar veo clases que faltan, las agrego acá.
  safelist: [
    { pattern: /^(bg|text|border|ring)-(red|amber|emerald|cyan|blue|indigo|purple|pink|slate|green)-(50|100|200|300|400|500|600|700|800|900)$/ },
    { pattern: /^(grid-cols|col-span)-(1|2|3|4|5|6|7|8|9|10|11|12)$/ },
  ],
  plugins: [],
};
