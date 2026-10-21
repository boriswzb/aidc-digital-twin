import {
  DESIGN,
  NPUS_PER_RACK,
  NPU_TFLOPS,
  RACK_DEFINITIONS,
  TASK_TEMPLATES,
} from '../data/topology';
import type {
  ComputeSnapshot,
  ComputeTask,
  MigrationRecord,
  NpuState,
  OpsEvent,
  RackDefinition,
  RackState,
  TaskType,
} from '../types';
import { Rng, clamp, finite, round } from './math';

interface RackRuntime {
  def: RackDefinition;
  npus: NpuState[];
}

interface SeedTask {
  template: number;
  cards: number;
  replica?: string;
}

const SEED_TASKS: SeedTask[] = [
  { template: 0, cards: 64 },
  { template: 1, cards: 32 },
  { template: 1, cards: 48, replica: 'B' },
  { template: 2, cards: 64 },
  { template: 3, cards: 40 },
  { template: 4, cards: 40, replica: 'B' },
];

/**
 * NPU cluster scheduler. It owns card-level placement, queueing and
 * live migration. A failed card never silently disappears: its task is either
 * relocated onto healthy spare capacity or safely returned to the queue.
 */
export class ComputeScheduler {
  private racks: RackRuntime[] = [];
  private npus = new Map<string, NpuState>();
  private tasks = new Map<string, ComputeTask>();
  private history: ComputeTask[] = [];
  private migrations: MigrationRecord[] = [];
  private events: OpsEvent[] = [];
  private rackTemps: Record<string, number> = {};
  private rng: Rng;
  private tickNo = 0;
  private simNow = Date.now();
  private taskSeq = 7000;
  private migrationSeq = 0;
  private eventSeq = 0;
  private nextAutoTaskTick = 10;
  private tokenTotal = 0;
  private initialized = false;

  constructor(seed = 20261021) {
    this.rng = new Rng(seed);
    this.buildTopology();
  }

  initialize(nowMs = Date.now()): void {
    if (this.initialized) return;
    this.initialized = true;
    this.simNow = nowMs;
    this.tasks.clear();
    this.history = [];
    this.migrations = [];
    this.events = [];
    this.tickNo = 0;
    this.taskSeq = 7000;
    this.eventSeq = 0;
    this.tokenTotal = 0;
    for (const npu of this.npus.values()) {
      npu.healthy = true;
      npu.taskId = null;
      npu.activity = 0;
    }

    for (const seed of SEED_TASKS) {
      const task = this.createTask(seed.template, seed.cards, nowMs, seed.replica);
      if (!this.dispatch(task)) {
        task.status = 'queued';
      }
    }

    this.emit(
      'info',
      'system',
      '算力调度器就绪',
      `384 张 NPU 已纳管，Spine-Leaf 无损网络与 UnifiedBus 互联自检通过。`,
    );
    this.emit(
      'success',
      'scheduler',
      '初始训练 / 推理负载已编排',
      `${this.tasks.size} 个任务完成首次放置，当前空闲算力 ${this.freeNpuCount()} 卡。`,
    );
    this.refreshRacks();
  }

  private buildTopology(): void {
    this.racks = RACK_DEFINITIONS.map((def) => {
      const npus: NpuState[] = [];
      for (let slot = 0; slot < NPUS_PER_RACK; slot += 1) {
        const id = `${def.id}-N${String(slot + 1).padStart(2, '0')}`;
        const npu: NpuState = {
          id,
          rackId: def.id,
          slot,
          healthy: true,
          taskId: null,
          activity: 0,
        };
        npus.push(npu);
        this.npus.set(id, npu);
      }
      return { def, npus };
    });
  }

  private createTask(
    templateIndex: number,
    cards: number,
    nowMs: number,
    replica = '',
  ): ComputeTask {
    const template = TASK_TEMPLATES[templateIndex % TASK_TEMPLATES.length];
    const prefix = template.type === 'training' ? 'TRN' : 'INF';
    this.taskSeq += 1;
    const id = `${prefix}-${this.taskSeq}${replica ? `-${replica}` : ''}`;
    const safeCards = clamp(Math.round(cards), 1, 384);
    return {
      id,
      name: `${template.name}${replica ? ` · 副本${replica}` : ''}`,
      type: template.type,
      status: 'queued',
      cards: safeCards,
      priority: template.priority,
      npuIds: [],
      rackIds: [],
      progress: 0,
      durationSec: template.durationSec,
      remainingSec: template.durationSec,
      tokensProcessed: 0,
      tokensPerSecond: 0,
      tokensPerCardSec: template.tokensPerCardSec,
      createdAt: nowMs,
      startedAt: null,
      finishedAt: null,
      migrationCount: 0,
      accent: template.accent,
    };
  }

  submitTask(type: TaskType): ComputeTask {
    const candidates =
      type === 'training'
        ? TASK_TEMPLATES.map((t, i) => ({ t, i })).filter(({ t }) => t.type === 'training')
        : TASK_TEMPLATES.map((t, i) => ({ t, i })).filter(({ t }) => t.type === 'inference');
    const selected = this.rng.pick(candidates);
    const cards =
      type === 'training'
        ? this.rng.pick([16, 32, 48])
        : this.rng.pick([8, 16, 32]);
    const task = this.createTask(selected.i, cards, this.simNow);
    this.tasks.set(task.id, task);
    if (!this.dispatch(task)) {
      this.emit(
        'warning',
        'scheduler',
        '任务进入等待队列',
        `${task.name} 需要 ${task.cards} 卡，当前健康空闲卡不足，等待资源释放。`,
        { taskId: task.id },
      );
    } else {
      this.emit(
        'info',
        'scheduler',
        '新任务已自动调度',
        `${task.name} 已放置到 ${task.rackIds.join(' / ')}，占用 ${task.cards} 张 NPU。`,
        { taskId: task.id },
      );
    }
    this.refreshRacks();
    return this.cloneTask(task);
  }

  private dispatch(task: ComputeTask): boolean {
    if (task.status === 'completed') return false;
    const free = this.pickFreeNpus(task.cards, task.type);
    if (free.length < task.cards) return false;
    task.npuIds = free.map((npu) => npu.id);
    task.rackIds = [...new Set(free.map((npu) => npu.rackId))].sort();
    task.status = 'running';
    task.startedAt ??= this.simNow;
    for (const npu of free) {
      npu.taskId = task.id;
      npu.activity = 1;
    }
    this.tasks.set(task.id, task);
    return true;
  }

  private pickFreeNpus(count: number, type: TaskType): NpuState[] {
    if (count <= 0) return [];
    const racks = this.racks
      .map((rack) => ({
        rack,
        free: rack.npus.filter((npu) => npu.healthy && !npu.taskId),
      }))
      .filter((entry) => entry.free.length > 0);

    if (type === 'inference') {
      racks.sort((a, b) => {
        const aFits = a.free.length >= count ? 1 : 0;
        const bFits = b.free.length >= count ? 1 : 0;
        if (aFits !== bFits) return bFits - aFits;
        return b.free.length - a.free.length || a.rack.def.id.localeCompare(b.rack.def.id);
      });
    } else {
      racks.sort(
        (a, b) => b.free.length - a.free.length || a.rack.def.id.localeCompare(b.rack.def.id),
      );
    }

    const picked: NpuState[] = [];
    for (const entry of racks) {
      if (picked.length >= count) break;
      const need = count - picked.length;
      picked.push(...entry.free.slice(0, need));
    }
    return picked.length === count ? picked : [];
  }

  private replacementNpus(count: number): NpuState[] {
    return this.pickFreeNpus(count, 'training');
  }

  private freeNpuCount(): number {
    let free = 0;
    for (const npu of this.npus.values()) {
      if (npu.healthy && !npu.taskId) free += 1;
    }
    return free;
  }

  tick(nowMs: number, dtSec: number): void {
    if (!this.initialized) this.initialize(nowMs);
    this.simNow = nowMs;
    this.tickNo += 1;

    this.advanceMigrations();

    for (const task of [...this.tasks.values()]) {
      if (task.status !== 'running') continue;
      const dt = clamp(finite(dtSec), 0, 3600);
      task.remainingSec = Math.max(0, task.remainingSec - dt);
      task.progress = clamp(1 - task.remainingSec / Math.max(1, task.durationSec), 0, 1);
      task.tokensPerSecond = task.cards * task.tokensPerCardSec;
      const produced = task.tokensPerSecond * dt;
      task.tokensProcessed += produced;
      this.tokenTotal += produced;
      if (task.remainingSec <= 0) this.completeTask(task);
    }

    for (const task of [...this.tasks.values()]) {
      if (task.status === 'queued' && this.dispatch(task)) {
        this.emit(
          'success',
          'scheduler',
          '排队任务恢复调度',
          `${task.name} 获取到 ${task.cards} 卡资源，开始执行。`,
          { taskId: task.id },
        );
      }
    }

    this.maybeInjectBackgroundLoad();
    this.refreshRacks();
  }

  private completeTask(task: ComputeTask): void {
    this.releaseTask(task);
    task.status = 'completed';
    task.progress = 1;
    task.remainingSec = 0;
    task.tokensPerSecond = 0;
    task.finishedAt = this.simNow;
    this.history.unshift(this.cloneTask(task));
    this.history = this.history.slice(0, 10);
    this.tasks.delete(task.id);
    this.emit(
      'success',
      'scheduler',
      '任务完成 · 资源已归还',
      `${task.name} 完成 ${(task.tokensProcessed / 1_000_000).toFixed(1)}M Token 处理，释放 ${task.cards} 张 NPU。`,
      { taskId: task.id },
    );
  }

  private releaseTask(task: ComputeTask): void {
    for (const id of task.npuIds) {
      const npu = this.npus.get(id);
      if (npu && npu.taskId === task.id) {
        npu.taskId = null;
        npu.activity = 0;
      }
    }
    task.npuIds = [];
    task.rackIds = [];
  }

  private maybeInjectBackgroundLoad(): void {
    if (this.tickNo < this.nextAutoTaskTick) return;
    this.nextAutoTaskTick = this.tickNo + this.rng.int(7, 14);
    if (this.tasks.size >= 9 || this.queueSnapshot().length >= 2) return;
    const templateIndex = this.rng.int(0, TASK_TEMPLATES.length - 1);
    const template = TASK_TEMPLATES[templateIndex];
    const cards =
      template.type === 'training'
        ? this.rng.pick([16, 32, 48])
        : this.rng.pick([8, 16, 32]);
    const task = this.createTask(templateIndex, cards, this.simNow);
    this.tasks.set(task.id, task);
    if (this.dispatch(task)) {
      this.emit(
        'info',
        'scheduler',
        '弹性负载已接入',
        `${task.name} 自动放置至 ${task.rackIds.join(' / ')}。`,
        { taskId: task.id },
      );
    } else {
      this.emit(
        'warning',
        'scheduler',
        '算力水位告警 · 任务排队',
        `${task.name} 等待 ${task.cards} 卡资源，队列深度 ${this.queueSnapshot().length}。`,
        { taskId: task.id },
      );
    }
  }

  injectCardFault(preferredRackId?: string): OpsEvent | null {
    const candidates = [...this.npus.values()].filter(
      (npu) => npu.healthy && npu.taskId && this.tasks.has(npu.taskId),
    );
    if (candidates.length === 0) return null;

    const preferred = preferredRackId
      ? candidates.filter((npu) => npu.rackId === preferredRackId)
      : [];
    const pool = preferred.length > 0 ? preferred : candidates;
    const failed = this.rng.pick(pool);
    const affectedTask = failed.taskId ? this.tasks.get(failed.taskId) : undefined;
    failed.healthy = false;
    failed.taskId = null;
    failed.activity = 0;

    const faultEvent = this.emit(
      'critical',
      'fault',
      `单卡故障 · ${failed.id}`,
      `${failed.rackId} 机柜检测到 NPU 掉卡，XID 79 / HBM 校验异常；${affectedTask ? `影响任务 ${affectedTask.name}` : '该卡当前空闲'}。`,
      { rackId: failed.rackId, taskId: affectedTask?.id },
    );

    if (affectedTask) {
      affectedTask.npuIds = affectedTask.npuIds.filter((id) => id !== failed.id);
      affectedTask.rackIds = [...new Set(affectedTask.npuIds.map((id) => this.npus.get(id)?.rackId ?? ''))].filter(Boolean);
      const replacements = this.replacementNpus(1);
      if (affectedTask.status === 'running' && replacements.length > 0) {
        const replacement = replacements[0];
        replacement.taskId = affectedTask.id;
        replacement.activity = 0.55;
        affectedTask.npuIds.push(replacement.id);
        affectedTask.rackIds = [...new Set([...affectedTask.rackIds, replacement.rackId])].sort();
        affectedTask.status = 'migrating';
        affectedTask.migrationCount += 1;
        this.migrations.unshift({
          id: `MIG-${String(++this.migrationSeq).padStart(4, '0')}`,
          taskId: affectedTask.id,
          taskName: affectedTask.name,
          cards: 1,
          fromRack: failed.rackId,
          toRacks: [replacement.rackId],
          startedAt: this.simNow,
          remainingTicks: 3,
          status: 'in-progress',
        });
        this.migrations = this.migrations.slice(0, 12);
        this.emit(
          'warning',
          'migration',
          '热迁移已触发 · 业务零中断',
          `${affectedTask.name} 的 1 张算力卡迁移至 ${replacement.rackId}，通过 UnifiedBus 同步 KV Cache，预计 3 个调度周期完成。`,
          { rackId: replacement.rackId, taskId: affectedTask.id },
        );
      } else {
        this.releaseTask(affectedTask);
        affectedTask.status = 'queued';
        affectedTask.tokensPerSecond = 0;
        this.migrations.unshift({
          id: `MIG-${String(++this.migrationSeq).padStart(4, '0')}`,
          taskId: affectedTask.id,
          taskName: affectedTask.name,
          cards: 1,
          fromRack: failed.rackId,
          toRacks: [],
          startedAt: this.simNow,
          remainingTicks: 0,
          status: 'queued',
        });
        this.migrations = this.migrations.slice(0, 12);
        this.emit(
          'critical',
          'migration',
          '迁移目标容量不足 · 任务回队',
          `${affectedTask.name} 暂停并从断点回队，保留已完成进度 ${(affectedTask.progress * 100).toFixed(1)}%，等待健康算力。`,
          { taskId: affectedTask.id },
        );
      }
    }

    this.refreshRacks();
    return faultEvent;
  }

  repairAllFaults(): number {
    let repaired = 0;
    for (const npu of this.npus.values()) {
      if (!npu.healthy) {
        npu.healthy = true;
        repaired += 1;
      }
    }
    for (const event of this.events) {
      if (event.category === 'fault' && event.status !== 'resolved') event.status = 'resolved';
    }
    if (repaired > 0) {
      this.emit(
        'success',
        'fault',
        '故障卡已完成隔离修复',
        `${repaired} 张 NPU 通过巡检恢复健康，重新加入可调度资源池。`,
      );
    }
    this.refreshRacks();
    return repaired;
  }

  private advanceMigrations(): void {
    for (const migration of this.migrations) {
      if (migration.status !== 'in-progress') continue;
      migration.remainingTicks = Math.max(0, migration.remainingTicks - 1);
      if (migration.remainingTicks > 0) continue;
      migration.status = 'completed';
      const task = this.tasks.get(migration.taskId);
      if (task) {
        task.status = 'running';
        for (const id of task.npuIds) {
          const npu = this.npus.get(id);
          if (npu) npu.activity = 1;
        }
        this.emit(
          'success',
          'migration',
          '热迁移完成 · 训练 / 推理续跑',
          `${task.name} 已在 ${migration.toRacks.join(' / ')} 恢复满速，断点进度 ${(task.progress * 100).toFixed(1)}%，未产生业务中断。`,
          { taskId: task.id, rackId: migration.toRacks[0] },
        );
      }
    }
  }

  setRackTemperatures(temps: Record<string, number>): void {
    this.rackTemps = temps;
  }

  private refreshRacks(): void {
    for (const rack of this.racks) {
      for (const npu of rack.npus) {
        const task = npu.taskId ? this.tasks.get(npu.taskId) : undefined;
        if (!task) {
          npu.activity = 0;
          if (npu.taskId) npu.taskId = null;
        } else if (task.status === 'migrating') {
          npu.activity = 0.55;
        } else if (task.status === 'running') {
          npu.activity = 1;
        } else {
          npu.activity = 0;
        }
      }
    }
  }

  private queueSnapshot(): ComputeTask[] {
    return [...this.tasks.values()]
      .filter((task) => task.status === 'queued')
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
  }

  getSnapshot(): ComputeSnapshot {
    this.refreshRacks();
    const racks: RackState[] = this.racks.map((rack) => {
      const healthy = rack.npus.filter((npu) => npu.healthy);
      const allocated = rack.npus.filter((npu) => npu.healthy && npu.taskId);
      const active = allocated.filter((npu) => (npu.activity ?? 0) > 0.05);
      const loadKw =
        DESIGN.rackOverheadKw +
        allocated.reduce((sum, npu) => {
          const activity = clamp(finite(npu.activity, 0), 0, 1);
          return sum + DESIGN.npuPeakKw * (0.28 + 0.72 * activity);
        }, 0);
      const utilization = healthy.length > 0 ? (allocated.length / healthy.length) * 100 : 0;
      const fault = rack.npus.some((npu) => !npu.healthy);
      const status: RackState['status'] = fault
        ? 'fault'
        : allocated.length > 0
          ? fault
            ? 'degraded'
            : 'running'
          : 'idle';
      return {
        id: rack.def.id,
        row: rack.def.row,
        slot: rack.def.slot,
        liquidCooled: rack.def.liquidCooled,
        totalCards: rack.npus.length,
        healthyCards: healthy.length,
        allocatedCards: allocated.length,
        activeCards: active.length,
        utilization: round(utilization, 1),
        loadKw: round(loadKw, 2),
        intakeC: this.rackTemps[rack.def.id] ?? 23,
        exhaustC: (this.rackTemps[rack.def.id] ?? 23) + 7,
        status,
      };
    });

    let allocated = 0;
    let active = 0;
    let healthy = 0;
    let faults = 0;
    for (const npu of this.npus.values()) {
      if (npu.healthy) healthy += 1;
      else faults += 1;
      if (npu.healthy && npu.taskId) allocated += 1;
      if (npu.healthy && npu.taskId && (npu.activity ?? 0) > 0.05) active += 1;
    }

    const tasks = [...this.tasks.values()]
      .filter((task) => task.status !== 'completed')
      .sort((a, b) => {
        const order: Record<string, number> = { migrating: 0, running: 1, queued: 2, completed: 3 };
        return order[a.status] - order[b.status] || b.priority - a.priority;
      })
      .map((task) => this.cloneTask(task));
    const queue = tasks.filter((task) => task.status === 'queued');
    const tokenRate = tasks
      .filter((task) => task.status === 'running')
      .reduce((sum, task) => sum + task.tokensPerSecond, 0);
    const utilization = healthy > 0 ? (allocated / healthy) * 100 : 0;

    return {
      cardsTotal: this.npus.size,
      cardsHealthy: healthy,
      cardsAllocated: allocated,
      cardsActive: active,
      utilization: round(utilization, 1),
      queueDepth: queue.length,
      runningTasks: tasks.filter((task) => task.status === 'running').length,
      migratingTasks: tasks.filter((task) => task.status === 'migrating').length,
      faultCards: faults,
      tokenRate: round(tokenRate, 0),
      tokensTotal: round(this.tokenTotal, 0),
      racks,
      tasks,
      queue,
      migrations: this.migrations
        .filter((migration) => migration.status !== 'completed')
        .map((migration) => ({ ...migration })),
      theoreticalPflops: round((this.npus.size * NPU_TFLOPS) / 1000, 1),
    };
  }

  private cloneTask(task: ComputeTask): ComputeTask {
    return {
      ...task,
      npuIds: [...task.npuIds],
      rackIds: [...task.rackIds],
    };
  }

  private emit(
    severity: OpsEvent['severity'],
    category: OpsEvent['category'],
    title: string,
    detail: string,
    extra: Pick<OpsEvent, 'rackId' | 'taskId'> = {},
  ): OpsEvent {
    const event: OpsEvent = {
      id: `EVT-${String(++this.eventSeq).padStart(5, '0')}`,
      tick: this.tickNo,
      at: this.simNow,
      timestamp: new Date(this.simNow).toISOString(),
      severity,
      category,
      title,
      detail,
      status: severity === 'critical' ? 'active' : severity === 'warning' ? 'recovering' : 'resolved',
      ...extra,
    };
    this.events.push(event);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
    return event;
  }

  drainEvents(): OpsEvent[] {
    return this.events.splice(0, this.events.length);
  }

  getRecentTasks(limit = 6): ComputeTask[] {
    return this.history.slice(0, limit);
  }

  setNow(nowMs: number): void {
    this.simNow = nowMs;
  }
}
