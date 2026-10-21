import type { TelemetryPoint } from '../types';

interface ChartSeries {
  label: string;
  color: string;
  values: number[];
  fill?: boolean;
}

const palette = {
  grid: 'rgba(105, 168, 191, 0.10)',
  axis: 'rgba(123, 172, 190, 0.45)',
  label: 'rgba(116, 151, 167, 0.82)',
};

function drawSmoothPath(
  context: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
): void {
  if (points.length === 0) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const controlX = (previous.x + current.x) / 2;
    context.bezierCurveTo(controlX, previous.y, controlX, current.y, current.x, current.y);
  }
}

export class PowerChart {
  private readonly context: CanvasRenderingContext2D;
  private points: TelemetryPoint[] = [];
  private resizeObserver: ResizeObserver;
  private width = 0;
  private height = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas unavailable');
    this.context = context;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  update(points: TelemetryPoint[]): void {
    this.points = points.slice(-180);
    this.draw();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private draw(): void {
    const { context, width, height } = this;
    if (width < 10 || height < 10) return;
    context.clearRect(0, 0, width, height);

    const pad = { left: 34, right: 10, top: 9, bottom: 18 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    const points = this.points;
    if (points.length < 2) {
      context.fillStyle = palette.label;
      context.font = '8px "JetBrains Mono", Consolas, monospace';
      context.textAlign = 'center';
      context.fillText('遥测采样中…', width / 2, height / 2);
      return;
    }

    const series: ChartSeries[] = [
      {
        label: '总功率',
        color: '#37dfff',
        values: points.map((point) => point.totalKw),
        fill: true,
      },
      {
        label: 'IT',
        color: '#b8ff5a',
        values: points.map((point) => point.itKw),
      },
      {
        label: '制冷',
        color: '#ffc857',
        values: points.map((point) => point.coolingKw),
      },
    ];
    const maxValue = Math.max(...series.flatMap((item) => item.values), 100);
    const yMax = Math.ceil(maxValue / 100) * 100;
    const xAt = (index: number): number =>
      pad.left + (index / Math.max(1, points.length - 1)) * plotW;
    const yAt = (value: number): number => pad.top + plotH - (value / yMax) * plotH;

    context.save();
    context.font = '7px "JetBrains Mono", Consolas, monospace';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    for (let tick = 0; tick <= 3; tick += 1) {
      const value = (yMax / 3) * tick;
      const y = yAt(value);
      context.strokeStyle = palette.grid;
      context.lineWidth = 0.7;
      context.beginPath();
      context.moveTo(pad.left, y);
      context.lineTo(width - pad.right, y);
      context.stroke();
      context.fillStyle = palette.label;
      context.fillText(`${Math.round(value)}`, pad.left - 6, y);
    }

    context.textAlign = 'left';
    const labelCount = Math.min(4, points.length);
    for (let tick = 0; tick < labelCount; tick += 1) {
      const index = Math.round((tick / Math.max(1, labelCount - 1)) * (points.length - 1));
      const date = new Date(points[index].at);
      const label = `${String(date.getHours()).padStart(2, '0')}:${String(
        date.getMinutes(),
      ).padStart(2, '0')}`;
      const x = xAt(index);
      context.fillStyle = palette.label;
      context.textAlign = tick === 0 ? 'left' : tick === labelCount - 1 ? 'right' : 'center';
      context.fillText(label, x, height - 7);
    }

    const total = series[0];
    context.beginPath();
    context.moveTo(xAt(0), pad.top + plotH);
    for (let index = 0; index < total.values.length; index += 1) {
      context.lineTo(xAt(index), yAt(total.values[index]));
    }
    context.lineTo(xAt(total.values.length - 1), pad.top + plotH);
    context.closePath();
    const gradient = context.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    gradient.addColorStop(0, 'rgba(55, 223, 255, 0.18)');
    gradient.addColorStop(0.55, 'rgba(55, 223, 255, 0.055)');
    gradient.addColorStop(1, 'rgba(55, 223, 255, 0)');
    context.fillStyle = gradient;
    context.fill();

    for (const item of series) {
      const coords = item.values.map((value, index) => ({ x: xAt(index), y: yAt(value) }));
      drawSmoothPath(context, coords);
      context.strokeStyle = item.color;
      context.lineWidth = item === total ? 1.55 : 1.05;
      context.globalAlpha = item === total ? 1 : 0.8;
      context.shadowColor = item.color;
      context.shadowBlur = item === total ? 7 : 3;
      context.stroke();
      context.shadowBlur = 0;
      context.globalAlpha = 1;
    }

    const lastIndex = points.length - 1;
    const lastTotal = total.values[lastIndex];
    const lastX = xAt(lastIndex);
    const lastY = yAt(lastTotal);
    context.beginPath();
    context.arc(lastX, lastY, 2.2, 0, Math.PI * 2);
    context.fillStyle = '#dffaff';
    context.shadowColor = '#37dfff';
    context.shadowBlur = 10;
    context.fill();
    context.shadowBlur = 0;

    context.restore();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
  }
}
