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
 * Blindaje sector salud: solo conserva programas con enlace; si la extracción falla
 * globalmente, mantiene los datos previos para no vaciar el sitio.
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

/** Descarga el HTML del sitio y lo reduce a texto plano para ahorrar tokens. */
async function traerTexto(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
  } finally {
    clearTimeout(t);
  }
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
Reglas: solo programas reales que aparezcan en el texto. Si no hay información suficiente, devuelve {"cursos": []}. No inventes. Máximo 6 cursos.`;

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
  const disciplina = DISCIPLINAS.includes(crudo.disciplina) ? crudo.disciplina : null;
  if (!disciplina) return null;
  const enlace = (typeof crudo.enlace === 'string' && crudo.enlace.startsWith('http'))
    ? crudo.enlace
    : institucion.url; // siempre debe haber enlace a fuente oficial
  return {
    id: `${slug(institucion.nombre)}-${slug(crudo.titulo)}`,
    titulo: crudo.titulo.trim(),
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
      const texto = await traerTexto(inst.url);
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
  const clave = (c) => slug(`${c.institucion}-${c.titulo}`);
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
