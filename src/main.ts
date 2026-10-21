import './styles.css';
import { DigitalTwinEngine } from './sim/engine';
import { Dashboard } from './ui/dashboard';

const boot = document.getElementById('boot-screen');
const root = document.getElementById('app');

try {
  if (!root) throw new Error('Application root not found');
  const engine = new DigitalTwinEngine({
    startTime: new Date(),
    tickIntervalMs: 2200,
    autoTaskGeneration: true,
  });
  const dashboard = new Dashboard(engine, root);
  dashboard.init();
  Object.assign(window, {
    __AIDC__: {
      engine,
      dashboard,
      version: '1.0.0',
    },
  });
  window.setTimeout(() => boot?.classList.add('done'), 900);
  window.addEventListener('beforeunload', () => {
    engine.pause();
    dashboard.destroy();
  });
} catch (error) {
  console.error('AIDC dashboard failed to start', error);
  if (boot) {
    boot.innerHTML = `<div class="boot-title" style="font-size:18px">NEXUS AIDC</div>
      <div class="boot-sub" style="max-width:520px;text-align:center;line-height:1.8;color:#ff9aac">
        启动失败：${error instanceof Error ? error.message : String(error)}<br/>
        请检查 WebGL / 浏览器硬件加速后刷新页面。
      </div>`;
  }
}
