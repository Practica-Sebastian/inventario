/**
 * Se ejecuta antes de cualquier /api/*: errores ordenados, CORS y clave opcional.
 * Para pedir clave: en Cloudflare Pages → Configuración → Variables y secretos,
 * agrega API_KEY. La app la manda en el encabezado X-Api-Key.
 */
import { json } from '../../lib/config.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
};

export async function onRequest(context) {
  const { request, env, next } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  let res;
  try {
    if (!env.DB) {
      res = json({ ok: false, error: 'La base D1 no está conectada. En Pages → Configuración → Enlaces, agrega una base D1 con el nombre de variable DB.' }, 500);
    } else if (env.API_KEY && request.headers.get('X-Api-Key') !== env.API_KEY) {
      res = json({ ok: false, error: 'Clave incorrecta' }, 401);
    } else {
      res = await next();
    }
  } catch (err) {
    res = json({ ok: false, error: 'Error del servidor: ' + (err && err.message ? err.message : String(err)) }, 500);
  }
  const out = new Response(res.body, res);
  Object.entries(CORS).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}
