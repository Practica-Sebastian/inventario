/**
 * GET /api/inventario
 * Devuelve cada ítem con su stock actual.
 *   ?q=texto        filtra por código o nombre
 *   ?alerta=1       solo ítems en o bajo el mínimo
 */
import { CONFIG, json, ident, clasificarTipo } from '../../lib/config.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const soloAlerta = url.searchParams.get('alerta') === '1';

  let items = CONFIG.MODO === 'marc_erp' ? await inventarioMarc(env) : await inventarioGenerico(env);

  if (q) items = items.filter(i => (i.clave + ' ' + i.nombre).toLowerCase().includes(q));
  if (soloAlerta) items = items.filter(i => i.alerta);
  items.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return json({
    ok: true,
    modo: CONFIG.MODO,
    generado: new Date().toISOString(),
    resumen: {
      items: items.length,
      unidades: redondear(items.reduce((s, i) => s + i.stock, 0)),
      alertas: items.filter(i => i.alerta).length,
      sinStock: items.filter(i => i.stock <= 0).length,
    },
    items,
  });
}

const redondear = n => Math.round((Number(n) || 0) * 100) / 100;

// ---------- Modo genérico: el stock sale de sumar los movimientos ----------
async function inventarioGenerico(env) {
  const g = CONFIG.generico, c = g.col;
  const campos = [c.item, c.tipo, c.cantidad, c.fecha, c.unidad, c.id].filter(Boolean).map(ident);
  const orden = `${c.fecha ? ident(c.fecha) + ', ' : ''}${c.id ? ident(c.id) : 'rowid'}`;
  const { results } = await env.DB.prepare(
    `SELECT ${campos.join(', ')} FROM ${ident(g.tablaMovimientos)} ORDER BY ${orden}`).all();

  const mapa = new Map();
  const nuevo = clave => ({ clave, nombre: clave, unidad: '', stock: 0, minimo: 0, movimientos: 0, ultimo: '' });
  for (const r of results || []) {
    const clave = String(r[c.item] ?? '').trim();
    if (!clave) continue;
    const it = mapa.get(clave) || nuevo(clave);
    const cant = Number(r[c.cantidad]) || 0;
    const clase = clasificarTipo(r[c.tipo], g.tipos);
    if (clase === 'entrada') it.stock += Math.abs(cant);
    else if (clase === 'salida') it.stock -= Math.abs(cant);
    else if (clase === 'ajuste') it.stock = g.ajusteEsAbsoluto ? cant : it.stock + cant;
    it.movimientos++;
    if (c.fecha && r[c.fecha] && String(r[c.fecha]) > it.ultimo) it.ultimo = String(r[c.fecha]);
    if (c.unidad && r[c.unidad]) it.unidad = String(r[c.unidad]);
    mapa.set(clave, it);
  }

  // Catálogo opcional: nombre, unidad y mínimo; también muestra ítems sin movimientos
  if (g.tablaItems) {
    const ci = g.colItems;
    const camposCat = [ci.clave, ci.nombre, ci.unidad, ci.minimo].filter(Boolean).map(ident).join(', ');
    const { results: cat } = await env.DB.prepare(`SELECT ${camposCat} FROM ${ident(g.tablaItems)}`).all();
    for (const r of cat || []) {
      const clave = String(r[ci.clave] ?? '').trim();
      if (!clave) continue;
      const it = mapa.get(clave) || nuevo(clave);
      if (ci.nombre && r[ci.nombre]) it.nombre = String(r[ci.nombre]);
      if (ci.unidad && r[ci.unidad]) it.unidad = String(r[ci.unidad]);
      if (ci.minimo) it.minimo = Number(r[ci.minimo]) || 0;
      mapa.set(clave, it);
    }
  }

  return [...mapa.values()].map(it => ({
    ...it,
    stock: redondear(it.stock),
    alerta: it.minimo > 0 ? it.stock <= it.minimo : it.stock <= 0,
  }));
}

// ---------- Modo MARC System: stock guardado por bodega ----------
async function inventarioMarc(env) {
  const { results: arts } = await env.DB.prepare(
    `SELECT id, codigo, nombre, categoria, unidad, minimo, costo_promedio FROM inv_articulos WHERE activo = 1`).all();
  const { results: stock } = await env.DB.prepare(
    `SELECT s.articulo_id, s.cantidad, b.nombre AS bodega
     FROM inv_stock s JOIN inv_bodegas b ON b.id = s.bodega_id WHERE b.activo = 1`).all();
  const { results: movs } = await env.DB.prepare(
    `SELECT articulo_id, COUNT(*) AS n, MAX(fecha) AS ultimo FROM inv_movimientos GROUP BY articulo_id`).all();

  const porArt = {};
  for (const s of stock || []) (porArt[s.articulo_id] = porArt[s.articulo_id] || {})[s.bodega] = Number(s.cantidad) || 0;
  const movMap = Object.fromEntries((movs || []).map(m => [m.articulo_id, m]));

  return (arts || []).map(a => {
    const bodegas = porArt[a.id] || {};
    const total = Object.values(bodegas).reduce((s, n) => s + n, 0);
    const minimo = Number(a.minimo) || 0;
    return {
      id: a.id, clave: a.codigo || String(a.id), nombre: a.nombre, categoria: a.categoria || '',
      unidad: a.unidad || 'und', stock: redondear(total), minimo, bodegas,
      costoPromedio: Number(a.costo_promedio) || 0,
      movimientos: movMap[a.id] ? movMap[a.id].n : 0,
      ultimo: movMap[a.id] ? movMap[a.id].ultimo || '' : '',
      alerta: minimo > 0 ? total <= minimo : total <= 0,
    };
  });
}
