/**
 * CONFIGURACIÓN — ajústala a las tablas que usa tu app de Registros (controllamina).
 *
 * Si no sabes cómo se llaman las tablas y columnas, abre /api/esquema en tu app
 * después de publicarla: te muestra todas las tablas y columnas de la base D1.
 *
 * MODO:
 *   'generico' → el stock se calcula sumando los movimientos de una tabla
 *                (entradas suman, salidas restan, ajustes corrigen).
 *   'marc_erp' → usa las tablas del módulo de Inventarios de MARC System
 *                (inv_articulos, inv_stock, inv_bodegas, inv_movimientos).
 */
export const CONFIG = {
  MODO: 'generico',

  generico: {
    // Tabla donde controllamina guarda cada movimiento
    tablaMovimientos: 'movimientos',
    // Nombre de cada columna en esa tabla (deja '' si no existe)
    col: {
      id: 'id',
      item: 'item',          // código o nombre del ítem (lo que agrupa el stock)
      tipo: 'tipo',          // entrada / salida / ajuste
      cantidad: 'cantidad',
      fecha: 'fecha',
      unidad: 'unidad',
      usuario: 'usuario',
      nota: 'nota',
    },
    // Palabras que identifican cada tipo (sin importar mayúsculas)
    tipos: {
      entrada: ['entrada', 'ingreso', 'compra', 'recepcion', 'recepción'],
      salida: ['salida', 'consumo', 'despacho', 'egreso', 'retiro'],
      ajuste: ['ajuste', 'conteo', 'correccion', 'corrección'],
    },
    // false: el ajuste guarda la DIFERENCIA (+5 / -3)
    // true:  el ajuste guarda el STOCK REAL contado (queda en ese número)
    ajusteEsAbsoluto: false,

    // Opcional: tabla catálogo de ítems (nombre, unidad, mínimo). Deja null si no hay.
    tablaItems: null,
    colItems: { clave: 'codigo', nombre: 'nombre', unidad: 'unidad', minimo: 'minimo' },
  },
};

// ---------- utilidades compartidas ----------
export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

// Los nombres de tablas/columnas van dentro del SQL, así que solo se aceptan nombres simples
export function ident(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || ''))) {
    throw new Error('Nombre de tabla o columna inválido en la configuración: "' + name + '"');
  }
  return '"' + name + '"';
}

// Clasifica el tipo de un movimiento según la configuración
export function clasificarTipo(tipo, tipos) {
  const t = String(tipo || '').trim().toLowerCase();
  for (const clase of ['entrada', 'salida', 'ajuste']) {
    if ((tipos[clase] || []).some(p => t === p || t.startsWith(p))) return clase;
  }
  return 'otro';
}
