# Educación Continua en Rehabilitación Humana · Colombia

Directorio web (landing page) de la oferta de educación continua en **Fisioterapia,
Fonoaudiología y Terapia Ocupacional** en Colombia, con foco en julio y agosto.

- **100% gratis**: sitio estático en **GitHub Pages**.
- **Sin APIs de pago**: la oferta se actualiza **automáticamente cada semana** con
  **GitHub Models** (inferencia LLM gratuita para cuentas personales) dentro de GitHub Actions.

## Stack

| Capa | Tecnología |
|------|------------|
| Sitio | [Astro 5](https://astro.build) |
| Hosting | GitHub Pages |
| Datos | `src/data/cursos.json` (versionado) |
| Automatización | GitHub Actions (cron semanal) + GitHub Models |

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
    cursos.json          # oferta de programas (lo que cambia cada semana)
    instituciones.json   # instituciones + URL oficial que se scrapea
  components/            # secciones de la landing
  layouts/Layout.astro   # estilos globales + <head>
  pages/index.astro      # ensambla la página
scripts/
  actualizar-cursos.mjs  # motor de actualización (GitHub Models)
.github/workflows/
  deploy.yml             # build + deploy a Pages (al hacer push a main)
  actualizar.yml         # cron semanal (lunes 6 AM Colombia)
```

## Despliegue (una sola vez)

1. **Crear el repo** `rehabilitacion-continua-co` en tu cuenta de GitHub y subir el código:
   ```bash
   git init
   git add .
   git commit -m "feat: directorio de educación continua en rehabilitación"
   git branch -M main
   git remote add origin https://github.com/<tu-usuario>/rehabilitacion-continua-co.git
   git push -u origin main
   ```
2. **Activar GitHub Pages**: en el repo → *Settings → Pages → Build and deployment →
   Source = **GitHub Actions***. El workflow `deploy.yml` publicará el sitio en
   `https://<tu-usuario>.github.io/rehabilitacion-continua-co/`.
   > Si tu usuario no es `fgoguerra`, ajusta `site` en `astro.config.mjs`.

## Actualización automática

- El workflow **`actualizar.yml`** corre cada **lunes a las 6:00 AM (Colombia)** y también
  puede lanzarse a mano en *Actions → Actualizar oferta → Run workflow*.
- Lee `instituciones.json`, descarga cada portal oficial, extrae la oferta con **GitHub
  Models** y reescribe `cursos.json`. Si hay cambios, los commitea y eso dispara el deploy.
- **No necesitas configurar secretos**: usa el `GITHUB_TOKEN` automático con permiso
  `models: read`. GitHub Models es gratis para cuentas personales (con límites de uso
  holgados para este volumen).

### Probar el script en local

Necesitas un token con permiso `models: read` (un *fine-grained PAT* o el token de Actions):

```bash
export GITHUB_TOKEN=<tu_token>
npm run actualizar
```

## Personalización

- **Instituciones**: edita `src/data/instituciones.json` (nombre, ciudad, disciplinas, URL).
- **Boletín**: en `src/components/Footer.astro`, reemplaza `FORM_ID` por tu endpoint
  gratuito de [Formspree](https://formspree.io) para activar las suscripciones.
- **Colores/estilo**: variables CSS en `src/layouts/Layout.astro`.

## Notas y limitaciones

- Los datos iniciales de `cursos.json` son **semilla ilustrativa**; el primer run del
  workflow los reemplaza por oferta real extraída de las fuentes.
- El scraping puede fallar si una institución rediseña su web; el script tolera fallos por
  sitio y, si no obtiene nada, **conserva los datos previos** para no vaciar el directorio.
- Sector salud: el sitio **siempre enlaza a la fuente oficial** y nunca afirma fechas,
  costos ni cupos sin verificación.
