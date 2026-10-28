import {
  NODE_TYPES,
  type MacroDef,
  type MacroEdge,
  type MacroNode,
  type NodeType,
  type TriggerMode,
} from './types';

export const newId = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export function defaultData(type: NodeType): Record<string, unknown> {
  switch (type) {
    case 'start':
      return {};
    case 'key':
      return { key: 'E', action: 'press', holdMs: 30 };
    case 'mouse':
      return { button: 'left', action: 'click', holdMs: 30 };
    case 'mouseMove':
      return { x: 0, y: 0, relative: true };
    case 'scroll':
      return { amount: 1 };
    case 'delay':
      return { ms: 100, jitterMs: 0 };
    case 'loop':
      return { count: 0 };
  }
}

export function newMacro(name = 'Новый макрос'): MacroDef {
  return {
    version: 1,
    id: newId('m'),
    name,
    enabled: true,
    trigger: { key: '', mode: 'toggle' },
    nodes: [{ id: newId('n'), type: 'start', position: { x: 200, y: 40 }, data: {} }],
    edges: [],
  };
}

/** Пример: автокликер с бесконечным циклом. */
export function sampleMacro(): MacroDef {
  const s = newId('n');
  const l = newId('n');
  const c = newId('n');
  const d = newId('n');
  return {
    version: 1,
    id: newId('m'),
    name: 'Автокликер (пример)',
    enabled: true,
    trigger: { key: 'F6', mode: 'toggle' },
    nodes: [
      { id: s, type: 'start', position: { x: 200, y: 40 }, data: {} },
      { id: l, type: 'loop', position: { x: 200, y: 160 }, data: { count: 0 } },
      { id: c, type: 'mouse', position: { x: 440, y: 250 }, data: defaultData('mouse') },
      { id: d, type: 'delay', position: { x: 440, y: 380 }, data: { ms: 50, jitterMs: 20 } },
    ],
    edges: [
      { id: newId('e'), source: s, target: l, sourceHandle: 'next' },
      { id: newId('e'), source: l, target: c, sourceHandle: 'body' },
      { id: newId('e'), source: c, target: d, sourceHandle: 'next' },
    ],
  };
}

const MODES: TriggerMode[] = ['toggle', 'hold', 'once'];

/** Проверяет форму JSON и приводит к MacroDef. Бросает Error с понятным текстом. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeMacro(raw: any): MacroDef {
  if (!raw || typeof raw !== 'object') throw new Error('это не макрос');
  if (typeof raw.name !== 'string') throw new Error('нет поля name');
  if (!Array.isArray(raw.nodes)) throw new Error('нет списка nodes');
  const nodes: MacroNode[] = raw.nodes.map((n: any, i: number) => {
    if (!n || typeof n.id !== 'string') throw new Error(`узел #${i + 1}: нет id`);
    if (!NODE_TYPES.includes(n.type)) throw new Error(`узел «${n.id}»: неизвестный type «${n.type}»`);
    return {
      id: n.id,
      type: n.type,
      position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 },
      data: { ...defaultData(n.type), ...(n.data ?? {}) },
    };
  });
  const edges: MacroEdge[] = (Array.isArray(raw.edges) ? raw.edges : []).map((e: any, i: number) => {
    if (typeof e?.source !== 'string' || typeof e?.target !== 'string')
      throw new Error(`связь #${i + 1}: нужны source и target`);
    return {
      id: typeof e.id === 'string' && e.id ? e.id : newId('e'),
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle === 'body' ? 'body' : 'next',
    };
  });
  const mode: TriggerMode = MODES.includes(raw.trigger?.mode) ? raw.trigger.mode : 'toggle';
  return {
    version: 1,
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('m'),
    name: raw.name,
    enabled: raw.enabled !== false,
    trigger: { key: typeof raw.trigger?.key === 'string' ? raw.trigger.key : '', mode },
    nodes,
    edges,
  };
}

/** Что попадает в файл экспорта (без внутреннего id библиотеки). */
export function toExport(m: MacroDef) {
  const { id: _id, ...rest } = m;
  return rest;
}

/** Ключ «смысла» макроса: без позиций узлов, чтобы перетаскивание не перезапускало движок. */
export function semanticKey(ms: MacroDef[]): string {
  return JSON.stringify(
    ms.map((m) => ({
      ...m,
      nodes: m.nodes.map(({ position: _p, ...n }) => n),
    })),
  );
}
