import type { OpsEvent, TelemetryPoint } from '../types';

const escapeCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const toRow = (values: Array<string | number>): string => values.map(escapeCell).join(',');

export function telemetryToCsv(points: TelemetryPoint[]): string {
  const header = [
    'timestamp',
    'tick',
    'it_kw',
    'cooling_kw',
    'distribution_kw',
    'total_kw',
    'pue',
    'cold_aisle_c',
    'hot_aisle_c',
    'liquid_supply_c',
    'liquid_return_c',
    'utilization_pct',
    'active_cards',
    'queue_depth',
    'token_per_sec',
    'renewable_pct',
    'grid_kw',
    'pv_kw',
    'battery_kw',
    'diesel_kw',
    'power_balance_pct',
    'ambient_c',
  ];
  const rows = points.map((point) =>
    toRow([
      point.timestamp,
      point.tick,
      point.itKw,
      point.coolingKw,
      point.distributionKw,
      point.totalKw,
      point.pue,
      point.coldAisleC,
      point.hotAisleC,
      point.liquidSupplyC,
      point.liquidReturnC,
      point.utilizationPct,
      point.cardsActive,
      point.queueDepth,
      point.tokenRate,
      point.renewablePct,
      point.gridKw,
      point.pvKw,
      point.batteryKw,
      point.dieselKw,
      point.powerBalancePct,
      point.ambientC,
    ]),
  );
  return `\uFEFF${[toRow(header), ...rows].join('\r\n')}\r\n`;
}

export function eventsToCsv(events: OpsEvent[]): string {
  const header = [
    'timestamp',
    'tick',
    'severity',
    'category',
    'title',
    'detail',
    'status',
    'rack_id',
    'task_id',
  ];
  const rows = events.map((event) =>
    toRow([
      event.timestamp,
      event.tick,
      event.severity,
      event.category,
      event.title,
      event.detail,
      event.status,
      event.rackId ?? '',
      event.taskId ?? '',
    ]),
  );
  return `\uFEFF${[toRow(header), ...rows].join('\r\n')}\r\n`;
}

export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
