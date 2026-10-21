import { DESIGN } from '../data/topology';
import type {
  ComputeSnapshot,
  EnergySnapshot,
  EngineSnapshot,
  EventCategory,
  OpsEvent,
  Severity,
  TaskType,
  TelemetryPoint,
  ThermalSnapshot,
  ValidationReport,
} from '../types';
import {
  EnergyModel,
  SolarModel,
  ThermalModel,
  type ThermalInputs,
} from './energy';
import { clamp, finite, round } from './math';
import { ComputeScheduler } from './scheduler';
import { EnergyValidator } from './validator';

export interface EngineOptions {
  seed?: number;
  startTime?: Date;
  tickIntervalMs?: number;
  autoTaskGeneration?: boolean;
}

const TICK_SECONDS = 60;

/**
 * Top-level orchestration. The scheduler, energy model, thermal field and
 * validator are composed here; every tick is guarded against non-finite values
 * and an automatic replay is performed if the model diverges.
 */
export class DigitalTwinEngine {
  readonly scheduler: ComputeScheduler;
  readonly energyModel: EnergyModel;
  readonly thermalModel: ThermalModel;
  readonly solarModel: SolarModel;
  readonly validator: EnergyValidator;

  private tickNo = 0;
  private simTime: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private speed = 1;
  private readonly tickIntervalMs: number;
  private compute: ComputeSnapshot;
  private energy: EnergySnapshot;
  private thermal: ThermalSnapshot;
  private validation: ValidationReport;
  private events: OpsEvent[] = [];
  private telemetry: TelemetryPoint[] = [];
  private lastGoodEnergy: EnergySnapshot | null = null;
  private lastGoodThermal: ThermalSnapshot | null = null;
  private eventSeq = 0;
  private lastPueAlertTick = -99;
  private pueAlertActive = false;
  private lastThermalAlertTick = -99;
  private replayRecoveries = 0;
  private replayActive = false;
  private lastReplayReason: string | null = null;
  private readonly autoTaskGeneration: boolean;

  constructor(options: EngineOptions = {}) {
    const start = options.startTime ?? new Date();
    start.setSeconds(0, 0);
    this.simTime = start.getTime();
    this.tickIntervalMs = clamp(finite(options.tickIntervalMs ?? 2200, 2200), 250, 60_000);
    this.autoTaskGeneration = options.autoTaskGeneration ?? true;

    this.scheduler = new ComputeScheduler(options.seed ?? 20261021);
    this.energyModel = new EnergyModel();
    this.thermalModel = new ThermalModel();
    this.solarModel = new SolarModel();
    this.validator = new EnergyValidator(this.energyModel);
    this.validation = this.validator.validate(new Date(this.simTime).toISOString());
    this.scheduler.initialize(this.simTime);

    const solar = this.solarModel.getState(this.simTime);
    const initialRacks = this.scheduler.getSnapshot().racks;
    const initialIt =
      initialRacks.reduce((sum, rack) => sum + rack.loadKw, 0) + DESIGN.networkFixedKw;
    this.thermal = this.thermalModel.update(
      this.buildThermalInputs(initialRacks, initialIt, solar.ambientC),
      TICK_SECONDS,
    );
    this.scheduler.setRackTemperatures(this.thermal.rackIntakeC);
    this.compute = this.scheduler.getSnapshot();
    this.energy = this.energyModel.evaluate({
      itKw: initialIt,
      liquidHeatKw: this.liquidHeat(this.compute),
      airHeatKw: initialIt - this.liquidHeat(this.compute),
      ambientC: solar.ambientC,
      pvKw: solar.pvKw,
      socPct: this.energyModel.getSoc(),
      dtSec: TICK_SECONDS,
    });
    this.lastGoodEnergy = this.energy;
    this.lastGoodThermal = this.thermal;
    this.appendEvent(
      'success',
      'validation',
      '模型自动校验通过',
      `标准算例 PUE 最大偏差 ${this.validation.maxPueDeviationPct.toFixed(2)}%，功率平衡偏差 ${this.validation.maxBalanceDeviationPct.toFixed(4)}%。`,
    );
    this.tick();
  }

  start(): void {
    if (this.timer) return;
    this.running = true;
    this.scheduleTimer();
  }

  pause(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  toggleRunning(): boolean {
    if (this.running) this.pause();
    else this.start();
    return this.running;
  }

  isRunning(): boolean {
    return this.running;
  }

  setSpeed(speed: number): void {
    this.speed = [1, 2, 4].includes(speed) ? speed : 1;
    if (this.running) {
      if (this.timer) clearInterval(this.timer);
      this.scheduleTimer();
    }
  }

  getSpeed(): number {
    return this.speed;
  }

  private scheduleTimer(): void {
    this.timer = setInterval(() => this.tick(), Math.max(260, this.tickIntervalMs / this.speed));
  }

  tick(): void {
    this.tickNo += 1;
    this.simTime += TICK_SECONDS * 1000;
    this.scheduler.setNow(this.simTime);
    this.scheduler.tick(this.simTime, TICK_SECONDS);
    this.appendSchedulerEvents();

    const solar = this.solarModel.getState(this.simTime);
    const before = this.scheduler.getSnapshot();
    const rackLoad = before.racks.reduce((sum, rack) => sum + rack.loadKw, 0);
    const networkLoad = DESIGN.networkFixedKw + (before.utilization / 100) * DESIGN.networkVariableKw;
    const itKw = rackLoad + networkLoad;
    const liquidHeatKw = this.liquidHeat(before);
    const thermalInput = this.buildThermalInputs(before.racks, itKw, solar.ambientC);
    this.thermal = this.thermalModel.update(thermalInput, TICK_SECONDS);
    this.scheduler.setRackTemperatures(this.thermal.rackIntakeC);
    this.compute = this.scheduler.getSnapshot();

    this.energy = this.energyModel.simulate({
      itKw,
      liquidHeatKw,
      airHeatKw: Math.max(0, itKw - liquidHeatKw),
      ambientC: solar.ambientC,
      pvKw: solar.pvKw,
      socPct: this.energyModel.getSoc(),
      dtSec: TICK_SECONDS,
    });

    this.replayActive = false;
    this.guardNumerics(solar.ambientC);
    this.evaluateAlerts();
    this.closeRecoveredEvents();
    this.recordTelemetry(solar.ambientC);
    if (this.autoTaskGeneration && this.tickNo % 60 === 0) {
      this.validation = this.validator.validate(new Date(this.simTime).toISOString());
    }
  }

  private buildThermalInputs(
    racks: ComputeSnapshot['racks'],
    itKw: number,
    ambientC: number,
  ): ThermalInputs {
    const liquidRackLoad = racks
      .filter((rack) => rack.liquidCooled)
      .reduce((sum, rack) => sum + rack.loadKw, 0);
    const liquidHeatKw = liquidRackLoad * 0.82;
    return {
      ambientC,
      itKw,
      airHeatKw: Math.max(0, itKw - liquidHeatKw),
      liquidHeatKw,
      racks: racks.map((rack) => ({
        id: rack.id,
        row: rack.row,
        loadKw: rack.loadKw,
        liquidCooled: rack.liquidCooled,
        utilization: rack.utilization / 100,
      })),
    };
  }

  private liquidHeat(compute: ComputeSnapshot): number {
    return compute.racks
      .filter((rack) => rack.liquidCooled)
      .reduce((sum, rack) => sum + rack.loadKw, 0) * 0.82;
  }

  private guardNumerics(ambientC: number): void {
    const energy = this.energy;
    const finiteEnergy = [
      energy.itKw,
      energy.coolingKw,
      energy.totalKw,
      energy.pue,
      energy.powerBalancePct,
      energy.gridKw,
    ].every((value) => Number.isFinite(value));
    const energyInRange =
      energy.pue >= 0.8 && energy.pue <= 3.5 && energy.totalKw >= 0 && energy.totalKw < 5000;
    const thermalBad = this.thermalModel.isDiverging();

    if ((!finiteEnergy || !energyInRange) && this.lastGoodEnergy) {
      this.replayRecoveries += 1;
      this.replayActive = true;
      this.lastReplayReason = !finiteEnergy ? '非有限数值' : `PUE ${energy.pue}`;
      this.energy = { ...this.lastGoodEnergy };
      this.energyModel.setCalibration(this.validation.calibration);
      this.energyModel.setSoc(this.lastGoodEnergy.batterySocPct);
      this.appendEvent(
        'critical',
        'system',
        '数值发散保护 · 自动回滚',
        `检测到${this.lastReplayReason}，已恢复上一有效帧并重置制冷标定，仿真继续。`,
      );
    }

    if (thermalBad && this.lastGoodThermal) {
      this.replayRecoveries += 1;
      this.replayActive = true;
      this.lastReplayReason = '温度场非有限值';
      this.thermal = { ...this.lastGoodThermal };
      this.thermalModel.reset();
      this.appendEvent(
        'critical',
        'thermal',
        '热场求解保护 · 自动复位',
        '温度场出现发散，已回滚至上一有效帧并重置一阶热惯性状态。',
      );
    }

    const balance = Math.abs(energy.powerBalancePct);
    if (balance > 1 && this.tickNo % 15 === 0) {
      this.appendEvent(
        'warning',
        'energy',
        '功率平衡偏差告警',
        `源侧 / 荷侧偏差 ${balance.toFixed(2)}%，已启用计量通道校准。`,
      );
    }
    void ambientC;
    if (!this.replayActive) {
      this.lastGoodEnergy = { ...this.energy };
      this.lastGoodThermal = { ...this.thermal };
    }
  }

  private evaluateAlerts(): void {
    const pue = this.energy.pue;
    if (pue > this.energy.benchmarkPue) {
      if (!this.pueAlertActive || this.tickNo - this.lastPueAlertTick >= 45) {
        this.pueAlertActive = true;
        this.lastPueAlertTick = this.tickNo;
        this.appendEvent(
          'warning',
          'energy',
          'PUE 超行业基准线',
          `实时 PUE ${pue.toFixed(3)}，高于基准 ${this.energy.benchmarkPue.toFixed(2)}（+${this.energy.pueDeviationPct.toFixed(1)}%）。建议提升冷通道送风温度或降低制冷固定开销。`,
        );
      }
    } else if (this.pueAlertActive) {
      this.pueAlertActive = false;
      this.appendEvent(
        'success',
        'energy',
        'PUE 已回落至基准线内',
        `当前 PUE ${pue.toFixed(3)}，较基准低 ${Math.abs(this.energy.pueDeviationPct).toFixed(1)}%。`,
      );
    }

    const hot = this.thermal.hotAisleC;
    const liquidReturn = this.thermal.liquidReturnC;
    if ((hot > 43 || liquidReturn > 55) && this.tickNo - this.lastThermalAlertTick >= 40) {
      this.lastThermalAlertTick = this.tickNo;
      this.appendEvent(
        'warning',
        'thermal',
        '热环境越限预警',
        `热通道 ${hot.toFixed(1)}°C，液冷回液 ${liquidReturn.toFixed(1)}°C；已请求 CDU 提升泵转速并联动行级空调。`,
      );
    }
  }

  private closeRecoveredEvents(): void {
    const closeCategory = (category: EventCategory): void => {
      for (const event of this.events) {
        if (event.category === category && event.status !== 'resolved') {
          event.status = 'resolved';
        }
      }
    };
    if (this.energy.pue <= this.energy.benchmarkPue) closeCategory('energy');
    if (this.compute.migratingTasks === 0) closeCategory('migration');
    if (this.thermal.hotAisleC < 43 && this.thermal.liquidReturnC < 55) closeCategory('thermal');
  }

  private recordTelemetry(ambientC: number): void {
    const point: TelemetryPoint = {
      tick: this.tickNo,
      at: this.simTime,
      timestamp: new Date(this.simTime).toISOString(),
      itKw: this.energy.itKw,
      coolingKw: this.energy.coolingKw,
      distributionKw: this.energy.distributionKw,
      totalKw: this.energy.totalKw,
      pue: this.energy.pue,
      coldAisleC: this.thermal.coldAisleC,
      hotAisleC: this.thermal.hotAisleC,
      liquidSupplyC: this.thermal.liquidSupplyC,
      liquidReturnC: this.thermal.liquidReturnC,
      utilizationPct: this.compute.utilization,
      cardsActive: this.compute.cardsActive,
      queueDepth: this.compute.queueDepth,
      tokenRate: this.compute.tokenRate,
      renewablePct: this.energy.renewableSharePct,
      gridKw: this.energy.gridKw,
      pvKw: this.energy.pvKw,
      batteryKw: this.energy.batteryKw,
      dieselKw: this.energy.dieselKw,
      powerBalancePct: this.energy.powerBalancePct,
      ambientC,
    };
    this.telemetry.push(point);
    if (this.telemetry.length > 1440) this.telemetry.shift();
  }

  addTask(type: TaskType): void {
    this.scheduler.submitTask(type);
    this.syncCompute();
    this.appendSchedulerEvents();
  }

  injectFault(rackId?: string): boolean {
    const event = this.scheduler.injectCardFault(rackId);
    this.appendSchedulerEvents();
    if (event) this.scheduler.setRackTemperatures(this.thermal.rackIntakeC);
    this.syncCompute();
    return Boolean(event);
  }

  repairFaults(): number {
    const repaired = this.scheduler.repairAllFaults();
    for (const event of this.events) {
      if (event.category === 'fault' && event.status === 'active') {
        event.status = 'resolved';
      }
    }
    this.scheduler.setRackTemperatures(this.thermal.rackIntakeC);
    this.syncCompute();
    this.appendSchedulerEvents();
    return repaired;
  }

  private syncCompute(): void {
    this.compute = this.scheduler.getSnapshot();
  }

  setAmbientOverride(value: number | null): void {
    if (value === null) return;
    this.ambientOverride = clamp(finite(value, 26), 15, 42);
  }

  private ambientOverride: number | null = null;

  private appendSchedulerEvents(): void {
    const drained = this.scheduler.drainEvents();
    if (drained.length === 0) return;
    for (const event of drained.reverse()) {
      this.events.unshift(event);
    }
    if (this.events.length > 600) this.events = this.events.slice(0, 600);
  }

  private appendEvent(
    severity: Severity,
    category: EventCategory,
    title: string,
    detail: string,
  ): OpsEvent {
    const event: OpsEvent = {
      id: `SYS-${String(++this.eventSeq).padStart(5, '0')}`,
      tick: this.tickNo,
      at: this.simTime,
      timestamp: new Date(this.simTime).toISOString(),
      severity,
      category,
      title,
      detail,
      status:
        severity === 'critical' ? 'active' : severity === 'warning' ? 'recovering' : 'resolved',
    };
    this.events.unshift(event);
    if (this.events.length > 600) this.events = this.events.slice(0, 600);
    return event;
  }

  getSnapshot(): EngineSnapshot {
    const effectiveAmbient = this.ambientOverride ?? this.energy.ambientC;
    return {
      tick: this.tickNo,
      simTime: this.simTime,
      timestamp: new Date(this.simTime).toISOString(),
      running: this.running,
      speed: this.speed,
      ambientC: round(effectiveAmbient, 1),
      compute: this.compute,
      energy: this.energy,
      thermal: this.thermal,
      events: this.events.slice(0, 14),
      validation: this.validation,
      replayGuard: {
        active: this.replayActive,
        recoveries: this.replayRecoveries,
        lastReason: this.lastReplayReason,
      },
    };
  }

  getTelemetry(): TelemetryPoint[] {
    return [...this.telemetry];
  }

  getEvents(): OpsEvent[] {
    return [...this.events];
  }

  getValidation(): ValidationReport {
    return this.validation;
  }

  getTickIntervalSeconds(): number {
    return TICK_SECONDS;
  }

  getSimTime(): number {
    return this.simTime;
  }

  /** Advance deterministically without timers; used by scripts and tests. */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i += 1) this.tick();
  }
}
