export type TaskType = 'training' | 'inference';
export type TaskStatus = 'queued' | 'running' | 'migrating' | 'completed';
export type Severity = 'critical' | 'warning' | 'info' | 'success';
export type EventCategory =
  | 'fault'
  | 'migration'
  | 'scheduler'
  | 'energy'
  | 'thermal'
  | 'validation'
  | 'system';

export interface RackDefinition {
  id: string;
  row: string;
  slot: number;
  liquidCooled: boolean;
  x: number;
  z: number;
  facing: 1 | -1;
}

export interface NpuState {
  id: string;
  rackId: string;
  slot: number;
  healthy: boolean;
  taskId: string | null;
  activity: number;
}

export interface RackState {
  id: string;
  row: string;
  slot: number;
  liquidCooled: boolean;
  totalCards: number;
  healthyCards: number;
  allocatedCards: number;
  activeCards: number;
  utilization: number;
  loadKw: number;
  exhaustC: number;
  intakeC: number;
  status: 'idle' | 'running' | 'degraded' | 'fault';
}

export interface ComputeTask {
  id: string;
  name: string;
  type: TaskType;
  status: TaskStatus;
  cards: number;
  priority: number;
  npuIds: string[];
  rackIds: string[];
  progress: number;
  durationSec: number;
  remainingSec: number;
  tokensProcessed: number;
  tokensPerSecond: number;
  tokensPerCardSec: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  migrationCount: number;
  accent: string;
}

export interface MigrationRecord {
  id: string;
  taskId: string;
  taskName: string;
  cards: number;
  fromRack: string;
  toRacks: string[];
  startedAt: number;
  remainingTicks: number;
  status: 'in-progress' | 'completed' | 'queued';
}

export interface OpsEvent {
  id: string;
  tick: number;
  at: number;
  timestamp: string;
  severity: Severity;
  category: EventCategory;
  title: string;
  detail: string;
  status: 'active' | 'recovering' | 'resolved';
  rackId?: string;
  taskId?: string;
}

export interface ComputeSnapshot {
  cardsTotal: number;
  cardsHealthy: number;
  cardsAllocated: number;
  cardsActive: number;
  utilization: number;
  queueDepth: number;
  runningTasks: number;
  migratingTasks: number;
  faultCards: number;
  tokenRate: number;
  tokensTotal: number;
  racks: RackState[];
  tasks: ComputeTask[];
  queue: ComputeTask[];
  migrations: MigrationRecord[];
  theoreticalPflops: number;
}

export interface EnergyComponents {
  it: number;
  cooling: number;
  distribution: number;
  other: number;
  total: number;
}

export interface EnergySources {
  grid: number;
  pv: number;
  battery: number;
  diesel: number;
  batteryCharge: number;
  export: number;
}

export interface EnergySnapshot {
  itKw: number;
  coolingKw: number;
  airCoolingKw: number;
  liquidCoolingKw: number;
  distributionKw: number;
  otherKw: number;
  totalKw: number;
  pue: number;
  benchmarkPue: number;
  pueStatus: 'optimal' | 'normal' | 'warning';
  pueDeviationPct: number;
  coolingSharePct: number;
  renewableSharePct: number;
  ambientC: number;
  cop: number;
  solarKw: number;
  batterySocPct: number;
  batteryKw: number;
  gridKw: number;
  pvKw: number;
  dieselKw: number;
  powerBalanceKw: number;
  powerBalancePct: number;
  components: EnergyComponents;
  sources: EnergySources;
}

export interface ThermalSnapshot {
  coldAisleC: number;
  hotAisleC: number;
  liquidSupplyC: number;
  liquidReturnC: number;
  coldAisleAB: number;
  coldAisleCD: number;
  hotAisleCenter: number;
  rackTempsC: Record<string, number>;
  rackIntakeC: Record<string, number>;
}

export interface TelemetryPoint {
  tick: number;
  at: number;
  timestamp: string;
  itKw: number;
  coolingKw: number;
  distributionKw: number;
  totalKw: number;
  pue: number;
  coldAisleC: number;
  hotAisleC: number;
  liquidSupplyC: number;
  liquidReturnC: number;
  utilizationPct: number;
  cardsActive: number;
  queueDepth: number;
  tokenRate: number;
  renewablePct: number;
  gridKw: number;
  pvKw: number;
  batteryKw: number;
  dieselKw: number;
  powerBalancePct: number;
  ambientC: number;
}

export interface ValidationCaseResult {
  name: string;
  description: string;
  itKw: number;
  actualPue: number;
  referencePue: number;
  pueDeviationPct: number;
  balanceDeviationPct: number;
  coolingKw: number;
  totalKw: number;
  corrections: string[];
  passed: boolean;
}

export interface ValidationReport {
  checkedAt: string;
  status: 'pass' | 'corrected' | 'fail';
  passed: boolean;
  maxPueDeviationPct: number;
  maxBalanceDeviationPct: number;
  calibration: {
    coolingScale: number;
    distributionScale: number;
    balanceTrimKw: number;
  };
  cases: ValidationCaseResult[];
  correctionCount: number;
}

export interface EngineSnapshot {
  tick: number;
  simTime: number;
  timestamp: string;
  running: boolean;
  speed: number;
  ambientC: number;
  compute: ComputeSnapshot;
  energy: EnergySnapshot;
  thermal: ThermalSnapshot;
  events: OpsEvent[];
  validation: ValidationReport;
  replayGuard: {
    active: boolean;
    recoveries: number;
    lastReason: string | null;
  };
}

export interface SolarState {
  pvKw: number;
  solarFactor: number;
  ambientC: number;
  weather: string;
}

export interface DeviceInfo {
  id: string;
  kind: string;
  name: string;
  subtitle: string;
  status: string;
  tone: 'cyan' | 'green' | 'amber' | 'red' | 'violet';
  metrics: Array<{ label: string; value: string }>;
  detail: string;
}
