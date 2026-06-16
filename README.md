# Educación Continua en Rehabilitación Humana · Colombia

Directorio web de la oferta de educación continua en **Fisioterapia, Fonoaudiología y
Terapia Ocupacional** en Colombia. Una sola página enfocada en la **oferta vigente**, con
buscador y filtros, que se **actualiza sola cada semana**.

🌐 **En vivo:** https://owito.github.io/rehabilitacion-continua-co/

- **100% gratis** y estático en **GitHub Pages** (0 JavaScript de framework; solo unos
  scripts inline para filtros y buscador).
- **Sin APIs de pago**: la oferta se refresca **cada semana** con **GitHub Models**
  (inferencia LLM gratuita para cuentas personales) dentro de GitHub Actions.
- **Diseño neo-brutalista** (papel/tinta, bordes gruesos, sombras duras).

## Stack

| Capa | Tecnología |
|------|------------|
| Sitio | [Astro 5](https://astro.build) |
| Hosting | GitHub Pages (deploy con `withastro/action`) |
| Datos | `src/data/cursos.json` (versionado) |
| Automatización | GitHub Actions (cron semanal) + GitHub Models |

## Funcionalidades

- **Buscador** por programa / institución / tema + **filtros** por disciplina, modalidad y mes.
- **Meses dinámicos**: el título, el `<title>` y los chips de mes se derivan de los datos;
  la automatización usa una **ventana móvil** (mes actual + siguiente), así el periodo
  mostrado avanza con el calendario sin tocar código.
- **Accesibilidad**: `aria-pressed` en filtros, landmark `<main>`, `aria-hidden` en iconos
  decorativos, foco visible y `prefers-reduced-motion`.
- Botón "volver arriba" y aviso de "verificar fechas/cupos en la fuente oficial".

## Desarrollo local

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # genera dist/
npm run preview    # sirve la build
```

## Estructura

```
src/
  data/
    cursos.json          # oferta publicada = base curada + hallazgos automáticos (GENERADO)
    cursos.semilla.json  # BASE CURADA editable a mano (piso que nunca se borra)
    instituciones.json   # instituciones + URL(s) oficiales que se barren
  components/
    Directorio.astro     # única sección: buscador + filtros + tarjetas de oferta
  layouts/Layout.astro   # estilos globales (tema neo-brutalista) + <head>
  pages/index.astro      # nav + <main> con el Directorio
  utils/meses.js         # orden y rango de meses (derivados de los datos)
scripts/
  actualizar-cursos.mjs  # motor de actualización (GitHub Models)
.github/workflows/
  deploy.yml             # build + deploy a Pages (push a main / dispatch)
  actualizar.yml         # cron semanal (lunes 6 AM Colombia) + dispara el deploy
```

## Despliegue

1. Subir el código al repo y activar **GitHub Pages**: *Settings → Pages → Build and
   deployment → Source = **GitHub Actions***. El sitio queda en
   `https://<usuario>.github.io/rehabilitacion-continua-co/`.
   > Si el usuario no es `owito`, ajusta `site` en `astro.config.mjs`.
2. El workflow `deploy.yml` publica en cada push a `main` (o ejecución manual).

## Actualización automática

- **`actualizar.yml`** corre cada **lunes 6:00 AM (Colombia)** y también a mano en
  *Actions → Actualizar oferta → Run workflow*.
- Calcula la **ventana de meses** vigente (actual + siguiente), parte de la **base curada**
  (`cursos.semilla.json`, re-estampada a esa ventana), descarga cada portal oficial —incluye
  multi-URL y parseo de PDFs de Google Drive— extrae oferta con **GitHub Models**, filtra
  ruido en otros idiomas, deduplica y **suma** los hallazgos a la base. Escribe `cursos.json`,
  commitea si hubo cambios y **dispara el deploy** (un push con `GITHUB_TOKEN` no encadena
  workflows, por eso se lanza explícitamente).
- **Sin secretos**: usa el `GITHUB_TOKEN` con permiso `models: read`. GitHub Models es
  gratis para cuentas personales.

### Probar el script en local

```bash
export GITHUB_TOKEN=<token con permiso models:read>
npm run actualizar
```

## Personalización

- **Instituciones**: edita `src/data/instituciones.json` (`nombre`, `ciudad`, `disciplinas`,
  `url` o `urls`, opcional `pdf: true`).
- **Base curada**: edita `src/data/cursos.semilla.json` (programas verificados, siempre
  presentes).
- **Colores/estilo**: variables CSS (tema neo-brutalista) en `src/layouts/Layout.astro`.

## Contribuir

¿Conoces una oferta o institución que falta? Las contribuciones manuales van en la **base
curada** (`src/data/cursos.semilla.json`) e `instituciones.json`. Consulta la guía completa
con el formato exacto de cada campo y el checklist de calidad en
**[CONTRIBUTING.md](./CONTRIBUTING.md)**.

## Notas y limitaciones

- El directorio combina **base curada verificada** + **hallazgos automáticos**; la base
  garantiza que nunca quede vacío aunque varios sitios bloqueen el bot.
- Algunos portales no son extraíbles automáticamente (SPA, PDFs escaneados, certificados SSL
  incompletos); esos quedan cubiertos por la base curada.
- Sector salud: el sitio **siempre enlaza a la fuente oficial** y nunca afirma fechas, costos
  ni cupos sin verificación. Los meses son indicativos del periodo vigente.
