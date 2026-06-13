// Tab "Mapa 3D Bodega" — lazy-loaded (P15).
// Wrapper alrededor de DigitalTwinView (definido en components.jsx).
// Nota: DigitalTwinView todavía vive en components.jsx, que se carga eagerly.
// El chunk lazy de este tab es chico mientras components.jsx no se rompa por dominio.

import React from 'react';
import { DigitalTwinView } from '../components';

export default function DigitalTwinTab({ inventory, locations, warehouses, zones, getStatusBadge, clients }) {
  return (
    <DigitalTwinView
      inventory={inventory}
      locations={locations}
      warehouses={warehouses}
      zones={zones}
      getStatusBadge={getStatusBadge}
      clients={clients}
    />
  );
}
