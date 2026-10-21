import { DigitalTwinScene, type SceneDevice, type SceneLayer, type SceneMode } from '../scene/DigitalTwinScene';
import { DigitalTwinEngine } from '../sim/engine';
import type { ComputeTask, EngineSnapshot, OpsEvent, RackState } from '../types';
import { downloadText, eventsToCsv, telemetryToCsv } from '../logging/csv';
import { generateOpsReport } from '../logging/report';
import { buildDeviceInfo } from './deviceInfo';
import { PowerChart } from './charts';

const iconPaths: Record<string, string> = {
  grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  rack: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h8M8 17h5"/><circle cx="17" cy="17" r="1"/>',
  network: '<rect x="8" y="2.5" width="8" height="5" rx="1"/><rect x="2" y="16.5" width="7" height="5" rx="1"/><rect x="15" y="16.5" width="7" height="5" rx="1"/><path d="M12 7.5v4M5.5 16.5v-2.5h13v2.5M12 11.5v2.5"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  bolt: '<path d="m13 2-8 12h6l-1 8 8-12h-6l1-8Z"/>',
  gauge: '<path d="M4.2 18a8.5 8.5 0 1 1 15.6 0"/><path d="M12 14l3.5-5.5"/><circle cx="12" cy="14" r="1.5"/>',
  queue: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2.5"/>',
  shield: '<path d="M12 2.5 4.5 6v5.2c0 4.6 3 8.8 7.5 10.3 4.5-1.5 7.5-5.7 7.5-10.3V6L12 2.5Z"/><path d="m8.8 12 2.1 2.1 4.5-4.5"/>',
  download: '<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 19h16"/>',
  report: '<path d="M6 2.5h8l4 4V21H6z"/><path d="M14 2.5v5h4M9 12h6M9 16h6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  walk: '<circle cx="12" cy="4.5" r="2"/><path d="m9.5 21 1.5-6-3-3 2-5 4 2 3 1M11 15l3 2.5 1 3.5"/>',
  reset: '<path d="M4 10a8 8 0 1 1 2 7.5"/><path d="M4 4v6h6"/>',
  train: '<path d="M4 18V9l8-5 8 5v9"/><path d="M4 18h16M8 18v-5h8v5"/><path d="M9 7h6"/>',
  infer: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="4"/>',
  fault: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17.5v.2"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.4 2.4-2.5-2.5 2.9-2.9Z"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  alert: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17.5v.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  leaf: '<path d="M20 4C11 4 5 8 5 15c0 3 2 5 5 5 7 0 10-7 10-16Z"/><path d="M4 21c2-5 5-8 10-11"/>',
  activity: '<path d="M3 12h4l2.5-6 5 12 2.5-6H21"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  cold: '<path d="M12 2v20M4.2 6.5l15.6 11M19.8 6.5 4.2 17.5"/><path d="m9 4 3 3 3-3M9 20l3-3 3 3M3.4 9.6 6.6 9l-.6-3.2M20.6 14.4 17.4 15l.6 3.2M20.6 9.6 17.4 9l.6-3.2M3.4 14.4 6.6 15l-.6 3.2"/>',
  flame: '<path d="M12 22c4 0 6.5-2.6 6.5-6.2 0-4.7-4.5-7-4-13.8-3.4 1.8-5.2 5-5.2 7.8 0 1.5.5 2.3 1.1 3-1.7-.2-3.1-1.4-3.8-2.8-.7 1.4-1.1 3-1.1 4.3C5.5 18.6 8 22 12 22Z"/>',
  water: '<path d="M12 2.5S5.5 10 5.5 14.2A6.5 6.5 0 0 0 18.5 14.2C18.5 10 12 2.5 12 2.5Z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  speed: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 13 4-4"/><circle cx="12" cy="14" r="2"/>',
  db: '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10v4M7 10v4M11 10v4"/>',
  thermometer: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/>',
};

const icon = (name: string, className = ''): string => {
  const path = iconPaths[name] ?? iconPaths.cpu;
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
};

const fmt = (value: number, digits = 1): string =>
  Number.isFinite(value) ? value.toFixed(digits) : '—';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const heatColor = (temperature: number): string => {
  const ratio = clamp((temperature - 29) / 18, 0, 1);
  const stops = [
    { at: 0, color: [20, 64, 84] },
    { at: 0.32, color: [24, 152, 174] },
    { at: 0.62, color: [222, 183, 77] },
    { at: 0.82, color: [241, 122, 65] },
    { at: 1, color: [238, 74, 96] },
  ];
  let from = stops[0];
  let to = stops[stops.length - 1];
  for (let index = 1; index < stops.length; index += 1) {
    if (ratio <= stops[index].at) {
      from = stops[index - 1];
      to = stops[index];
      break;
    }
  }
  const local = (ratio - from.at) / Math.max(0.001, to.at - from.at);
  const rgb = from.color.map((channel, index) =>
    Math.round(channel + (to.color[index] - channel) * clamp(local, 0, 1)),
  );
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
};

const timeLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const fullDateLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(
    date.getDate(),
  ).padStart(2, '0')} · 周${weekdays[date.getDay()]}`;
};

const statusLabel = (status: string): string => {
  if (status === 'running') return '运行';
  if (status === 'migrating') return '迁移';
  if (status === 'queued') return '排队';
  return '完成';
};

export class Dashboard {
  private readonly engine: DigitalTwinEngine;
  private readonly root: HTMLElement;
  private scene: DigitalTwinScene | null = null;
  private chart: PowerChart | null = null;
  private latest: EngineSnapshot | null = null;
  private timer = 0;
  private currentDevice: SceneDevice | null = null;
  private eventSignature = '';
  private queueSignature = '';
  private readonly heatCells = new Map<string, HTMLElement>();

  constructor(engine: DigitalTwinEngine, root: HTMLElement) {
    this.engine = engine;
    this.root = root;
  }

  init(): void {
    this.root.insertAdjacentHTML('beforeend', this.markup());
    this.bindStaticEvents();
    this.buildHeatmap();
    this.buildScene();
    const chartCanvas = document.getElementById('power-chart');
    if (chartCanvas instanceof HTMLCanvasElement) this.chart = new PowerChart(chartCanvas);
    this.render();
    this.timer = window.setInterval(() => this.render(), 650);
    this.engine.start();
    this.showToast('success', '数字孪生体已同步', '384 张 NPU、24 台机柜与园区微网遥测已接入。');
  }

  private buildScene(): void {
    const host = document.getElementById('scene-host');
    if (!host) return;
    try {
      this.scene = new DigitalTwinScene(host, {
        onSelect: (device, position) => this.openDevice(device, position),
        onClearSelection: () => this.closeDevice(),
        onHover: (device) => {
          const hint = document.getElementById('hover-hint');
          if (hint) hint.textContent = device ? device.name : '拖动旋转 · 滚轮缩放 · 单击设备';
        },
        onModeChange: (mode) => this.syncWalkMode(mode),
      });
    } catch (error) {
      console.error('3D scene initialization failed', error);
      host.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;color:#ff9aac;font-size:12px;">WebGL 初始化失败，请启用硬件加速后刷新页面。</div>`;
    }
  }

  private bindStaticEvents(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-layer]')) {
      button.addEventListener('click', () => {
        const layer = button.dataset.layer as SceneLayer;
        if (!this.scene) return;
        const next = !this.scene.isLayerVisible(layer);
        this.scene.setLayer(layer, next);
        button.classList.toggle('on', next);
        button.setAttribute('aria-pressed', String(next));
      });
    }

    document.getElementById('layers-all')?.addEventListener('click', () => {
      if (!this.scene) return;
      for (const button of document.querySelectorAll<HTMLButtonElement>('[data-layer]')) {
        const layer = button.dataset.layer as SceneLayer;
        this.scene.setLayer(layer, true);
        button.classList.add('on');
        button.setAttribute('aria-pressed', 'true');
      }
    });

    document.getElementById('add-training')?.addEventListener('click', () => {
      this.engine.addTask('training');
      this.render();
      this.showToast('info', '训练任务已提交', '调度器正在计算最优机柜放置。');
    });

    document.getElementById('add-inference')?.addEventListener('click', () => {
      this.engine.addTask('inference');
      this.render();
      this.showToast('info', '推理任务已提交', '优先选择连续空闲 NPU 的低时延机柜。');
    });

    document.getElementById('inject-fault')?.addEventListener('click', () => {
      const injected = this.engine.injectFault();
      this.render();
      if (injected) {
        this.showToast('critical', '单卡故障注入完成', '已触发 UnifiedBus 断点热迁移，请观察机柜红色高亮。');
      } else {
        this.showToast('warning', '没有可注入的在线算力卡', '当前任务已全部完成或处于排队状态。');
      }
    });

    document.getElementById('repair-fault')?.addEventListener('click', () => {
      const repaired = this.engine.repairFaults();
      this.render();
      this.showToast(
        repaired > 0 ? 'success' : 'info',
        repaired > 0 ? '故障卡已恢复' : '无需修复',
        repaired > 0 ? `${repaired} 张 NPU 重新加入调度资源池。` : '当前无故障卡。',
      );
    });

    document.getElementById('pause-toggle')?.addEventListener('click', () => {
      const running = this.engine.toggleRunning();
      this.render();
      this.showToast('info', running ? '仿真继续运行' : '仿真已暂停', running ? '调度时钟恢复推进。' : '所有状态已冻结，可继续检查设备。');
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
      button.addEventListener('click', () => {
        const speed = Number(button.dataset.speed);
        this.engine.setSpeed(speed);
        for (const sibling of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
          sibling.classList.toggle('active', Number(sibling.dataset.speed) === speed);
        }
      });
    }

    document.getElementById('walk-toggle')?.addEventListener('click', () => {
      const mode = this.scene?.toggleWalk();
      if (mode) this.syncWalkMode(mode);
    });

    document.getElementById('reset-camera')?.addEventListener('click', () => {
      this.scene?.resetCamera();
      this.syncWalkMode('orbit');
    });

    document.getElementById('export-csv')?.addEventListener('click', () => {
      const telemetry = this.engine.getTelemetry();
      const stamp = this.fileStamp();
      downloadText(`aidc-runtime-log-${stamp}.csv`, telemetryToCsv(telemetry), 'text/csv;charset=utf-8');
      downloadText(`aidc-fault-events-${stamp}.csv`, eventsToCsv(this.engine.getEvents()), 'text/csv;charset=utf-8');
      this.showToast('success', 'CSV 运行日志已导出', `${telemetry.length} 条逐分钟遥测与 ${this.engine.getEvents().length} 条事件记录。`);
    });

    document.getElementById('export-report')?.addEventListener('click', () => {
      const snapshot = this.engine.getSnapshot();
      const report = generateOpsReport(snapshot, this.engine.getTelemetry(), this.engine.getEvents());
      downloadText(`aidc-ops-report-${this.fileStamp()}.md`, report, 'text/markdown;charset=utf-8');
      this.showToast('success', '运维分析报告已生成', '包含算力、PUE、热环境、事件与自动校验结论。');
    });

    document.getElementById('device-close')?.addEventListener('click', () => {
      this.closeDevice();
    });

    document.getElementById('device-locate')?.addEventListener('click', () => {
      if (!this.currentDevice) return;
      this.scene?.focusDevice(this.currentDevice.id);
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeDevice();
    });
  }

  private buildHeatmap(): void {
    const heatmap = document.getElementById('heatmap');
    if (!heatmap) return;
    const rows = ['A', 'B', 'C', 'D'];
    const html: string[] = [];
    for (const row of rows) {
      html.push(`<div class="heatmap-row-label">${row}</div>`);
      for (let slot = 1; slot <= 6; slot += 1) {
        const id = `${row}${String(slot).padStart(2, '0')}`;
        html.push(`<div class="heatmap-cell" id="heat-${id}" data-rack="${id}">--</div>`);
      }
    }
    heatmap.innerHTML = html.join('');
    for (const cell of heatmap.querySelectorAll<HTMLElement>('.heatmap-cell')) {
      this.heatCells.set(cell.dataset.rack ?? '', cell);
    }
  }

  private render(): void {
    const snapshot = this.engine.getSnapshot();
    this.latest = snapshot;
    this.renderClock(snapshot);
    this.renderCompute(snapshot);
    this.renderEnergy(snapshot);
    this.renderThermal(snapshot);
    this.renderQueue(snapshot);
    this.renderEvents(snapshot.events);
    this.renderValidation(snapshot);
    this.renderRowUtilization(snapshot);
    this.renderAgent(snapshot);
    this.renderAlert(snapshot);
    this.renderScene(snapshot);
    this.chart?.update(this.engine.getTelemetry());
  }

  private renderClock(snapshot: EngineSnapshot): void {
    const date = new Date(snapshot.simTime);
    this.setText('sim-time', `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
    this.setText('sim-date', fullDateLabel(snapshot.timestamp));
    this.setText('sim-tick', `T+${String(snapshot.tick).padStart(4, '0')} MIN`);
    const live = document.getElementById('live-label');
    if (live) {
      live.textContent = snapshot.running ? 'LIVE · 实时同步' : 'PAUSED · 已暂停';
      live.parentElement?.classList.toggle('paused', !snapshot.running);
    }
    const pause = document.getElementById('pause-toggle');
    if (pause) {
      pause.innerHTML = snapshot.running ? icon('pause') : icon('play');
      pause.setAttribute('aria-label', snapshot.running ? '暂停仿真' : '继续仿真');
    }
    const weather = document.getElementById('weather-chip');
    if (weather) {
      const sunny = snapshot.energy.pvKw > 150;
      weather.innerHTML = `${icon(sunny ? 'sun' : 'water')} ${fmt(snapshot.ambientC, 1)}°C · ${sunny ? '光伏高发' : '低辐照'}`;
    }
  }

  private renderCompute(snapshot: EngineSnapshot): void {
    const compute = snapshot.compute;
    this.setText('kpi-flops-value', `${fmt(compute.theoreticalPflops, 1)}`);
    this.setText('kpi-cards-value', `${compute.cardsActive}`);
    this.setText('kpi-cards-total', `/ ${compute.cardsTotal}`);
    const daily = (compute.tokenRate * 86_400) / 1_000_000_000;
    this.setText('kpi-tokens-value', daily >= 1 ? `${fmt(daily, 2)}` : `${fmt(daily * 1000, 1)}`);
    this.setText('kpi-tokens-unit', daily >= 1 ? 'B / day' : 'M / day');
    this.setText('kpi-util-value', `${fmt(compute.utilization, 1)}`);
    this.setText('kpi-flops-sub', `BF16 · ${compute.cardsTotal} NPU · ${compute.racks.length} RACKS`);
    const cardsSub = document.getElementById('kpi-cards-sub');
    if (cardsSub) {
      cardsSub.innerHTML = `<i></i>健康 ${compute.cardsHealthy} · 故障 ${compute.faultCards}`;
    }
    this.setText('kpi-tokens-sub', `${(compute.tokenRate / 1000).toFixed(1)}K Token/s · 累计 ${(compute.tokensTotal / 1e9).toFixed(2)}B`);
    const utilSub = document.getElementById('kpi-util-sub');
    if (utilSub) {
      utilSub.innerHTML = `<i></i>队列 ${compute.queueDepth} · 迁移 ${compute.migratingTasks}`;
    }
    const flopsBar = document.getElementById('kpi-flops-bar');
    if (flopsBar) flopsBar.style.width = '100%';
    const cardsBar = document.getElementById('kpi-cards-bar');
    if (cardsBar) cardsBar.style.width = `${clamp((compute.cardsActive / Math.max(1, compute.cardsTotal)) * 100, 0, 100)}%`;
    const tokensBar = document.getElementById('kpi-tokens-bar');
    if (tokensBar) tokensBar.style.width = `${clamp(compute.utilization, 0, 100)}%`;
    const utilBar = document.getElementById('kpi-util-bar');
    if (utilBar) utilBar.style.width = `${clamp(compute.utilization, 0, 100)}%`;
    this.setText('scene-util-chip', `利用率 ${fmt(compute.utilization, 1)}%`);
    this.setText('scene-cards-chip', `${compute.cardsActive}/${compute.cardsHealthy} NPU 在线`);
  }

  private renderEnergy(snapshot: EngineSnapshot): void {
    const energy = snapshot.energy;
    const warning = energy.pueStatus === 'warning';
    const pueValue = document.getElementById('pue-value');
    if (pueValue) pueValue.textContent = energy.pue.toFixed(3);
    const ring = document.getElementById('pue-ring');
    if (ring) {
      const pct = clamp(((energy.pue - 1) / 0.5) * 100, 2, 100);
      ring.style.setProperty('--ring-pct', `${pct}%`);
      ring.style.setProperty('--ring-color', warning ? '#ffc857' : '#37dfff');
    }
    const status = document.getElementById('pue-status');
    if (status) {
      status.className = `pue-status${warning ? ' warning' : ''}`;
      status.innerHTML = `<i></i>${warning ? '超基准线' : energy.pueStatus === 'optimal' ? '优秀' : '正常'}`;
    }
    const total = document.getElementById('pue-total');
    if (total) total.innerHTML = `${fmt(energy.totalKw, 1)}<small>kW</small>`;
    const deviation = document.getElementById('pue-compare');
    if (deviation) {
      deviation.className = `pue-compare${warning ? ' warning' : ''}`;
      deviation.innerHTML = `较基准 <b>${energy.pueDeviationPct >= 0 ? '+' : ''}${fmt(
        energy.pueDeviationPct,
        1,
      )}%</b> · COP ${fmt(energy.cop, 2)}`;
    }
    const benchmark = document.getElementById('benchmark-actual');
    if (benchmark) benchmark.style.left = `${clamp(((energy.pue - 1) / 0.5) * 100, 2, 98)}%`;
    this.setText('pue-benchmark-label', `${energy.benchmarkPue.toFixed(2)} 基准`);

    const parts = [
      { key: 'it', value: energy.components.it, bar: 'bar-it' },
      { key: 'cooling', value: energy.components.cooling, bar: 'bar-cooling' },
      { key: 'distribution', value: energy.components.distribution, bar: 'bar-distribution' },
      { key: 'other', value: energy.components.other, bar: 'bar-other' },
    ];
    for (const part of parts) {
      this.setText(`energy-${part.key}-value`, `${fmt(part.value, 1)} kW`);
      this.setText(`energy-${part.key}-pct`, `${fmt((part.value / Math.max(1, energy.totalKw)) * 100, 1)}%`);
      const bar = document.getElementById(part.bar);
      if (bar) bar.style.width = `${clamp((part.value / Math.max(1, energy.totalKw)) * 100, 0, 100)}%`;
    }

    this.setText('renewable-chip', `${fmt(energy.renewableSharePct, 0)}%`);
    this.setText('pv-chip', `${fmt(energy.pvKw, 0)} kW`);
    this.setText('battery-soc', `${fmt(energy.batterySocPct, 0)}%`);

    const sourceTotal = Math.max(
      1,
      energy.sources.pv + energy.sources.grid + energy.sources.battery + energy.sources.diesel,
    );
    const sourceParts = [
      { key: 'pv', value: energy.sources.pv, color: '#b8ff5a' },
      { key: 'grid', value: energy.sources.grid, color: '#37dfff' },
      { key: 'battery', value: energy.sources.battery, color: '#9b8cff' },
      { key: 'diesel', value: energy.sources.diesel, color: '#ffc857' },
    ];
    for (const part of sourceParts) {
      const bar = document.getElementById(`source-${part.key}-bar`);
      if (bar) {
        bar.style.width = `${(part.value / sourceTotal) * 100}%`;
        bar.style.background = part.color;
      }
      this.setText(`source-${part.key}`, part.key === 'battery' && energy.batteryKw < 0 ? `充电 ${fmt(Math.abs(energy.batteryKw), 0)} kW` : `${fmt(part.value, 0)} kW`);
    }
    const powerBalance = document.getElementById('power-balance');
    if (powerBalance) {
      powerBalance.innerHTML = `功率平衡 <b>${energy.powerBalancePct.toFixed(4)}%</b>`;
    }
  }

  private renderThermal(snapshot: EngineSnapshot): void {
    const thermal = snapshot.thermal;
    this.setText('thermal-cold', `${fmt(thermal.coldAisleC, 1)}°C`);
    this.setText('thermal-hot', `${fmt(thermal.hotAisleC, 1)}°C`);
    this.setText('thermal-liquid', `${fmt(thermal.liquidSupplyC, 1)}→${fmt(thermal.liquidReturnC, 1)}°C`);
    this.setText('thermal-ab', `AB ${fmt(thermal.coldAisleAB, 1)}°C`);
    this.setText('thermal-cd', `CD ${fmt(thermal.coldAisleCD, 1)}°C`);
    const rackMap = new Map<string, RackState>(snapshot.compute.racks.map((rack) => [rack.id, rack]));
    for (const [id, cell] of this.heatCells) {
      const rack = rackMap.get(id);
      const temp = thermal.rackTempsC[id] ?? 30;
      cell.textContent = `${temp.toFixed(0)}°`;
      cell.style.background = `linear-gradient(135deg, ${heatColor(temp)}e6, ${heatColor(temp)}99)`;
      cell.classList.toggle('fault', rack?.status === 'fault');
      cell.title = rack
        ? `${id} · 排风 ${temp.toFixed(1)}°C · 负载 ${fmt(rack.loadKw, 1)} kW · 利用率 ${fmt(rack.utilization, 0)}%`
        : id;
    }
    this.setText('thermal-range', `${Math.min(...Object.values(thermal.rackTempsC)).toFixed(1)} – ${Math.max(...Object.values(thermal.rackTempsC)).toFixed(1)}°C`);
  }

  private renderQueue(snapshot: EngineSnapshot): void {
    const tasks = [...snapshot.compute.tasks].sort((a, b) => {
      const order: Record<string, number> = { migrating: 0, running: 1, queued: 2, completed: 3 };
      return order[a.status] - order[b.status] || b.priority - a.priority;
    });
    const queueCount = snapshot.compute.queueDepth;
    this.setText('queue-count', `${tasks.length}`);
    this.setText('queue-waiting', `${queueCount} 等待`);
    const signature = tasks
      .map((task) => `${task.id}:${task.status}:${Math.round(task.progress * 1000)}`)
      .join('|');
    if (signature === this.queueSignature) return;
    this.queueSignature = signature;
    const list = document.getElementById('queue-list');
    if (!list) return;
    if (tasks.length === 0) {
      list.innerHTML = `<div class="queue-empty">暂无运行任务 · 算力池待命</div>`;
      return;
    }
    list.innerHTML = tasks
      .slice(0, 6)
      .map((task) => this.taskRow(task))
      .join('');
  }

  private taskRow(task: ComputeTask): string {
    const migrating = task.status === 'migrating';
    const percent = migrating ? Math.max(0, task.progress * 100) : task.progress * 100;
    const location = task.status === 'queued' ? '等待资源' : task.rackIds.slice(0, 2).join(' / ');
    return `<div class="task-row">
      <div class="task-top">
        <i class="task-dot" style="color:${task.accent};background:${task.accent}"></i>
        <span class="task-name" title="${task.name}">${task.name}</span>
        <span class="task-percent">${task.status === 'queued' ? '—' : `${percent.toFixed(0)}%`}</span>
      </div>
      <div class="task-sub">
        <span class="mini-tag" style="color:${task.accent};border-color:${task.accent}33">${task.type === 'training' ? 'TRAIN' : 'INFER'}</span>
        <span>${task.cards}卡</span><span>·</span><span>${location}</span>
        <span style="margin-left:auto;color:${migrating ? '#ffc857' : 'inherit'}">${statusLabel(task.status)}</span>
      </div>
      <div class="progress-track"><div class="progress-fill${migrating ? ' migrating' : ''}" style="width:${clamp(percent, 0, 100)}%;background:${task.accent};color:${task.accent}"></div></div>
    </div>`;
  }

  private renderEvents(events: OpsEvent[]): void {
    const signature = events.map((event) => `${event.id}:${event.status}`).join('|');
    if (signature === this.eventSignature) return;
    this.eventSignature = signature;
    const list = document.getElementById('event-list');
    if (!list) return;
    const visible = events.slice(0, 7);
    if (visible.length === 0) {
      list.innerHTML = `<div class="queue-empty">暂无事件</div>`;
      return;
    }
    list.innerHTML = visible
      .map((event) => {
        const iconName =
          event.category === 'fault'
            ? 'fault'
            : event.category === 'migration'
              ? 'queue'
              : event.category === 'validation'
                ? 'shield'
                : event.category === 'energy'
                  ? 'bolt'
                  : event.category === 'thermal'
                    ? 'thermometer'
                    : 'activity';
        const status = event.status === 'active' ? '未恢复' : event.status === 'recovering' ? '处置中' : '已闭环';
        return `<div class="event-row ${event.severity}">
          <div class="event-marker">${icon(iconName)}</div>
          <div class="event-main">
            <div class="event-title" title="${event.detail.replaceAll('"', '&quot;')}">
              <span>${event.title}</span>
              <span class="event-status">${status}</span>
            </div>
            <div class="event-time">${timeLabel(event.timestamp)} · ${event.tick.toString().padStart(4, '0')} min</div>
          </div>
        </div>`;
      })
      .join('');
  }

  private renderValidation(snapshot: EngineSnapshot): void {
    const validation = snapshot.validation;
    const status = document.getElementById('validation-status');
    if (status) {
      status.textContent =
        validation.status === 'pass'
          ? '标准算例全部通过'
          : validation.status === 'corrected'
            ? '模型已自动修正'
            : '校验未通过';
    }
    const sub = document.getElementById('validation-sub');
    if (sub) {
      sub.textContent = `${validation.cases.length} 个标准工况 · ${validation.status === 'pass' ? '无偏差' : `${validation.correctionCount} 次修正`}`;
    }
    this.setText('val-pue', `${validation.maxPueDeviationPct.toFixed(2)}%`);
    this.setText('val-balance', `${validation.maxBalanceDeviationPct.toFixed(4)}%`);
    this.setText('val-guard', snapshot.replayGuard.recoveries.toString());
    const valIcon = document.getElementById('validation-icon');
    if (valIcon) {
      valIcon.style.color = validation.passed ? 'var(--green)' : 'var(--red)';
      valIcon.style.background = validation.passed ? 'rgba(84,230,177,.08)' : 'rgba(255,77,109,.08)';
    }
    this.setText('scene-validation-chip', validation.passed ? '模型自校验通过' : '模型校验异常');
  }

  private renderRowUtilization(snapshot: EngineSnapshot): void {
    for (const row of ['A', 'B', 'C', 'D']) {
      const racks = snapshot.compute.racks.filter((rack) => rack.row === row);
      const utilization =
        racks.reduce((sum, rack) => sum + rack.utilization, 0) / Math.max(1, racks.length);
      const bar = document.getElementById(`row-util-${row}`);
      if (bar) {
        bar.style.width = `${clamp(utilization, 0, 100)}%`;
        bar.style.background =
          utilization > 92
            ? 'linear-gradient(90deg,#ff9f43,#ff4d6d)'
            : utilization > 78
              ? 'linear-gradient(90deg,#19a6c8,#ffc857)'
              : 'linear-gradient(90deg,#19a6c8,#37dfff)';
      }
      this.setText(`row-val-${row}`, `${utilization.toFixed(0)}%`);
    }
  }

  private renderAgent(snapshot: EngineSnapshot): void {
    const compute = snapshot.compute;
    const energy = snapshot.energy;
    const thermal = snapshot.thermal;
    const recommendation =
      compute.faultCards > 0
        ? `检测到 ${compute.faultCards} 张故障卡：优先观察热迁移进度，迁移完成后安排隔离更换，并保留至少 48 卡迁移余量。`
        : energy.pueStatus === 'warning'
          ? 'PUE 已越过基准线：建议将冷通道设定点上调 0.5°C、降低 CRAH 风机静压，并暂停低优先级训练任务。'
          : compute.queueDepth > 0
            ? `有 ${compute.queueDepth} 个任务排队：建议释放长时间低利用率推理副本，或将批处理任务平移至夜间谷电时段。`
            : `集群水位健康，热通道 ${thermal.hotAisleC.toFixed(1)}°C。建议维持当前策略，并利用光伏富余为储能补能至 80% SOC。`;
    this.setText('agent-recommendation', recommendation);
    const efficiency = clamp(Math.round(((1.38 - energy.pue) / 0.18) * 100), 10, 100);
    this.setText('agent-efficiency', `${efficiency}`);
    const thermalMargin = 48 - Math.max(thermal.hotAisleC, thermal.liquidReturnC);
    this.setText('agent-thermal', thermalMargin > 7 ? '良好' : thermalMargin > 3 ? '关注' : '紧张');
    const spare = Math.max(0, compute.cardsHealthy - compute.cardsAllocated);
    this.setText('agent-capacity', `${spare} 卡`);
    const efficiencyBar = document.querySelector<HTMLElement>('#agent-efficiency + i');
    if (efficiencyBar) efficiencyBar.style.setProperty('--score', `${efficiency}%`);
    const thermalBar = document.querySelector<HTMLElement>('#agent-thermal + i');
    if (thermalBar) thermalBar.style.setProperty('--score', `${clamp((thermalMargin / 14) * 100, 8, 100)}%`);
    const capBar = document.querySelector<HTMLElement>('#agent-capacity + i');
    if (capBar) capBar.style.setProperty('--score', `${clamp((spare / Math.max(1, compute.cardsTotal)) * 100, 3, 100)}%`);
    this.setText('agent-score', `策略置信度 ${snapshot.validation.passed ? '96.4' : '72.0'}%`);
  }

  private renderAlert(snapshot: EngineSnapshot): void {
    const strip = document.getElementById('alert-strip');
    if (!strip) return;
    const fault = snapshot.compute.faultCards > 0;
    const pueWarning = snapshot.energy.pueStatus === 'warning';
    if (fault) {
      strip.className = 'alert-strip show critical';
      strip.innerHTML = `${icon('fault')}<span><b>单卡故障隔离中</b> · ${snapshot.compute.faultCards} 张 NPU 离线，热迁移任务 ${snapshot.compute.migratingTasks} 个，机柜红色高亮已联动。</span>`;
    } else if (pueWarning) {
      strip.className = 'alert-strip show';
      strip.innerHTML = `${icon('alert')}<span><b>PUE 超过 1.25 基准线</b> · 当前 ${snapshot.energy.pue.toFixed(3)}，建议优化低负载制冷策略。</span>`;
    } else {
      strip.className = 'alert-strip';
    }
  }

  private renderScene(snapshot: EngineSnapshot): void {
    this.scene?.applySnapshot(snapshot);
    this.setText('chart-current', `${fmt(snapshot.energy.totalKw, 1)} kW`);
    this.setText('event-count', `${this.engine.getEvents().length}`);
    this.setText('scene-tick', `T+${snapshot.tick.toString().padStart(4, '0')} MIN`);
  }

  private openDevice(device: SceneDevice, position: { x: number; y: number }): void {
    if (!this.latest) return;
    const info = buildDeviceInfo(device, this.latest);
    const popover = document.getElementById('device-popover');
    if (!popover) return;
    const iconName =
      device.kind === 'pv'
        ? 'sun'
        : device.kind === 'bess'
          ? 'battery'
          : device.kind === 'diesel'
            ? 'bolt'
            : device.kind === 'cdu'
              ? 'water'
              : device.kind === 'crah'
                ? 'cold'
                : device.kind === 'spine' || device.kind === 'leaf'
                  ? 'network'
                  : device.kind === 'switchgear' || device.kind === 'transformer' || device.kind === 'busway'
                    ? 'bolt'
                    : device.kind === 'rack'
                      ? 'rack'
                      : 'cpu';
    const toneClass = info.tone === 'cyan' ? '' : info.tone;
    popover.innerHTML = `
      <div class="popover-top">
        <div class="popover-icon ${toneClass}">${icon(iconName)}</div>
        <div class="popover-title">
          <div class="popover-kicker">${device.id} · ${device.kind.toUpperCase()}</div>
          <h3>${info.name}</h3>
          <p>${info.subtitle}</p>
        </div>
        <button class="popover-close" id="device-close" aria-label="关闭">${icon('close')}</button>
      </div>
      <div class="popover-status" style="color:${info.tone === 'red' ? '#ff6c86' : info.tone === 'amber' ? '#ffc857' : info.tone === 'green' ? '#54e6b1' : '#6fe9ff'}"><i></i>${info.status}</div>
      <div class="popover-metrics">
        ${info.metrics
          .map(
            (metric) =>
              `<div class="popover-metric"><span>${metric.label}</span><b>${metric.value}</b></div>`,
          )
          .join('')}
      </div>
      <p class="popover-detail">${info.detail}</p>
      <div class="popover-footer">
        <span>TELEMETRY · 60s / TICK</span>
        <button class="locate-button" id="device-locate">${icon('target')}定位设备</button>
      </div>`;
    popover.classList.remove('hidden');
    const host = document.getElementById('scene-host');
    const hostWidth = host?.clientWidth ?? 800;
    const hostHeight = host?.clientHeight ?? 500;
    const width = 276;
    const height = popover.offsetHeight || 290;
    const left = clamp(position.x + 18, 10, hostWidth - width - 10);
    const top = clamp(position.y - height * 0.42, 64, hostHeight - height - 14);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    this.currentDevice = device;
    popover.querySelector('#device-close')?.addEventListener('click', () => this.closeDevice());
    popover.querySelector('#device-locate')?.addEventListener('click', () => {
      if (this.currentDevice) this.scene?.focusDevice(this.currentDevice.id);
    });
  }

  private closeDevice(): void {
    document.getElementById('device-popover')?.classList.add('hidden');
    this.currentDevice = null;
    this.scene?.clearSelection();
  }

  private syncWalkMode(mode: SceneMode): void {
    const button = document.getElementById('walk-toggle');
    if (!button) return;
    button.classList.toggle('active', mode === 'walk');
    const label = button.querySelector('span');
    if (label) label.textContent = mode === 'walk' ? '退出漫游' : '第一人称';
    const hint = document.getElementById('hover-hint');
    if (hint) hint.textContent = mode === 'walk' ? 'WASD 移动 · 鼠标拖拽视角 · Esc 退出' : '拖动旋转 · 滚轮缩放 · 单击设备';
    if (mode === 'walk') {
      this.showToast('info', '第一人称漫游已开启', 'WASD 移动，鼠标拖拽转向，Esc 退出。');
    }
  }

  private showToast(
    tone: 'success' | 'warning' | 'critical' | 'info',
    title: string,
    detail: string,
  ): void {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${tone}`;
    toast.innerHTML = `${icon(tone === 'critical' ? 'fault' : tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'activity')}<div><b>${title}</b>${detail}</div>`;
    container.appendChild(toast);
    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
      window.setTimeout(() => toast.remove(), 260);
    }, 3800);
  }

  private fileStamp(): string {
    const snapshot = this.latest ?? this.engine.getSnapshot();
    const date = new Date(snapshot.simTime);
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
      date.getDate(),
    ).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}${String(
      date.getMinutes(),
    ).padStart(2, '0')}`;
  }

  private setText(id: string, value: string): void {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  private markup(): string {
    return `
<div class="shell">
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">${icon('grid')}</div>
      <div class="brand-text">
        <strong>NEXUS <span>AIDC</span></strong>
        <small>DIGITAL TWIN · OPERATIONS AGENT</small>
      </div>
    </div>
    <div class="topbar-sep"></div>
    <div class="site-meta">
      <span>华东智算中心 · AIDC-CAMPUS-01</span>
      <small>31.23°N 121.78°E · 临港算力园区</small>
    </div>
    <div class="topbar-center">
      <div class="live-pill"><i class="live-dot"></i><span id="live-label">LIVE · 实时同步</span></div>
      <div class="clock-block">
        <div class="clock-time" id="sim-time">10:00</div>
        <div class="clock-date" id="sim-date">2026.10.21 · 周三</div>
      </div>
      <div class="speed-control" aria-label="仿真速度">
        <button data-speed="1" class="active">1×</button>
        <button data-speed="2">2×</button>
        <button data-speed="4">4×</button>
      </div>
      <button class="icon-button" id="pause-toggle" aria-label="暂停仿真">${icon('pause')}</button>
    </div>
    <div class="top-actions">
      <button class="export-button" id="export-csv">${icon('download')}CSV 日志</button>
      <button class="export-button primary" id="export-report">${icon('report')}运维报告</button>
    </div>
  </header>

  <div class="workspace">
    <aside class="rail left">
      <div class="rail-scroll">
        <section class="card">
          <div class="card-header">
            <div class="card-title">${icon('grid')}<h2>场景图层</h2><small>LAYERS</small></div>
            <button class="card-meta" id="layers-all" style="color:var(--cyan);font-family:var(--font);font-size:8px;">全部显示</button>
          </div>
          <div class="layer-list">
            <button class="layer-row on" data-layer="campus" aria-pressed="true">
              <span class="layer-icon">${icon('sun')}</span>
              <span class="layer-copy"><b>园区层</b><span>光伏屋顶 · 储能 · 柴发 · 主进线</span></span>
              <i class="switch"></i>
            </button>
            <button class="layer-row on" data-layer="hall" aria-pressed="true">
              <span class="layer-icon amber">${icon('rack')}</span>
              <span class="layer-copy"><b>机房层</b><span>24 机柜 · 冷热通道 · CRAH · CDU</span></span>
              <i class="switch"></i>
            </button>
            <button class="layer-row on" data-layer="network" aria-pressed="true">
              <span class="layer-icon violet">${icon('network')}</span>
              <span class="layer-copy"><b>网络层</b><span>4 Spine · 8 Leaf · 光互联 · UnifiedBus</span></span>
              <i class="switch"></i>
            </button>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div class="card-title">${icon('activity')}<h2>运维指令</h2><small>AGENT</small></div>
            <span class="card-meta">AUTO</span>
          </div>
          <div class="control-grid">
            <button class="control-button" id="add-training">${icon('train')}注入训练任务</button>
            <button class="control-button" id="add-inference">${icon('infer')}注入推理任务</button>
            <button class="control-button danger" id="inject-fault">${icon('fault')}单卡故障</button>
            <button class="control-button good" id="repair-fault">${icon('wrench')}隔离修复</button>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div class="card-title">${icon('queue')}<h2>实时调度队列</h2></div>
            <span class="queue-summary"><b id="queue-count">0</b> 任务 · <span id="queue-waiting">0 等待</span></span>
          </div>
          <div class="queue-list" id="queue-list">
            <div class="queue-empty">正在接入调度器…</div>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div class="card-title">${icon('shield')}<h2>模型自动校验</h2><small>5% THRESHOLD</small></div>
            <span class="card-meta">STD × 3</span>
          </div>
          <div class="validation">
            <div class="validation-head">
              <div class="validation-icon" id="validation-icon">${icon('check')}</div>
              <div>
                <b id="validation-status">标准算例全部通过</b>
                <span id="validation-sub">3 个标准工况 · 无偏差</span>
              </div>
            </div>
            <div class="validation-grid">
              <div class="validation-cell"><span>PUE 最大偏差</span><b><span id="val-pue">0.00%</span><em>≤5%</em></b></div>
              <div class="validation-cell"><span>功率平衡偏差</span><b><span id="val-balance">0.0000%</span><em>≤5%</em></b></div>
              <div class="validation-cell"><span>数值回滚保护</span><b><span id="val-guard">0</span><em>次</em></b></div>
              <div class="validation-cell"><span>标定状态</span><b style="color:var(--green);font-size:9px">自适应</b></div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div class="card-title">${icon('activity')}<h2>分排算力水位</h2><small>ROW LOAD</small></div>
            <span class="card-meta">4 ROWS</span>
          </div>
          <div class="row-util-list">
            <div class="row-util"><span>A</span><div class="row-util-track"><i id="row-util-A" style="width:70%"></i></div><b id="row-val-A">70%</b></div>
            <div class="row-util"><span>B</span><div class="row-util-track"><i id="row-util-B" style="width:70%"></i></div><b id="row-val-B">70%</b></div>
            <div class="row-util"><span>C</span><div class="row-util-track"><i id="row-util-C" style="width:70%"></i></div><b id="row-val-C">70%</b></div>
            <div class="row-util"><span>D</span><div class="row-util-track"><i id="row-util-D" style="width:70%"></i></div><b id="row-val-D">70%</b></div>
          </div>
        </section>
      </div>
      <div class="rail-footer"><span><i></i>SIMULATION ACTIVE</span><span id="sim-tick">T+0000 MIN</span></div>
    </aside>

    <main class="center-stack">
      <section class="viewport-card">
        <div class="scene-host" id="scene-host"></div>
        <div class="scene-vignette"></div>
        <div class="viewport-head">
          <div class="scene-kicker">AIDC DIGITAL TWIN / LIVE</div>
          <h1>智算中心 · 数字孪生体</h1>
          <p>NEXUS 集群 · 384 NPU · 液冷 + 风冷混合制冷</p>
          <div class="scene-chips">
            <span class="scene-chip"><i></i><span id="scene-validation-chip">模型自校验通过</span></span>
            <span class="scene-chip" id="scene-cards-chip">272/384 NPU 在线</span>
            <span class="scene-chip" id="scene-util-chip">利用率 70.8%</span>
            <span class="scene-chip" id="weather-chip">${icon('sun')} 27°C · 光伏高发</span>
          </div>
        </div>
        <div class="viewport-actions">
          <button class="scene-action" id="walk-toggle">${icon('walk')}<span>第一人称</span></button>
          <button class="scene-action" id="reset-camera">${icon('reset')}<span>复位</span></button>
        </div>
        <div class="alert-strip" id="alert-strip"></div>
        <div class="fp-hud">
          <div class="crosshair"></div>
          <div class="walk-help"><span class="keycap">W</span><span class="keycap">A</span><span class="keycap">S</span><span class="keycap">D</span> 移动 <span class="keycap">SHIFT</span> 加速 <span class="keycap">ESC</span> 退出</div>
        </div>
        <div class="device-popover hidden" id="device-popover"></div>
        <div class="scene-footer">
          <div class="scene-legend">
            <span style="color:#37dfff"><i></i>冷通道</span>
            <span style="color:#ffb05a"><i></i>热通道 / UnifiedBus</span>
            <span style="color:#5e8bff"><i></i>液冷回路</span>
            <span style="color:#ff4d6d"><i></i>故障高亮</span>
          </div>
          <div class="scene-hint" id="hover-hint">拖动旋转 · 滚轮缩放 · 单击设备</div>
        </div>
      </section>

      <div class="bottom-stack">
        <section class="card bottom-panel">
          <div class="card-header">
            <div class="card-title">${icon('activity')}<h2>功率时序</h2><small>POWER TREND</small></div>
            <div class="chart-legend">
              <span><i style="background:#37dfff"></i>总功率</span>
              <span><i style="background:#b8ff5a"></i>IT</span>
              <span><i style="background:#ffc857"></i>制冷</span>
            </div>
            <div class="chart-current" id="chart-current">494.9 kW</div>
          </div>
          <div class="power-chart-wrap"><canvas id="power-chart"></canvas></div>
        </section>

        <section class="card bottom-panel">
          <div class="card-header">
            <div class="card-title">${icon('alert')}<h2>故障与事件日志</h2><small>EVENT STREAM</small></div>
            <span class="card-meta"><b id="event-count" style="color:var(--cyan);font-weight:500">0</b> EVENTS</span>
          </div>
          <div class="event-list" id="event-list">
            <div class="queue-empty">事件流同步中…</div>
          </div>
        </section>
      </div>
    </main>

    <aside class="rail right">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label"><span>总算力</span>${icon('cpu')}</div>
          <div class="kpi-value"><span id="kpi-flops-value">393.2</span><small>PFLOPS</small></div>
          <div class="kpi-sub" id="kpi-flops-sub"><i></i>BF16 · 384 NPU · 24 RACKS</div>
          <div class="kpi-bar"><i id="kpi-flops-bar" style="width:100%"></i></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label"><span>在跑卡数</span>${icon('rack')}</div>
          <div class="kpi-value"><span id="kpi-cards-value">272</span><small id="kpi-cards-total">/ 384</small></div>
          <div class="kpi-sub" id="kpi-cards-sub"><i></i>健康 384 · 故障 0</div>
          <div class="kpi-bar"><i id="kpi-cards-bar" style="width:70%"></i></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label"><span>Token 日产量</span>${icon('bolt')}</div>
          <div class="kpi-value"><span id="kpi-tokens-value">6.02</span><small id="kpi-tokens-unit">B / day</small></div>
          <div class="kpi-sub" id="kpi-tokens-sub">69.4K Token/s · 累计 0.32B</div>
          <div class="kpi-bar lime"><i id="kpi-tokens-bar" style="width:70%"></i></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label"><span>集群利用率</span>${icon('gauge')}</div>
          <div class="kpi-value"><span id="kpi-util-value">70.8</span><small>%</small></div>
          <div class="kpi-sub" id="kpi-util-sub"><i></i>队列 0 · 迁移 0</div>
          <div class="kpi-bar"><i id="kpi-util-bar" style="width:70%"></i></div>
        </div>
      </div>

      <div class="right-scroll">
        <section class="card">
          <div class="card-header">
            <div class="card-title">${icon('bolt')}<h2>能源效率</h2><small>PUE / POWER</small></div>
            <span class="card-meta">BENCHMARK 1.25</span>
          </div>
          <div class="pue-body">
            <div class="pue-top">
              <div class="pue-ring" id="pue-ring" style="--ring-pct:48%">
                <div class="pue-ring-inner"><b id="pue-value">1.242</b><span>REAL-TIME PUE</span></div>
              </div>
              <div class="pue-side">
                <div class="pue-side-head"><span>总设施功率</span><span class="pue-status" id="pue-status"><i></i>正常</span></div>
                <div class="pue-total" id="pue-total">494.9<small>kW</small></div>
                <div class="pue-compare" id="pue-compare">较基准 <b>-0.6%</b> · COP 6.06</div>
                <div class="benchmark-bar">
                  <i style="left:50%"></i><em id="pue-benchmark-label" style="left:50%">1.25 基准</em>
                  <span class="actual" id="benchmark-actual" style="left:48%"></span>
                </div>
              </div>
            </div>
            <div class="energy-breakdown">
              <div class="breakdown-row"><span>IT 负载</span><div class="breakdown-track"><i id="bar-it" style="width:80%;--bar-color:#37dfff"></i></div><b><span id="energy-it-value">398.5 kW</span><em style="font-style:normal;color:var(--dim);font-size:6px;margin-left:3px" id="energy-it-pct">80.5%</em></b></div>
              <div class="breakdown-row"><span>制冷负载</span><div class="breakdown-track"><i id="bar-cooling" style="width:14%;--bar-color:#ffc857"></i></div><b><span id="energy-cooling-value">69.1 kW</span><em style="font-style:normal;color:var(--dim);font-size:6px;margin-left:3px" id="energy-cooling-pct">14.0%</em></b></div>
              <div class="breakdown-row"><span>供配电损耗</span><div class="breakdown-track"><i id="bar-distribution" style="width:3.5%;--bar-color:#9b8cff"></i></div><b><span id="energy-distribution-value">17.3 kW</span><em style="font-style:normal;color:var(--dim);font-size:6px;margin-left:3px" id="energy-distribution-pct">3.5%</em></b></div>
              <div class="breakdown-row"><span>辅助用电</span><div class="breakdown-track"><i id="bar-other" style="width:2%;--bar-color:#6f8fa2"></i></div><b><span id="energy-other-value">10.0 kW</span><em style="font-style:normal;color:var(--dim);font-size:6px;margin-left:3px" id="energy-other-pct">2.0%</em></b></div>
            </div>
            <div class="energy-foot">
              <div class="energy-chip">${icon('leaf')}光伏消纳 <b id="renewable-chip">100%</b> · <b id="pv-chip">600 kW</b></div>
              <div class="energy-chip">${icon('battery')}储能 SOC <b id="battery-soc">75%</b></div>
            </div>
            <div class="source-bar">
              <i id="source-pv-bar" style="width:100%;background:#b8ff5a"></i>
              <i id="source-grid-bar" style="width:0%;background:#37dfff"></i>
              <i id="source-battery-bar" style="width:0%;background:#9b8cff"></i>
              <i id="source-diesel-bar" style="width:0%;background:#ffc857"></i>
            </div>
            <div class="source-legend">
              <span><i style="background:#b8ff5a"></i>光伏 <b id="source-pv" style="color:var(--text-2);font-weight:400">0 kW</b></span>
              <span><i style="background:#37dfff"></i>电网 <b id="source-grid" style="color:var(--text-2);font-weight:400">0 kW</b></span>
              <span><i style="background:#9b8cff"></i>储能 <b id="source-battery" style="color:var(--text-2);font-weight:400">0 kW</b></span>
              <span><i style="background:#ffc857"></i>柴发 <b id="source-diesel" style="color:var(--text-2);font-weight:400">0 kW</b></span>
              <span id="power-balance" style="margin-left:auto;color:var(--dim)">功率平衡 <b>0.0000%</b></span>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <div class="card-title">${icon('cold')}<h2>温度场</h2><small>THERMAL GRID</small></div>
            <span class="card-meta">4 ROWS × 6 RACKS</span>
          </div>
          <div class="thermal-body">
            <div class="thermal-temps">
              <div class="thermal-temp"><span>冷通道</span><b id="thermal-cold">22.7°C</b></div>
              <div class="thermal-temp hot"><span>热通道</span><b id="thermal-hot">33.6°C</b></div>
              <div class="thermal-temp liquid"><span>液冷供→回</span><b id="thermal-liquid">31.8→41.8°C</b></div>
            </div>
            <div class="heatmap" id="heatmap"></div>
            <div class="heatmap-axis">
              <span class="heatmap-scale">排风温度 <span class="heatmap-gradient"></span> 29–48°C</span>
              <span class="heatmap-scale" id="thermal-range">32.9 – 41.5°C</span>
            </div>
            <div class="thermal-foot">
              <span>冷通道 <b id="thermal-ab">AB 22.8°C</b> · <b id="thermal-cd">CD 22.5°C</b></span>
              <span>CDU 变频联动 · 边界钳制</span>
            </div>
          </div>
        </section>

        <section class="card agent-card">
          <div class="card-header">
            <div class="card-title">${icon('shield')}<h2>运维 Agent</h2><small>INSIGHT</small></div>
            <span class="agent-live"><i></i>持续评估</span>
          </div>
          <div class="agent-body">
            <div class="agent-verdict">
              <span>当前策略建议</span>
              <p id="agent-recommendation">保持冷通道设定点，利用光伏富余为储能补能，并在低负载窗口合并冷量需求。</p>
            </div>
            <div class="agent-scores">
              <div><span>能效评分</span><b id="agent-efficiency">92</b><i style="--score:92%"></i></div>
              <div><span>热安全裕量</span><b id="agent-thermal">良好</b><i style="--score:76%"></i></div>
              <div><span>算力余量</span><b id="agent-capacity">96 卡</b><i style="--score:25%"></i></div>
            </div>
            <div class="agent-footer">
              <span>自动处置 ${this.engine.getSnapshot().compute.migratingTasks > 0 ? '运行中' : '待命'}</span>
              <span id="agent-score">策略置信度 96.4%</span>
            </div>
          </div>
        </section>
      </div>
    </aside>
  </div>
</div>
<div class="toast-container" id="toast-container"></div>`;
  }

  destroy(): void {
    window.clearInterval(this.timer);
    this.chart?.destroy();
    this.scene?.destroy();
  }
}
