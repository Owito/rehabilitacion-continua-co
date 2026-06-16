# Cómo contribuir

¡Gracias por aportar al directorio de **Educación Continua en Rehabilitación Humana ·
Colombia**! Este proyecto es un bien comunitario: entre más completa y verificada esté la
oferta, más útil es para fisioterapeutas, fonoaudiólogos y terapeutas ocupacionales del país.

Hay dos formas principales de contribuir: **proponer una nueva oferta** (un curso, diplomado,
etc.) y **proponer una institución** para que sea barrida por la automatización semanal.

---

## 1. Cómo funciona la oferta (importante)

- `src/data/cursos.semilla.json` → **base curada editable a mano**. Es el *piso* que nunca se
  borra y que tú controlas. **Aquí van las contribuciones manuales.**
- `src/data/cursos.json` → archivo **GENERADO**. Cada semana la automatización (GitHub
  Actions + GitHub Models) lo reconstruye combinando la semilla con los hallazgos
  automáticos. **No lo edites a mano**: tus cambios se sobrescriben.
- `src/data/instituciones.json` → lista de instituciones y sus URL oficiales que la
  automatización barre en busca de oferta nueva.

> Regla de oro: si quieres que algo aparezca **siempre**, va en `cursos.semilla.json`.

---

## 2. Proponer un curso / diplomado

Edita `src/data/cursos.semilla.json` y agrega un objeto con **todos** estos campos:

```json
{
  "id": "institucion-nombre-corto-del-curso",
  "titulo": "Diplomado en Rehabilitación Cardiopulmonar",
  "institucion": "Universidad CES",
  "disciplina": "Fisioterapia",
  "tema": "Rehabilitación cardiopulmonar",
  "tipo": "Diplomado",
  "modalidad": "Híbrida",
  "ciudad": "Medellín",
  "mes": "Agosto",
  "enlace": "https://www.ces.edu.co/educacion-continua/diplomado-..."
}
```

Convenciones de cada campo:

| Campo | Regla |
|-------|-------|
| `id` | minúsculas, sin tildes ni espacios, con guiones; **único** en el archivo. Sugerido: `institucion-tema`. |
| `titulo` | nombre oficial tal como lo publica la institución. |
| `institucion` | debe coincidir con un `nombre` de `instituciones.json` cuando aplique. |
| `disciplina` | una de: `Fisioterapia`, `Fonoaudiología`, `Terapia Ocupacional`. |
| `tema` | descripción corta del área (p. ej. "Suelo pélvico", "Dolor"). |
| `tipo` | `Curso`, `Diplomado`, `Seminario`, `Taller`, etc. |
| `modalidad` | `Presencial`, `Virtual` o `Híbrida`. |
| `ciudad` | ciudad sede (o `Virtual`). |
| `mes` | mes de inicio en español con mayúscula inicial (p. ej. `Julio`). |
| `enlace` | URL **oficial** y vigente de la institución (no acortadores). |

Antes de abrir el PR:

- [ ] El `id` no está repetido.
- [ ] El `enlace` abre y corresponde a la oferta.
- [ ] `disciplina` y `modalidad` usan exactamente los valores permitidos.
- [ ] El JSON es válido (sin comas colgantes). Puedes verificar con
      `node -e "require('./src/data/cursos.semilla.json')"`.

---

## 3. Proponer una institución

Edita `src/data/instituciones.json` para que la automatización empiece a barrer su oferta:

```json
{
  "nombre": "Universidad El Bosque",
  "ciudad": "Bogotá",
  "disciplinas": ["Fisioterapia", "Fonoaudiología", "Terapia Ocupacional"],
  "url": "https://www.unbosque.edu.co/educacion-continua/escuela-de-salud-oferta"
}
```

- `url` debe ser la **página oficial de educación continua** (donde realmente se lista la
  oferta), no la home de la universidad.
- `disciplinas` solo las que la institución ofrece, dentro de las tres del directorio.

---

## 4. Flujo de PR

```bash
git checkout -b aporte/nueva-oferta-ces
# edita src/data/cursos.semilla.json o instituciones.json
npm install
npm run build        # debe compilar sin errores
git commit -am "data: agrega <curso/institución>"
git push -u origin aporte/nueva-oferta-ces
```

Luego abre un Pull Request describiendo qué agregaste y la fuente oficial. Se revisa que los
enlaces sean oficiales y vigentes antes de mergear.

---

## Verificación de calidad

- Las fechas y cupos **siempre** deben confirmarse en la fuente oficial; el sitio muestra un
  aviso al respecto y no reemplaza la inscripción oficial.
- Mantén el JSON ordenado y consistente; el sitio deriva los meses y filtros directamente de
  los datos.

¡Gracias por sumar! 🦾
