import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NODE_TYPES, type NodeType } from './types';

export const META: Record<NodeType, { title: string; color: string }> = {
  start: { title: 'Старт', color: '#4ade80' },
  key: { title: 'Клавиша', color: '#60a5fa' },
  mouse: { title: 'Кнопка мыши', color: '#f472b6' },
  mouseMove: { title: 'Движение мыши', color: '#c084fc' },
  scroll: { title: 'Колесо мыши', color: '#fb923c' },
  delay: { title: 'Задержка', color: '#facc15' },
  loop: { title: 'Цикл', color: '#2dd4bf' },
};

const BTN: Record<string, string> = {
  left: 'ЛКМ',
  right: 'ПКМ',
  middle: 'СКМ',
  x1: 'X1 (назад)',
  x2: 'X2 (вперёд)',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function summary(type: NodeType, d: Record<string, any>): string {
  switch (type) {
    case 'start':
      return 'Отсюда начинается макрос';
    case 'key': {
      const k = d.key || '—';
      return d.action === 'down' ? `Зажать ${k}` : d.action === 'up' ? `Отпустить ${k}` : `Нажать ${k}`;
    }
    case 'mouse': {
      const b = BTN[d.button] ?? d.button;
      return d.action === 'down' ? `Зажать ${b}` : d.action === 'up' ? `Отпустить ${b}` : `Клик ${b}`;
    }
    case 'mouseMove':
      return d.relative ? `Сдвиг на ${d.x}, ${d.y}` : `В точку ${d.x}, ${d.y}`;
    case 'scroll':
      return d.amount >= 0 ? `Вверх × ${d.amount}` : `Вниз × ${-d.amount}`;
    case 'delay':
      return d.jitterMs > 0 ? `${d.ms}–${d.ms + d.jitterMs} мс` : `${d.ms} мс`;
    case 'loop':
      return d.count === 0 ? 'Повторять бесконечно' : `Повторить ${d.count} раз`;
  }
}

function MacroNodeView({ type, data, selected }: NodeProps) {
  const t = type as NodeType;
  const meta = META[t];
  return (
    <div className={`mnode ${selected ? 'selected' : ''}`} style={{ borderLeftColor: meta.color }}>
      {t !== 'start' && <Handle type="target" position={Position.Top} />}
      <div className="mnode-title" style={{ color: meta.color }}>
        {meta.title}
      </div>
      <div className="mnode-sub">{summary(t, data)}</div>
      {t === 'loop' && (
        <>
          <div className="mnode-port body">тело →</div>
          <Handle type="source" position={Position.Right} id="body" />
        </>
      )}
      <Handle type="source" position={Position.Bottom} id="next" />
    </div>
  );
}

export const nodeTypes = Object.fromEntries(NODE_TYPES.map((t) => [t, MacroNodeView]));
