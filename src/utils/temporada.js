/**
 * Temporada visual del sitio.
 *
 * El directorio se reconstruye a diario (cron + deploy), así que la temporada se resuelve
 * en tiempo de build: entra y sale sola sin que nadie toque el repo.
 *
 * La fecha se calcula en la zona de Colombia a propósito. `new Date().getMonth()` usa la
 * zona del runner (UTC en GitHub Actions), y eso adelanta el cambio de mes cinco horas:
 * el 30 de septiembre a las 7:00 p. m. de Bogotá ya es octubre en UTC.
 */

export const ZONA = 'America/Bogota';

/** Fecha de hoy en Bogotá como 'YYYY-MM-DD'. */
export function hoyEnBogota(ahora = new Date()) {
  return ahora.toLocaleDateString('en-CA', { timeZone: ZONA });
}

/**
 * Devuelve la temporada activa para una fecha 'YYYY-MM-DD', o null si no hay ninguna.
 * Octubre entero es Halloween: el directorio es mensual, así que una temporada que durara
 * solo la semana del 31 pasaría desapercibida entre dos despliegues.
 */
export function temporadaDe(fecha = hoyEnBogota()) {
  const mes = Number(String(fecha).slice(5, 7));
  return mes === 10 ? 'halloween' : null;
}
