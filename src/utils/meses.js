// Utilidades de meses compartidas entre la página y (conceptualmente) el script.
// El título y los filtros del directorio se derivan SIEMPRE de los meses presentes en
// los datos, para que el texto se actualice solo cuando la automatización cambie la oferta.

export const ORDEN_MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Meses únicos ordenados cronológicamente. */
export function ordenarMeses(meses) {
  return [...new Set(meses)].sort(
    (a, b) => ORDEN_MESES.indexOf(a) - ORDEN_MESES.indexOf(b)
  );
}

/**
 * Parte la oferta en la vigente (meses dentro de la ventana móvil) y la futura.
 * `ventana` la escribe el script de actualización en cursos.json; si falta (datos
 * viejos), todo se considera vigente para no esconder programas por accidente.
 */
export function partirPorVentana(cursos, ventana) {
  if (!Array.isArray(ventana) || ventana.length === 0) {
    return { vigentes: cursos, proximos: [] };
  }
  const dentro = new Set(ventana);
  const vigentes = cursos.filter((c) => dentro.has(c.mes));
  const proximos = cursos
    .filter((c) => !dentro.has(c.mes))
    .sort((a, b) => ORDEN_MESES.indexOf(a.mes) - ORDEN_MESES.indexOf(b.mes));
  return { vigentes, proximos };
}

/** Texto del rango: "Julio", "Julio y Agosto" o "Julio a Octubre". */
export function rangoMeses(meses) {
  const o = ordenarMeses(meses);
  if (o.length === 0) return '';
  if (o.length === 1) return o[0];
  if (o.length === 2) return `${o[0]} y ${o[1]}`;
  return `${o[0]} a ${o[o.length - 1]}`;
}
