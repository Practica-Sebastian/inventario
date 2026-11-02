/**
 * GET /api/movimientos
 * Historial de movimientos, del más reciente al más antiguo.
 *   ?item=CLAVE                    solo un ítem
 *   ?tipo=entrada|salida|ajuste
 *   ?q=texto                       busca en ítem, nota o usuario
 *   ?desde=AAAA-MM-DD  ?hasta=AAAA-MM-DD
 *   ?limite=100 (máx. 500)  ?pagina=0
 */
import { CONFIG, json, ident, clasificarTipo } from '../../lib/config.js';

export async function onRequestGet({ request, env }) {
  const p = new URL(request.url).searchParams;
  const f = {
    item: (p.get('item') || '').trim(),
    tipo: (p.get('tipo') || '').trim().toLowerCase(),
    q: (p.get('q') || '').trim(),
    desde: (p.get('desde') || '').trim(),
    hasta: (p.get('hasta') || '').trim(),
    limite: Math.min(Math.max(parseInt(p.get('limite'), 10) || 100, 1), 500),
    pagina: Math.max(parseInt(p.get('pagina'), 10) || 0, 0),
  };
  const filas = CONFIG.MODO === 'marc_erp' ? await movimientosMarc(env, f) : await movimientosGenerico(env, f);
  return json({ ok: true, modo: CONFIG.MODO, pagina: f.pagina, hayMas: filas.length > f.limite, movimientos: filas.slice(0, f.limite) });
}

async function movimientosGenerico(env, f) {
  const g = CONFIG.generico, c = g.col;
  const where = ['1=1'], binds = [];
  if (f.item) { where.push(`${ident(c.item)} = ?`); binds.push(f.item); }
  if (f.desde && c.fecha) { where.push(`${ident(c.fecha)} >= ?`); binds.push(f.desde); }
  if (f.hasta && c.fecha) { where.push(`${ident(c.fecha)} <= ?`); binds.push(f.hasta + '\uffff'); }
  if (f.q) {
    const campos = [c.item, c.nota, c.usuario].filter(Boolean).map(x => `COALESCE(${ident(x)}, '') LIKE ?`);
    where.push('(' + campos.join(' OR ') + ')');
    campos.forEach(() => binds.push('%' + f.q + '%'));
  }
  if (f.tipo && g.tipos[f.tipo]) {
    const ors = g.tipos[f.tipo].map(() => `LOWER(${ident(c.tipo)}) LIKE ?`);
    where.push('(' + ors.join(' OR ') + ')');
    g.tipos[f.tipo].forEach(t => binds.push(t + '%'));
  }
  const orden = `${c.fecha ? ident(c.fecha) + ' DESC, ' : ''}${c.id ? ident(c.id) : 'rowid'} DESC`;
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${ident(g.tablaMovimientos)} WHERE ${where.join(' AND ')} ORDER BY ${orden} LIMIT ? OFFSET ?`
  ).bind(...binds, f.limite + 1, f.pagina * f.limite).all();

  return (results || []).map(r => {
    const clase = clasificarTipo(r[c.tipo], g.tipos);
    const cant = Number(r[c.cantidad]) || 0;
    return {
      id: c.id ? r[c.id] : null,
      fecha: c.fecha ? r[c.fecha] || '' : '',
      tipo: clase,
      tipoOriginal: String(r[c.tipo] ?? ''),
      clave: String(r[c.item] ?? ''),
      nombre: String(r[c.item] ?? ''),
      // Con signo: + entra, − sale (el ajuste se muestra como se guardó)
      cantidad: clase === 'salida' ? -Math.abs(cant) : clase === 'entrada' ? Math.abs(cant) : cant,
      unidad: c.unidad ? r[c.unidad] || '' : '',
      usuario: c.usuario ? r[c.usuario] || '' : '',
      nota: c.nota ? r[c.nota] || '' : '',
      bodega: '',
    };
  });
}

async function movimientosMarc(env, f) {
  const where = ['1=1'], binds = [];
  if (f.item) { where.push('(a.codigo = ? OR CAST(a.id AS TEXT) = ?)'); binds.push(f.item, f.item); }
  if (f.tipo) { where.push('LOWER(m.tipo) = ?'); binds.push(f.tipo); }
  if (f.desde) { where.push('m.fecha >= ?'); binds.push(f.desde); }
  if (f.hasta) { where.push('m.fecha <= ?'); binds.push(f.hasta + '\uffff'); }
  if (f.q) {
    where.push('(a.nombre LIKE ? OR a.codigo LIKE ? OR m.motivo LIKE ? OR m.por LIKE ?)');
    binds.push(...Array(4).fill('%' + f.q + '%'));
  }
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.tipo, m.cantidad, m.fecha, m.motivo, m.referencia, m.por,
            a.codigo, a.id AS articulo_id, a.nombre, a.unidad, b.nombre AS bodega, bd.nombre AS bodega_destino
     FROM inv_movimientos m
     JOIN inv_articulos a ON a.id = m.articulo_id
     JOIN inv_bodegas b ON b.id = m.bodega_id
     LEFT JOIN inv_bodegas bd ON bd.id = m.bodega_destino_id
     WHERE ${where.join(' AND ')} ORDER BY m.fecha DESC, m.id DESC LIMIT ? OFFSET ?`
  ).bind(...binds, f.limite + 1, f.pagina * f.limite).all();

  return (results || []).map(r => {
    const tipo = String(r.tipo || '').toLowerCase();
    const cant = Number(r.cantidad) || 0;
    return {
      id: r.id,
      fecha: r.fecha || '',
      tipo: ['entrada', 'salida', 'ajuste'].includes(tipo) ? tipo : 'otro',
      tipoOriginal: r.tipo,
      clave: r.codigo || String(r.articulo_id),
      nombre: r.nombre,
      cantidad: tipo === 'salida' ? -Math.abs(cant) : cant,
      unidad: r.unidad || '',
      usuario: r.por || '',
      nota: [r.motivo, r.referencia].filter(Boolean).join(' · '),
      bodega: r.bodega + (r.bodega_destino ? ' → ' + r.bodega_destino : ''),
    };
  });
}
