// @ts-check
import { defineConfig } from 'astro/config';

// Sitio publicado en GitHub Pages bajo la cuenta personal fgoguerra.
// Si luego se usa dominio propio, cambiar `site` y poner `base: '/'`.
export default defineConfig({
  site: 'https://owito.github.io',
  base: '/rehabilitacion-continua-co',
  trailingSlash: 'ignore',
});
