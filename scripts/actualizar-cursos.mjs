#!/usr/bin/env node
/**
 * Actualiza src/data/cursos.json a partir de los portales oficiales de las instituciones.
 *
 * Usa GitHub Models (inferencia LLM GRATUITA para cuentas personales) para extraer la
 * oferta de educación continua de cada sitio y normalizarla a JSON estricto.
 *
 * Requiere la variable de entorno GITHUB_TOKEN (en GitHub Actions se inyecta sola con
 * el permiso `models: read`). No usa ninguna API de pago.
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

const MODELS_ENDPOINT = 'https://models.github.ai/inference/chat/completions';
const MODELO = process.env.GH_MODEL || 'openai/gpt-4o-mini';
const TOKEN = process.env.GITHUB_TOKEN;

const DISCIPLINAS = ['Fisioterapia', 'Fonoaudiología', 'Terapia Ocupacional'];
const MODALIDADES = ['Virtual', 'Híbrida', 'Presencial'];
const TIPOS = ['Curso', 'Diplomado', 'Especialización', 'Seminario'];
const MESES = ['Julio', 'Agosto'];

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

/** Pide a GitHub Models que extraiga la oferta del texto del sitio. */
async function extraer(institucion, texto) {
  const sistema = `Eres un asistente que extrae oferta de educación continua en rehabilitación humana (Fisioterapia, Fonoaudiología, Terapia Ocupacional) en Colombia para los meses de julio y agosto.
Devuelve EXCLUSIVAMENTE un objeto JSON con la forma {"cursos": [...]}. Cada curso:
- titulo (string)
- disciplina (uno de: ${DISCIPLINAS.join(', ')})
- tema (string corto)
- tipo (uno de: ${TIPOS.join(', ')})
- modalidad (uno de: ${MODALIDADES.join(', ')})
- ciudad (string)
- mes (Julio o Agosto)
Reglas: solo programas reales que aparezcan en el texto y que sean de fisioterapia, fonoaudiología, terapia ocupacional o rehabilitación. Ignora programas de otras áreas (derecho, ingeniería, odontología, etc.). Si no hay información suficiente, devuelve {"cursos": []}. No inventes. Máximo 8 cursos.`;

  const usuario = `Institución: ${institucion.nombre} (${institucion.ciudad}).\nTexto del sitio oficial:\n"""${texto}"""`;

  const res = await fetch(MODELS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      model: MODELO,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sistema },
        { role: 'user', content: usuario },
      ],
    }),
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`Models HTTP ${res.status} ${detalle.slice(0, 200)}`);
  }
  const data = await res.json();
  const contenido = data?.choices?.[0]?.message?.content ?? '{}';
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
    mes: MESES.includes(crudo.mes) ? crudo.mes : 'Julio',
    enlace,
  };
}

async function main() {
  if (!TOKEN) {
    console.error('ERROR: falta GITHUB_TOKEN. En local: export GITHUB_TOKEN=<token con models:read>.');
    process.exit(1);
  }

  const instituciones = JSON.parse(await readFile(RUTA_INSTITUCIONES, 'utf8'));
  const semilla = JSON.parse(await readFile(RUTA_SEMILLA, 'utf8'));

  const recolectados = [];
  for (const inst of instituciones) {
    try {
      log(`→ ${inst.nombre}`);
      const texto = await recopilarTexto(inst);
      if (texto.length < 200) { log(`  sitio con poco contenido, omitido`); continue; }
      const crudos = await extraer(inst, texto);
      const validos = crudos.map((c) => normalizar(c, inst)).filter(Boolean);
      log(`  ${validos.length} programa(s)`);
      recolectados.push(...validos);
    } catch (e) {
      log(`  ⚠ ${inst.nombre}: ${e.message}`);
    }
  }

  // Fusión: la base curada (semilla) es el piso; los hallazgos automáticos se suman
  // encima. Así el directorio nunca queda vacío aunque varios sitios bloqueen el bot.
  // Deduplicar por institución+título (no solo por id) para no repetir programas que
  // la base ya cubre y que el bot vuelva a encontrar.
  // Clave por institución + título normalizado (sin paréntesis, primeras palabras),
  // para colapsar variantes del mismo programa y no truncar títulos de nombres largos.
  const clave = (c) => `${slug(c.institucion)}__${claveTitulo(c.titulo)}`;
  const porClave = new Map();
  for (const c of semilla) porClave.set(clave(c), c);   // base curada primero (gana)
  for (const c of recolectados) {                       // enriquecer con lo nuevo
    if (!porClave.has(clave(c))) porClave.set(clave(c), c);
  }
  const cursos = [...porClave.values()];

  const huboHallazgos = recolectados.length > 0;
  const salida = {
    actualizado: hoy,
    fuente: huboHallazgos ? 'automatico' : 'semilla',
    nota: 'Base curada enriquecida automáticamente desde los portales oficiales. Verifica siempre fechas, costos y cupos en el enlace de cada institución.',
    cursos: cursos.sort((a, b) => a.disciplina.localeCompare(b.disciplina, 'es') || a.institucion.localeCompare(b.institucion, 'es')),
  };

  await writeFile(RUTA_CURSOS, JSON.stringify(salida, null, 2) + '\n', 'utf8');
  log(`✓ Escrito cursos.json: ${cursos.length} programas (${semilla.length} base + ${recolectados.length} hallazgos automáticos antes de deduplicar).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
