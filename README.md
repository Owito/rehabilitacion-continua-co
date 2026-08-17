# Educación Continua en Rehabilitación Humana · Colombia

Directorio web de la oferta de educación continua en **Fisioterapia, Fonoaudiología y
Terapia Ocupacional** en Colombia. Una sola página enfocada en la **oferta vigente**, con
buscador y filtros, que se **actualiza sola a diario**.

🌐 **En vivo:** https://owito.github.io/rehabilitacion-continua-co/

- **100% gratis** y estático en **GitHub Pages** (0 JavaScript de framework; solo unos
  scripts inline para filtros y buscador).
- **Sin APIs de pago**: la oferta se refresca **cada día** con la **API de Gemini**
  (nivel gratuito) dentro de GitHub Actions.
- **Diseño neo-brutalista** (papel/tinta, bordes gruesos, sombras duras).

## Stack

| Capa | Tecnología |
|------|------------|
| Sitio | [Astro 5](https://astro.build) |
| Hosting | GitHub Pages (deploy con `withastro/action`) |
| Datos | `src/data/cursos.json` (versionado) |
| Automatización | GitHub Actions (cron diario) + API de Gemini (nivel gratuito) |

## Funcionalidades

- **Buscador** por programa / institución / tema + **filtros** por disciplina, modalidad y mes.
- **Cuatro disciplinas**: Fisioterapia, Fonoaudiología, Terapia Ocupacional y
  Medicina Física y Rehabilitación.
- **Meses dinámicos**: el título, el `<title>` y los chips de mes se derivan de los datos;
  la automatización usa una **ventana móvil** (mes actual + siguiente), así el periodo
  mostrado avanza con el calendario sin tocar código.
- **Fechas confirmadas vs. estimadas**: una entrada con `fechaVerificada: true` muestra su
  fecha exacta y una insignia "fecha confirmada", y la automatización **no** le re-estampa
  el mes. El resto son estimaciones que sí se re-estampan a la ventana vigente.
- **Sección "Próximamente"**: los eventos con fecha confirmada posterior a la ventana
  (p. ej. un congreso de noviembre) salen en un bloque aparte y **no** estiran el periodo
  del título; se integran al directorio cuando llegue su mes.
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
  utils/meses.js         # orden/rango de meses + partición vigente vs. "Próximamente"
scripts/
  actualizar-cursos.mjs  # motor de actualización (API de Gemini)
.github/workflows/
  deploy.yml             # build + deploy a Pages (push a main / dispatch)
  actualizar.yml         # cron diario (6 AM Colombia) + dispara el deploy
```

## Despliegue

1. Subir el código al repo y activar **GitHub Pages**: *Settings → Pages → Build and
   deployment → Source = **GitHub Actions***. El sitio queda en
   `https://<usuario>.github.io/rehabilitacion-continua-co/`.
   > Si el usuario no es `owito`, ajusta `site` en `astro.config.mjs`.
2. El workflow `deploy.yml` publica en cada push a `main` (o ejecución manual).

## Actualización automática

- **`actualizar.yml`** corre **todos los días a las 6:00 AM (Colombia)** y también a mano en
  *Actions → Actualizar oferta → Run workflow*.
- Calcula la **ventana de meses** vigente (actual + siguiente), parte de la **base curada**
  (`cursos.semilla.json`, re-estampando a esa ventana **solo** las entradas sin
  `fechaVerificada`), descarga cada portal oficial —incluye multi-URL y parseo de PDFs de
  Google Drive— extrae oferta con la **API de Gemini**, filtra ruido en otros idiomas,
  deduplica y **suma** los hallazgos a la base. Escribe `cursos.json`, commitea si hubo
  cambios y **dispara el deploy** (un push con `GITHUB_TOKEN` no encadena workflows, por eso
  se lanza explícitamente).
- **Un secreto**: `GEMINI_API_KEY` en *Settings → Secrets and variables → Actions*. La clave
  se saca gratis en [Google AI Studio](https://aistudio.google.com/apikey). El modelo se
  puede cambiar con la variable `GEMINI_MODEL` (por defecto `gemini-2.5-flash-lite`).
- **Falla en rojo si la inferencia se cae.** Si hay clave configurada y **ninguna** fuente
  responde, el script sale con error en vez de reescribir `cursos.json`.
  > Historia: el motor usaba **GitHub Models** con el `GITHUB_TOKEN` y sin secretos. Ese
  > servicio se retiró (HTTP 410 `github_models_retirement_brownout`) y durante días las
  > 13 fuentes fallaron mientras el workflow seguía **en verde** y el sitio quedaba
  > congelado en silencio. De ahí esta alarma.

### Probar el script en local

```bash
export GEMINI_API_KEY=<clave de Google AI Studio>
npm run actualizar

# Sin llamar a ningún modelo: reconstruye cursos.json solo desde la base curada.
# Útil tras editar cursos.semilla.json a mano.
npm run actualizar:semilla
```

## Personalización

- **Instituciones**: edita `src/data/instituciones.json` (`nombre`, `ciudad`, `disciplinas`,
  `url` o `urls`, opcional `pdf: true`).
- **Base curada**: edita `src/data/cursos.semilla.json` (programas verificados, siempre
  presentes) y corre `npm run actualizar:semilla`. Campos opcionales para eventos con fecha
  real (congresos, cursos de un día):

  | Campo | Efecto |
  |---|---|
  | `fecha` | Texto exacto que se muestra en la tarjeta en lugar del mes (`"14 al 16 de septiembre"`). |
  | `fechaVerificada` | `true` protege el `mes` del re-estampado y pinta la insignia "fecha confirmada". **Úsalo solo con fecha comprobada en la fuente oficial.** |
  | `sede` | Lugar concreto, se muestra junto a la ciudad (`"Teatro José Consuegra Higgins"`). |
  | `verificacion` | `verificado` / `bloqueado` / `no-verificable`: si el programa se pudo comprobar en la página que enlaza. Ver CONTRIBUTING. |
  | `verificadoEl` | Fecha de esa comprobación (`YYYY-MM-DD`). |

  Si el `mes` cae fuera de la ventana vigente, la entrada aparece en **"Próximamente"**.
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
- **Auditoría de existencia (2026-08-17):** se comprobaron las 32 entradas contra la página
  que enlazan. Se eliminaron **4 programas fantasma** (no estaban en la fuente oficial) y se
  reemplazaron por programas reales vistos en esas mismas páginas; se corrigieron 7 títulos
  que no calcaban el nombre oficial. Estado actual: **25 verificados**, 5 `bloqueado` (el
  sitio responde 403) y 2 `no-verificable`. El campo `verificacion` de cada entrada lo
  registra, así que la próxima auditoría no empieza de cero.
