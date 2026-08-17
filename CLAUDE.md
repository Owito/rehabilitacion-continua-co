# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Repo y documentación en **español**: mantener ese idioma en código, comentarios, commits y PRs.

## Comandos

```bash
npm install
npm run dev                  # http://localhost:4321/rehabilitacion-continua-co
npm run build                # genera dist/  ← única validación automática que existe
npm run preview              # sirve la build

npm run actualizar:semilla   # regenera src/data/cursos.json desde la semilla, SIN llamar a ningún LLM
npm run actualizar           # ídem + extracción con LLM (requiere GROQ_API_KEY; opcional)
```

**No hay tests ni linter.** La validación es `npm run build` más las comprobaciones de datos
que se hacen a mano (ver "Invariantes"). No inventes comandos de test.

Tras editar `src/data/cursos.semilla.json` hay que correr `npm run actualizar:semilla`: el
sitio lee `cursos.json`, que es un archivo **generado**.

## Arquitectura

Sitio estático Astro de **una sola página** (`src/pages/index.astro` → `nav` + `<main>` con
`src/components/Directorio.astro`). Sin JS de framework: los filtros y el buscador son scripts
inline. El único componente real es `Directorio.astro`.

El flujo de datos es lo que hay que entender antes de tocar nada:

```
cursos.semilla.json  (BASE CURADA, editable a mano, piso que nunca se borra)
        +
hallazgos del LLM    (OPCIONAL, casi siempre vacío)
        ↓  scripts/actualizar-cursos.mjs
cursos.json          (GENERADO — no editar a mano)
        ↓
Directorio.astro     (parte en "vigentes" y "Próximamente" con utils/meses.js)
```

`base: '/rehabilitacion-continua-co'` en `astro.config.mjs`: las URLs locales y de producción
llevan ese prefijo.

### La curaduría es el mecanismo, el LLM es un extra

Tres proveedores de inferencia fallaron (GitHub Models se retiró con HTTP 410; Gemini exige
saldo; Groq no fue viable) y una auditoría encontró que el bot había publicado **4 programas
fantasma** que no existían en la fuente oficial. Además 5 de 14 portales bloquean al bot con
403, Univalle publica en PDF escaneado y varios listados mezclan cursos **vencidos** con
vigentes.

Conclusión que rige el proyecto: **la base curada verificada a mano es la fuente de verdad.**
Sin `GROQ_API_KEY` el script corre en "modo curaduría" y ese es el estado **normal**, no un
fallo — no lo trates como algo que haya que arreglar.

El procedimiento para agregar oferta (incluido el método de los **sitemaps**, indispensable
porque varios portales no exponen enlaces en el HTML) está en **`CONTRIBUTING.md`**, sección
"Cómo hacer una ronda de curaduría". Leerla antes de agregar programas.

## Invariantes que no hay que romper

**La ventana de meses es móvil** (mes actual + siguiente, según la fecha de ejecución). El H1,
el `<title>` y los chips de mes se **derivan de los datos**; nunca hardcodear meses.
`cursos.json` incluye `ventana` explícita y `utils/meses.js` (`partirPorVentana`) la usa para
separar la oferta vigente de la sección "Próximamente". Un programa con mes fuera de la
ventana **no se pierde**: aparece en "Próximamente" y entra al directorio cuando llegue su mes.

**Dos campos distintos que es fácil confundir:**

| Campo | Pregunta que responde |
|---|---|
| `fechaVerificada` | *¿La fecha es real?* Protege el `mes` del re-estampado y pinta la insignia "fecha confirmada". |
| `verificacion` (+ `verificadoEl`) | *¿El programa está de verdad en la página que enlaza?* Valores: `verificado`, `bloqueado` (403 al bot), `no-verificable` (PDF escaneado o página genérica). |

**El re-estampado de meses solo aplica a las entradas SIN `fechaVerificada`.** Las estimadas se
mueven a la ventana vigente; las verificadas conservan su mes intacto. Un bug anterior
re-estampaba TODO por paridad de índice (`MESES[i % 2]`), lo que le cambiaba el mes a
congresos con fecha real. No revertir eso.

**Nunca marques `fechaVerificada: true` sin haber leído la fecha en la fuente oficial** (la
ficha del programa, no una publicación en redes). Es un directorio del sector salud: publicar
una fecha o un programa que no existe es el peor fallo posible.

**Enums validados** en `scripts/actualizar-cursos.mjs`: disciplinas (Fisioterapia,
Fonoaudiología, Terapia Ocupacional, Medicina Física y Rehabilitación), modalidades
(Virtual, Híbrida, Presencial) y tipos (Curso, Diplomado, Especialización, Seminario,
Congreso). El `tipo` suele ser deducible por la URL de la ficha: si vive bajo `/diplomado/`,
es un diplomado.

## Despliegue y CI

`.github/workflows/`:
- **`deploy.yml`** — build + deploy a Pages en cada push a `main` y por `workflow_dispatch`.
- **`actualizar.yml`** — cron diario 11:00 UTC (6 AM Colombia) + manual.

Dos cosas que cambian cómo se trabaja aquí:

**No hay CI de PR.** Los workflows corren en push a `main` y por cron, nunca sobre ramas: el
merge **despliega directo a producción sin ningún gate**. Validar en local antes
(`npm run actualizar:semilla` + `npm run build`) y **verificar después contra el HTML en vivo**,
no contra el ✓ verde del workflow.

**Un push con `GITHUB_TOKEN` no dispara otros workflows** (anti-bucle de GitHub). Por eso
`actualizar.yml` lanza el deploy explícitamente con `gh workflow run deploy.yml`, y necesita
el permiso `actions: write`.

`actualizar-cursos.mjs` **falla en rojo** (`::error::` + exit 1, sin reescribir `cursos.json`)
si hay clave configurada y **ninguna** fuente responde. Esa alarma existe porque el retiro de
GitHub Models pasó ~10 días inadvertido con el workflow en verde. No la debilites: las
anotaciones `::error::`/`::warning::` salen en el resumen del run, y un log crudo no se lee.

## Convenciones

- **Conventional Commits en español**, asunto imperativo + cuerpo en viñetas; PRs con
  descripción estructurada (motivo, qué cambia, verificación).
- **Nunca acreditar a Claude** en commits, PRs ni nada relacionado con deploy o pipelines.
- Ramificar antes de commitear; no commitear directo a `main`.
- UI: estética neo-brutalista papel/tinta (variables en `src/layouts/Layout.astro`). Aplicar
  heurísticas de Nielsen y los principios del Neurodiversity Design System — el neobrutalismo
  tiende a contrastes extremos que aumentan la fatiga cognitiva, así que cuidar interlineado y
  tamaño de cuerpo.
- El sitio **siempre enlaza a la fuente oficial** y nunca afirma fechas, costos ni cupos sin
  verificación. Preferir la ficha individual del programa sobre la página genérica de
  educación continua de la institución.
