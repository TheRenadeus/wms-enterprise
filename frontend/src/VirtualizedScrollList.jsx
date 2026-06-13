// Lista virtualizada con react-window (P13).
//
// Renderiza solo los items visibles en viewport, lo que mantiene el DOM chico
// aún con miles de elementos. Si items.length < threshold, hace render normal
// (no vale la pena virtualizar listas chicas).
//
// Uso:
//   <VirtualizedScrollList items={logs} itemSize={48} height={400}
//     renderItem={(item, index) => <Row key={item.id} log={item} />} />
//
// NOTA: este componente renderiza divs (no <tr>). Para virtualizar las tablas
// actuales del WMS (audit, inventory) hay que convertir <table>/<tr>/<td> a
// <div grid> primero — preservando todo el styling Tailwind. Eso queda como
// TODO porque requiere refactor visual cuidadoso. Por ahora, las tablas
// mantienen su paginación local (auditPage, invPage) que es eficiente para
// los volúmenes server-side actuales (limit 200 max por request).

import React from 'react';
import { List } from 'react-window';

const VIRTUALIZE_THRESHOLD = 100;

export default function VirtualizedScrollList({
  items,
  itemSize = 48,
  height = 400,
  width = '100%',
  renderItem,
  className = '',
  emptyState = null,
}) {
  if (!items || items.length === 0) return emptyState;

  if (items.length < VIRTUALIZE_THRESHOLD) {
    return (
      <div className={className} style={{ maxHeight: height, overflowY: 'auto' }}>
        {items.map((item, i) => renderItem(item, i))}
      </div>
    );
  }

  const RowComponent = ({ index, style }) => (
    <div style={style}>{renderItem(items[index], index)}</div>
  );

  // react-window v2: <List> con rowComponent + rowProps + rowCount + rowHeight.
  return (
    <List
      className={className}
      style={{ height, width }}
      rowComponent={RowComponent}
      rowCount={items.length}
      rowHeight={itemSize}
      rowProps={{}}
    />
  );
}
