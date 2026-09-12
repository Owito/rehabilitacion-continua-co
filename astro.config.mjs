// @ts-check
import { defineConfig } from 'astro/config';

// Sitio publicado en GitHub Pages bajo la cuenta personal fgoguerra.
// Si luego se usa dominio propio, cambiar `site` y poner `base: '/'`.
export default defineConfig({
  build: {
    // La hoja de estilos pesa ~8 KB: en línea evita una petición bloqueante en cada visita.
    inlineStylesheets: 'always',
  },
  site: 'https://owito.github.io',
  base: '/rehabilitacion-continua-co',
  trailingSlash: 'ignore',
});
