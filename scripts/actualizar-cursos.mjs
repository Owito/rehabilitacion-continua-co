#!/usr/bin/env node
/**
 * Actualiza src/data/cursos.json a partir de los portales oficiales de las instituciones.
 *
 * Usa la API de Google Gemini (nivel gratuito) para extraer la oferta de educación
 * continua de cada sitio y normalizarla a JSON estricto.
 *
 * Requiere la variable de entorno GEMINI_API_KEY (en GitHub Actions, el secreto del
 * mismo nombre). No usa ninguna API de pago.
 *
 * Antes usaba GitHub Models con el GITHUB_TOKEN, que no requería secretos. Ese
 * servicio se retiró (HTTP 410 `github_models_retirement_brownout`) y durante días la
 * extracción devolvió 0 hallazgos mientras el workflow seguía en verde. De ahí dos
 * reglas nuevas: sin clave se construye SOLO desde la base curada avisándolo, y con
 * clave configurada el proceso FALLA si ninguna fuente respondió (ver main()).
 *
 * Modo sin LLM: `node scripts/actualizar-cursos.mjs --solo-semilla` reconstruye
 * cursos.json desde la base curada, sin llamar a ningún modelo.
 *
 * Cada institución en instituciones.json puede traer:
 *   - url:  string  (una sola página), o
 *   - urls: string[] (varias páginas a barrer y concatenar)
 *   - pdf:  true     (además descarga y parsea los PDFs de Google Drive enlazados)
 *
 * Blindaje sector salud: solo conserva programas con enlace; la base curada
 * (cursos.semilla.json) es el piso y los hallazgos automáticos se suman encima.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');
const RUTA_INSTITUCIONES = join(RAIZ, 'src', 'data', 'instituciones.json');
const RUTA_SEMILLA = join(RAIZ, 'src', 'data', 'cursos.semilla.json');
const RUTA_CURSOS = join(RAIZ, 'src', 'data', 'cursos.json');

const MODELO = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const MODELS_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;
const TOKEN = process.env.GEMINI_API_KEY;
const SOLO_SEMILLA = process.argv.includes('--solo-semilla');

const DISCIPLINAS = ['Fisioterapia', 'Fonoaudiología', 'Terapia Ocupacional',
  'Medicina Física y Rehabilitación'];
const MODALIDADES = ['Virtual', 'Híbrida', 'Presencial'];
const TIPOS = ['Curso', 'Diplomado', 'Especialización', 'Seminario', 'Congreso'];

// Ventana de meses MÓVIL: mes actual + siguiente (según la fecha de ejecución).
// Así la oferta y el texto del sitio avanzan con el calendario, sin "julio y agosto" fijo.
const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const mesIdx = new Date().getMonth();
const MESES = [NOMBRES_MES[mesIdx], NOMBRES_MES[(mesIdx + 1) % 12]];

const MAX_TEXTO = 24000;   // tope de texto enviado al modelo por institución
const MAX_PDFS = 4;        // PDFs de Drive a parsear por institución

// Palabras clave de rehabilitación para enfocar páginas con mucha oferta de otras áreas.
const PALABRAS_CLAVE = [
  'fisioterap', 'fonoaud', 'terapia ocupacional', 'rehabilitac', 'deglucion', 'disfagia',
  'vocolog', 'suelo pelvico', 'pelviperineal', 'pelvi-perineal', 'neurorrehab', 'neurodesarrollo',
  'paliativ', 'linfedema', 'traqueost', 'cardiopulmonar', 'musculoesquelet', 'audiolog',
];

const hoy = new Date().toISOString().slice(0, 10);

function log(...a) { console.log('[actualizar]', ...a); }

/** Anotación de GitHub Actions: aparece en el resumen del run, no solo en el log crudo.
 *  Fuera de Actions no estorba (se ve como una línea más). */
function anotar(nivel, mensaje) {
  console.log(`::${nivel}::${mensaje}`);
}

function slug(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Clave de deduplicación tolerante: quita paréntesis y usa las primeras palabras
 *  del título normalizado, para colapsar variantes del mismo programa. */
function claveTitulo(titulo) {
  return titulo
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('-');
}

/** Heurística: ¿el título está en español? Descarta ruido en inglés (p. ej. cursos de
 *  Hand Therapy Academy como "Flexor Tendon Course") sin tocar títulos de 1 palabra ni
 *  los que tengan tilde o palabra funcional española. */
function pareceEspanol(titulo) {
  const t = titulo.toLowerCase();
  const palabras = t.split(/\s+/).filter(Boolean);
  if (palabras.length < 2) return true;                 // 1 palabra: no arriesgar (Disfagia, Vocología)
  if (/[áéíóúñ¿¡]/.test(t)) return true;                // tilde/ñ ⇒ español
  const funcionales = ['de', 'en', 'y', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'por', 'al', 'un', 'una', 'curso', 'diplomado', 'seminario', 'taller', 'rehabilitacion', 'terapia'];
  return palabras.some((p) => funcionales.includes(p));
}

/** Pasa títulos en MAYÚSCULAS sostenidas a may. inicial por palabra (más legible). */
function normalizarTitulo(titulo) {
  const t = titulo.trim().replace(/\s+/g, ' ');
  const letras = t.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ]/g, '');
  const esGritado = letras.length > 6 && letras === letras.toUpperCase();
  if (!esGritado) return t;
  const menores = new Set(['de', 'en', 'y', 'la', 'el', 'los', 'las', 'del', 'a', 'con', 'para', 'por', 'al', 'un', 'una']);
  return t.toLowerCase().split(' ').map((p, i) =>
    (i > 0 && menores.has(p)) ? p : p.charAt(0).toUpperCase() + p.slice(1)
  ).join(' ');
}

const CABECERAS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
};

/** Descarga el HTML crudo de una URL (con timeout). */
async function traerHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: CABECERAS, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** Reduce HTML a texto plano para ahorrar tokens. */
function aTexto(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Encuentra IDs de archivos de Google Drive enlazados en el HTML. */
function extraerDriveIds(html) {
  const ids = new Set();
  const re = /drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{20,})/g;
  let m;
  while ((m = re.exec(html))) ids.add(m[1]);
  return [...ids];
}

/** Descarga un PDF de Drive por su ID y devuelve su texto (o '' si no es PDF). */
async function traerPdfTexto(id) {
  const url = `https://drive.google.com/uc?export=download&id=${id}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: CABECERAS, redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('pdf')) return ''; // archivos grandes/escaneados → se omiten
    const buf = Buffer.from(await res.arrayBuffer());
    // Import a la lib interna: evita el "modo debug" de pdf-parse/index.js que intenta
    // leer un PDF de prueba al cargarse y rompe en CI.
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const data = await pdfParse(buf);
    return aTexto(data.text || '');
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

/**
 * Si el texto excede el tope, prioriza las "ventanas" alrededor de palabras clave de
 * rehabilitación. Así las páginas con mucha oferta de otras áreas (Rosario, UNAL) no
 * pierden los programas relevantes por el truncado.
 */
function enfocar(texto) {
  if (texto.length <= MAX_TEXTO) return texto;
  const bajo = texto.toLowerCase();
  const trozos = [];
  let usados = 0;
  for (const kw of PALABRAS_CLAVE) {
    let i = bajo.indexOf(kw);
    while (i !== -1 && usados < MAX_TEXTO) {
      const ini = Math.max(0, i - 200);
      const fin = Math.min(texto.length, i + 200);
      const trozo = texto.slice(ini, fin);
      trozos.push(trozo);
      usados += trozo.length;
      i = bajo.indexOf(kw, i + 200);
    }
  }
  const enfocado = trozos.join(' … ');
  return enfocado.length > 300 ? enfocado.slice(0, MAX_TEXTO) : texto.slice(0, MAX_TEXTO);
}

/** Junta el texto de todas las URLs de una institución (+ PDFs de Drive si pdf:true). */
async function recopilarTexto(inst) {
  const urls = inst.urls && inst.urls.length ? inst.urls : [inst.url];
  const partes = [];
  for (const url of urls) {
    const html = await traerHtml(url);
    partes.push(aTexto(html));
    if (inst.pdf) {
      const ids = extraerDriveIds(html).slice(0, MAX_PDFS);
      for (const id of ids) {
        const txt = await traerPdfTexto(id);
        if (txt) partes.push(txt);
      }
    }
  }
  return enfocar(partes.join('\n'));
}

/** Esquema que Gemini debe respetar al devolver la oferta (structured output). */
const ESQUEMA_RESPUESTA = {
  type: 'OBJECT',
  properties: {
    cursos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          titulo: { type: 'STRING' },
          disciplina: { type: 'STRING', enum: DISCIPLINAS },
          tema: { type: 'STRING' },
          tipo: { type: 'STRING', enum: TIPOS },
          modalidad: { type: 'STRING', enum: MODALIDADES },
          ciudad: { type: 'STRING' },
          mes: { type: 'STRING', enum: MESES },
        },
        required: ['titulo', 'disciplina', 'tipo', 'modalidad', 'ciudad', 'mes'],
      },
    },
  },
  required: ['cursos'],
};

/** Pide a Gemini que extraiga la oferta del texto del sitio. */
async function extraer(institucion, texto) {
  const sistema = `Eres un asistente que extrae oferta de educación continua en rehabilitación humana (Fisioterapia, Fonoaudiología, Terapia Ocupacional, Medicina Física y Rehabilitación) en Colombia para los meses de ${MESES[0]} y ${MESES[1]}.
Devuelve EXCLUSIVAMENTE un objeto JSON con la forma {"cursos": [...]}. Cada curso:
- titulo (string)
- disciplina (uno de: ${DISCIPLINAS.join(', ')})
- tema (string corto)
- tipo (uno de: ${TIPOS.join(', ')})
- modalidad (uno de: ${MODALIDADES.join(', ')})
- ciudad (string)
- mes (${MESES[0]} o ${MESES[1]})
Reglas: solo programas reales que aparezcan en el texto y que sean de fisioterapia, fonoaudiología, terapia ocupacional o rehabilitación. Ignora programas de otras áreas (derecho, ingeniería, odontología, etc.). Si no hay información suficiente, devuelve {"cursos": []}. No inventes. Máximo 8 cursos.`;

  const usuario = `Institución: ${institucion.nombre} (${institucion.ciudad}).\nTexto del sitio oficial:\n"""${texto}"""`;

  const res = await fetch(MODELS_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-goog-api-key': TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents: [{ role: 'user', parts: [{ text: usuario }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: ESQUEMA_RESPUESTA,
      },
    }),
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status} ${detalle.slice(0, 200)}`);
  }
  const data = await res.json();
  const contenido = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const parsed = JSON.parse(contenido);
  return Array.isArray(parsed?.cursos) ? parsed.cursos : [];
}

/** Normaliza y valida un curso devuelto por el modelo. */
function normalizar(crudo, institucion) {
  if (!crudo || typeof crudo.titulo !== 'string' || !crudo.titulo.trim()) return null;
  if (!pareceEspanol(crudo.titulo)) return null;        // descarta ruido en inglés
  const disciplina = DISCIPLINAS.includes(crudo.disciplina) ? crudo.disciplina : null;
  if (!disciplina) return null;
  const urlBase = institucion.url || (institucion.urls && institucion.urls[0]) || '';
  const enlace = (typeof crudo.enlace === 'string' && crudo.enlace.startsWith('http'))
    ? crudo.enlace
    : urlBase; // siempre debe haber enlace a fuente oficial
  const titulo = normalizarTitulo(crudo.titulo);
  return {
    id: `${slug(institucion.nombre)}-${slug(titulo)}`,
    titulo,
    institucion: institucion.nombre,
    disciplina,
    tema: typeof crudo.tema === 'string' ? crudo.tema.trim() : '',
    tipo: TIPOS.includes(crudo.tipo) ? crudo.tipo : 'Curso',
    modalidad: MODALIDADES.includes(crudo.modalidad) ? crudo.modalidad : 'Virtual',
    ciudad: typeof crudo.ciudad === 'string' && crudo.ciudad.trim() ? crudo.ciudad.trim() : institucion.ciudad,
    mes: MESES.includes(crudo.mes) ? crudo.mes : MESES[0],
    enlace,
  };
}

async function main() {
  const conLlm = !SOLO_SEMILLA && Boolean(TOKEN);
  if (SOLO_SEMILLA) {
    log('modo --solo-semilla: se reconstruye desde la base curada, sin llamar al modelo.');
  } else if (!TOKEN) {
    log('⚠ falta GEMINI_API_KEY: se construye SOLO desde la base curada, sin extracción automática.');
    log('  En local: export GEMINI_API_KEY=<clave>. En Actions: secreto GEMINI_API_KEY.');
    // No se aborta (el sitio debe seguir publicándose desde la base curada), pero la
    // degradación tiene que VERSE: sin anotación, un run en verde sin extracción es
    // indistinguible de un run sano, que es justo lo que pasó con GitHub Models.
    anotar('warning', 'Falta el secreto GEMINI_API_KEY: la oferta se publicó solo desde la ' +
      'base curada, sin extracción automática de los portales.');
  }

  const instituciones = JSON.parse(await readFile(RUTA_INSTITUCIONES, 'utf8'));
  const semilla = JSON.parse(await readFile(RUTA_SEMILLA, 'utf8'));

  const recolectados = [];
  let fuentesOk = 0;      // fuentes que respondieron sin error (aunque den 0 programas)
  for (const inst of conLlm ? instituciones : []) {
    try {
      log(`→ ${inst.nombre}`);
      const texto = await recopilarTexto(inst);
      if (texto.length < 200) { log(`  sitio con poco contenido, omitido`); continue; }
      const crudos = await extraer(inst, texto);
      const validos = crudos.map((c) => normalizar(c, inst)).filter(Boolean);
      log(`  ${validos.length} programa(s)`);
      fuentesOk++;
      recolectados.push(...validos);
    } catch (e) {
      log(`  ⚠ ${inst.nombre}: ${e.message}`);
    }
  }

  // Alarma: si hay clave configurada y NINGUNA fuente respondió, el proveedor de
  // inferencia está caído o la clave no sirve. Antes esto salía en verde y el sitio se
  // quedaba congelado en silencio durante días; ahora el workflow debe fallar en rojo.
  if (conLlm && fuentesOk === 0) {
    anotar('error', `Ninguna de las ${instituciones.length} fuentes respondió: la extracción ` +
      `automática está caída. Revisa GEMINI_API_KEY, la cuota y el modelo (${MODELO}).`);
    console.error(`ERROR: ninguna de las ${instituciones.length} fuentes respondió. ` +
      'Revisa GEMINI_API_KEY, la cuota del nivel gratuito y el nombre del modelo ' +
      `(${MODELO}). No se reescribió cursos.json.`);
    process.exit(1);
  }

  // Fusión: la base curada (semilla) es el piso; los hallazgos automáticos se suman
  // encima. Así el directorio nunca queda vacío aunque varios sitios bloqueen el bot.
  // Deduplicar por institución+título (no solo por id) para no repetir programas que
  // la base ya cubre y que el bot vuelva a encontrar.
  // Clave por institución + título normalizado (sin paréntesis, primeras palabras),
  // para colapsar variantes del mismo programa y no truncar títulos de nombres largos.
  const clave = (c) => `${slug(c.institucion)}__${claveTitulo(c.titulo)}`;
  const porClave = new Map();
  // Re-estampado de meses en la base curada: SOLO para las entradas cuyo mes es una
  // estimación (sin `fechaVerificada`), para que el directorio siga siendo coherente con
  // el periodo vigente. Las entradas con fecha verificada conservan su mes intacto: son
  // eventos con día y sede confirmados en la fuente oficial y re-estamparlos publicaría
  // una fecha falsa. Antes se re-estampaba TODO por paridad de índice (MESES[i % 2]),
  // lo que le habría cambiado el mes a un congreso con fecha real.
  let estimadas = 0;
  for (const c of semilla) {
    const mes = c.fechaVerificada ? c.mes : MESES[estimadas++ % MESES.length];
    porClave.set(clave(c), { ...c, mes });
  }
  for (const c of recolectados) {                       // enriquecer con lo nuevo
    if (!porClave.has(clave(c))) porClave.set(clave(c), c);
  }
  const cursos = [...porClave.values()];

  const huboHallazgos = recolectados.length > 0;
  const salida = {
    actualizado: hoy,
    fuente: huboHallazgos ? 'automatico' : 'semilla',
    // Ventana vigente explícita: la página la usa para separar la oferta actual de la
    // sección "Próximamente" y para el título. No se deduce de los datos, porque los
    // eventos futuros traen meses fuera de la ventana a propósito.
    ventana: MESES,
    nota: 'Base curada enriquecida automáticamente desde los portales oficiales. Verifica siempre fechas, costos y cupos en el enlace de cada institución.',
    cursos: cursos.sort((a, b) => a.disciplina.localeCompare(b.disciplina, 'es') || a.institucion.localeCompare(b.institucion, 'es')),
  };

  await writeFile(RUTA_CURSOS, JSON.stringify(salida, null, 2) + '\n', 'utf8');
  const verificadas = cursos.filter((c) => c.fechaVerificada).length;
  log(`✓ Escrito cursos.json: ${cursos.length} programas (${semilla.length} base + ${recolectados.length} hallazgos automáticos antes de deduplicar).`);
  log(`  ventana ${MESES.join(' + ')} · ${verificadas} con fecha verificada (no re-estampada) · ${fuentesOk}/${instituciones.length} fuentes respondieron.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
