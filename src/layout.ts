import type { Edge, Node } from '@xyflow/react';

/*
 * «Упорядочить узлы»: цепочка от «Старта» — сверху вниз (выход «next» снизу узла),
 * «тело» цикла — колонкой справа (выход «body» справа), после цикла цепочка продолжается
 * ниже его тела. Несвязанные с «Стартом» цепочки — ниже основной схемы.
 */

/** Шаг по вертикали: высота узла (~56px) + зазор. */
const ROW = 100;
/** Шаг по горизонтали: ширина узла (от 170px) + подпись «тело →» + зазор. */
const COL = 270;

export function arrangeNodes<N extends Node>(nodes: N[], edges: Edge[]): N[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = (id: string, handle: 'next' | 'body') =>
    edges.find((e) => e.source === id && (e.sourceHandle ?? 'next') === handle)?.target;
  const pos = new Map<string, { x: number; y: number }>();

  /** Раскладывает цепочку с узла id в колонке x начиная с y; возвращает y под последним узлом. */
  const chain = (id: string | undefined, x: number, y: number): number => {
    while (id && byId.has(id) && !pos.has(id)) {
      pos.set(id, { x, y });
      let below = y + ROW;
      if (byId.get(id)!.type === 'loop') below = Math.max(below, chain(out(id, 'body'), x + COL, y));
      id = out(id, 'next');
      y = below;
    }
    return y;
  };

  let bottom = chain(nodes.find((n) => n.type === 'start')?.id, 0, 0);

  // не связанные со «Стартом»: сначала цепочки от узлов без входящих связей, потом остальное
  const hasIncoming = new Set(edges.map((e) => e.target));
  const rest = nodes.filter((n) => !pos.has(n.id));
  for (const n of [...rest.filter((n) => !hasIncoming.has(n.id)), ...rest]) {
    if (!pos.has(n.id)) bottom = chain(n.id, 0, bottom + ROW / 2);
  }

  return nodes.map((n) => {
    const p = pos.get(n.id);
    return p ? { ...n, position: p } : n;
  });
}
