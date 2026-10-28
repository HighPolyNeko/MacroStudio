import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  addEdge,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Node,
  type XYPosition,
} from '@xyflow/react';
import { isTauri, pickPoint } from './api';
import { ContextMenu, MenuItem, SubMenu } from './ContextMenu';
import { Dropdown } from './Dropdown';
import { KeyCapture } from './KeyCapture';
import { defaultData, newId } from './macros';
import { META, nodeTypes } from './nodes';
import type { MacroDef, MacroEdge, MacroNode, NodeType } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlowNode = Node<Record<string, any>>;

/** Узлы, которые можно создать. «Старт» есть всегда, ровно один: его не создают и не удаляют. */
const CREATABLE: NodeType[] = ['key', 'mouse', 'mouseMove', 'scroll', 'delay', 'loop'];

// примерный размер узла: вход сверху по центру, чтобы новый узел встал под отпущенную линию
const NODE_HALF_WIDTH = 85;
const NODE_HEIGHT = 60;

/** Откуда тянули линию, которую отпустили в пустоте. */
interface DragFrom {
  nodeId: string;
  handleId: string | null;
  type: 'source' | 'target';
}

/** Меню создания узла: по ПКМ на холсте или после линии, отпущенной в пустоте. */
interface MenuState {
  /** Точка экрана, где открыть меню. */
  clientX: number;
  clientY: number;
  /** Точка на схеме, где создать узел. */
  at: XYPosition;
  from?: DragFrom;
}

const toFlowNode = (n: MacroNode): FlowNode => ({ ...n, deletable: n.type !== 'start' });
const toFlowEdge = (e: MacroEdge): Edge => ({ ...e });

const cleanNode = (n: FlowNode): MacroNode => ({
  id: n.id,
  type: n.type as NodeType,
  position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
  data: n.data,
});
const cleanEdge = (e: Edge): MacroEdge => ({
  id: e.id,
  source: e.source,
  target: e.target,
  sourceHandle: e.sourceHandle === 'body' ? 'body' : 'next',
});

/** Если провести связь source → target, получится ли замкнутый круг? */
function wouldCycle(edges: Edge[], source: string, target: string): boolean {
  if (source === target) return true;
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of edges) if (e.source === cur) stack.push(e.target);
  }
  return false;
}

interface Props {
  macro: MacroDef;
  onUpdate: (patch: Partial<MacroDef>) => void;
  /** Показывается справа, когда узел не выбран (настройки макроса). */
  children: ReactNode;
}

function EditorInner({ macro, onUpdate, children }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(macro.nodes.map(toFlowNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(macro.edges.map(toFlowEdge));
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    onUpdateRef.current({ nodes: nodes.map(cleanNode), edges: edges.map(cleanEdge) });
  }, [nodes, edges]);

  const onConnect = useCallback(
    (c: Connection) => {
      const handle = c.sourceHandle ?? 'next';
      setEdges((eds) =>
        addEdge(
          { ...c, sourceHandle: handle, id: newId('e') },
          // из одного выхода — только одна связь
          eds.filter((e) => !(e.source === c.source && (e.sourceHandle ?? 'next') === handle)),
        ),
      );
    },
    [setEdges],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => !wouldCycle(edgesRef.current, c.source, c.target),
    [],
  );

  /** Соединяет, если связь допустима: без замкнутого круга и не во вход «Старта» (его нет). */
  const connectIfValid = useCallback(
    (c: Connection) => {
      const target = rf.getNode(c.target);
      if (target?.type === 'start' || !isValidConnection(c)) return;
      onConnect(c);
    },
    [rf, isValidConnection, onConnect],
  );

  /** Создаёт узел в точке схемы; если узел создан из отпущенной линии — сразу соединяет. */
  const createNode = (type: NodeType, at: XYPosition, from?: DragFrom) => {
    const id = newId('n');
    // линию тянули из выхода — новый узел встаёт входом в точку; из входа — встаёт над ней
    const position = from
      ? { x: at.x - NODE_HALF_WIDTH, y: from.type === 'source' ? at.y : at.y - NODE_HEIGHT }
      : at;
    const node: FlowNode = { id, type, position, data: defaultData(type), selected: true, deletable: true };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node]);
    if (from?.type === 'source') {
      onConnect({ source: from.nodeId, sourceHandle: from.handleId, target: id, targetHandle: null });
    } else if (from) {
      onConnect({ source: id, sourceHandle: 'next', target: from.nodeId, targetHandle: null });
    }
  };

  const addNode = (type: NodeType) => {
    const r = wrap.current?.getBoundingClientRect();
    const jitter = () => Math.random() * 80 - 40;
    const at = r
      ? rf.screenToFlowPosition({ x: r.left + r.width / 2 + jitter(), y: r.top + r.height / 2 + jitter() })
      : { x: 100, y: 100 };
    createNode(type, at);
  };

  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  /** Открывает меню в точке экрана (clientX/clientY), не давая ему вылезти за холст. */
  const openMenu = (clientX: number, clientY: number, from?: DragFrom) =>
    setMenu({ clientX, clientY, at: rf.screenToFlowPosition({ x: clientX, y: clientY }), from });

  // Линию отпустили не на точке входа/выхода
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode || !state.fromHandle) return;
      const p = 'changedTouches' in event ? event.changedTouches[0] : event;
      const from: DragFrom = {
        nodeId: state.fromNode.id,
        handleId: state.fromHandle.id ?? null,
        type: state.fromHandle.type,
      };
      const nodeEl = document
        .elementsFromPoint(p.clientX, p.clientY)
        .map((el) => el.closest('.react-flow__node'))
        .find(Boolean);
      const nodeId = nodeEl?.getAttribute('data-id');
      if (nodeId) {
        // на тело узла — соединяем с его входом (или из его выхода, если тянули из входа)
        if (nodeId === from.nodeId) return;
        connectIfValid(
          from.type === 'source'
            ? { source: from.nodeId, sourceHandle: from.handleId, target: nodeId, targetHandle: null }
            : { source: nodeId, sourceHandle: 'next', target: from.nodeId, targetHandle: null },
        );
        return;
      }
      // в пустоту — меню: создать узел и сразу соединить
      openMenu(p.clientX, p.clientY, from);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectIfValid],
  );
  const selectedNodes = nodes.filter((n) => n.selected);
  const node = selectedNodes.length === 1 ? selectedNodes[0] : null;

  const patchData = (id: string, patch: Record<string, unknown>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  const removeNode = (id: string) => {
    if (nodes.find((n) => n.id === id)?.type === 'start') return;
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
  };

  return (
    <div className="editor">
      <div className="palette">
        <span className="palette-label">Добавить:</span>
        {CREATABLE.map((t) => (
          <button key={t} className="chip" style={{ borderColor: META[t].color }} onClick={() => addNode(t)}>
            {META[t].title}
          </button>
        ))}
      </div>
      <div className="canvas" ref={wrap}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            openMenu(e.clientX, e.clientY);
          }}
          onMoveStart={closeMenu}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          deleteKeyCode={['Delete', 'Backspace']}
          colorMode="dark"
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {menu && (
          <NodeMenu
            menu={menu}
            onClose={closeMenu}
            onPick={(t) => {
              createNode(t, menu.at, menu.from);
              closeMenu();
            }}
          />
        )}
      </div>
      <aside className="inspector">
        {node ? (
          <NodeInspector
            node={node}
            onPatch={(p) => patchData(node.id, p)}
            onRemove={() => removeNode(node.id)}
          />
        ) : (
          children
        )}
      </aside>
    </div>
  );
}

export function Editor(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}

/* ---------- Меню создания узла ---------- */

function NodeMenu({
  menu,
  onPick,
  onClose,
}: {
  menu: MenuState;
  onPick: (t: NodeType) => void;
  onClose: () => void;
}) {
  const list = CREATABLE.map((t) => (
    <MenuItem key={t} onClick={() => onPick(t)}>
      <span className="menu-dot" style={{ background: META[t].color }} />
      {META[t].title}
    </MenuItem>
  ));

  return (
    <ContextMenu x={menu.clientX} y={menu.clientY} onClose={onClose}>
      {menu.from ? (
        <>
          <div className="menu-title">Создать и соединить</div>
          {list}
        </>
      ) : (
        <SubMenu label="Создать">{list}</SubMenu>
      )}
    </ContextMenu>
  );
}

/* ---------- Правая панель выбранного узла ---------- */

function Num({
  label,
  value,
  onChange,
  min,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        onChange={(e) => {
          let v = parseInt(e.target.value, 10);
          if (Number.isNaN(v)) v = 0;
          if (min !== undefined && v < min) v = min;
          onChange(v);
        }}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <Dropdown value={value} options={options} onChange={onChange} />
    </label>
  );
}

function NodeInspector({
  node,
  onPatch,
  onRemove,
}: {
  node: FlowNode;
  onPatch: (p: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const t = node.type as NodeType;
  const d = node.data;
  return (
    <div className="panel">
      <h3 style={{ color: META[t].color }}>{META[t].title}</h3>

      {t === 'start' && <p className="muted">Начало макроса. Соедините выход этого узла со следующим действием.</p>}

      {t === 'key' && (
        <>
          <label className="field">
            <span>Клавиша</span>
            <KeyCapture value={d.key} onChange={(k) => onPatch({ key: k })} />
          </label>
          <Select
            label="Действие"
            value={d.action}
            onChange={(v) => onPatch({ action: v })}
            options={[
              ['press', 'Нажать и отпустить'],
              ['down', 'Зажать'],
              ['up', 'Отпустить'],
            ]}
          />
          {d.action === 'press' && (
            <Num label="Держать, мс" value={d.holdMs} min={0} onChange={(v) => onPatch({ holdMs: v })} />
          )}
        </>
      )}

      {t === 'mouse' && (
        <>
          <Select
            label="Кнопка"
            value={d.button}
            onChange={(v) => onPatch({ button: v })}
            options={[
              ['left', 'Левая'],
              ['right', 'Правая'],
              ['middle', 'Средняя'],
              ['x1', 'Боковая X1 (назад)'],
              ['x2', 'Боковая X2 (вперёд)'],
            ]}
          />
          <Select
            label="Действие"
            value={d.action}
            onChange={(v) => onPatch({ action: v })}
            options={[
              ['click', 'Клик'],
              ['down', 'Зажать'],
              ['up', 'Отпустить'],
            ]}
          />
          {d.action === 'click' && (
            <Num label="Держать, мс" value={d.holdMs} min={0} onChange={(v) => onPatch({ holdMs: v })} />
          )}
        </>
      )}

      {t === 'mouseMove' && (
        <>
          <button
            disabled={!isTauri()}
            title={isTauri() ? undefined : 'Работает только в приложении'}
            onClick={async () => {
              const p = await pickPoint();
              if (p) onPatch({ x: p.x, y: p.y, relative: false });
            }}
          >
            Выбрать точку на экране
          </button>
          <Num label="X" value={d.x} onChange={(v) => onPatch({ x: v })} />
          <Num label="Y" value={d.y} onChange={(v) => onPatch({ y: v })} />
          <label className="check">
            <input
              type="checkbox"
              checked={!!d.relative}
              onChange={(e) => onPatch({ relative: e.target.checked })}
            />
            Сдвиг от текущей позиции (иначе — точка на экране в пикселях)
          </label>
        </>
      )}

      {t === 'scroll' && (
        <Num
          label="Щелчков колеса"
          value={d.amount}
          onChange={(v) => onPatch({ amount: v })}
          hint="Больше нуля — вверх, меньше нуля — вниз."
        />
      )}

      {t === 'delay' && (
        <>
          <Num label="Пауза, мс" value={d.ms} min={0} onChange={(v) => onPatch({ ms: v })} />
          <Num
            label="Случайная добавка, мс"
            value={d.jitterMs}
            min={0}
            onChange={(v) => onPatch({ jitterMs: v })}
            hint="К паузе добавится случайное число от 0 до этого значения."
          />
        </>
      )}

      {t === 'loop' && (
        <>
          <Num
            label="Повторов"
            value={d.count}
            min={0}
            onChange={(v) => onPatch({ count: v })}
            hint="0 — бесконечно (до остановки макроса)."
          />
          <p className="muted">
            Выход справа («тело») — что повторять. Выход снизу — что делать после цикла.
          </p>
        </>
      )}

      {t !== 'start' && (
        <button className="danger" onClick={onRemove}>
          Удалить узел
        </button>
      )}
    </div>
  );
}
