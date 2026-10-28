export type TriggerMode = 'toggle' | 'hold' | 'once';

export type NodeType =
  | 'start'
  | 'key'
  | 'mouse'
  | 'mouseMove'
  | 'scroll'
  | 'delay'
  | 'loop';

export const NODE_TYPES: NodeType[] = [
  'start',
  'key',
  'mouse',
  'mouseMove',
  'scroll',
  'delay',
  'loop',
];

export interface MacroNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

export interface MacroEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: 'next' | 'body';
}

export interface MacroDef {
  version: 1;
  id: string;
  name: string;
  enabled: boolean;
  trigger: { key: string; mode: TriggerMode };
  nodes: MacroNode[];
  edges: MacroEdge[];
}

export interface StatusEvent {
  id: string;
  running: boolean;
  error: string | null;
}

export interface MacroReport {
  id: string;
  error: string | null;
}

export const MODE_LABELS: Record<TriggerMode, string> = {
  toggle: 'Вкл/выкл по кнопке',
  hold: 'Работает, пока зажата кнопка',
  once: 'Одно нажатие — один прогон',
};
