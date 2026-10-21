import fs from 'node:fs';

const cdpPort = process.env.CDP_PORT ?? '9223';
const tabs = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
const page = tabs.find((tab) => tab.type === 'page' && tab.url.includes('127.0.0.1:5173'));
if (!page) throw new Error('Dashboard tab not found');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let requestId = 0;
const pending = new Map();
const consoleMessages = [];
const exceptions = [];
const logEntries = [];

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    consoleMessages.push({
      type: message.params.type,
      text: message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '),
    });
  }
  if (message.method === 'Runtime.exceptionThrown') {
    exceptions.push(message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description ?? ''));
  }
  if (message.method === 'Log.entryAdded') {
    logEntries.push({ level: message.params.entry.level, text: message.params.entry.text });
  }
});

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

function send(method, params = {}) {
  const id = ++requestId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 15000);
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description ?? ''));
  }
  return result.result.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.reload', { ignoreCache: true });
await sleep(5000);

const health = await evaluate(`(() => {
  const app = window.__AIDC__;
  const canvas = document.querySelector('#scene-host canvas');
  const shell = document.querySelector('.shell');
  const pue = document.getElementById('pue-value')?.textContent;
  return {
    hasApp: !!app,
    hasEngine: !!app?.engine,
    tick: app?.engine?.getSnapshot().tick,
    pue,
    canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
    shell: shell ? { width: shell.clientWidth, height: shell.clientHeight } : null,
    bodyOverflow: getComputedStyle(document.body).overflow,
    webgl: !!canvas,
    sceneDevices: app?.dashboard?.scene?.deviceGroups?.size ?? 0,
    heatCells: document.querySelectorAll('.heatmap-cell').length,
    taskRows: document.querySelectorAll('.task-row').length,
    events: document.querySelectorAll('.event-row').length,
    bootHidden: document.getElementById('boot-screen')?.classList.contains('done'),
  };
})()`);

const rackPoint = await evaluate(`(() => {
  const d = window.__AIDC__.dashboard;
  const scene = d.scene;
  const obj = scene.deviceGroups.get('A01');
  const rect = document.querySelector('#scene-host canvas').getBoundingClientRect();
  const v = obj.position.clone();
  v.y = 1.3;
  v.project(scene.camera);
  return { x: rect.left + (v.x * .5 + .5) * rect.width, y: rect.top + (-v.y * .5 + .5) * rect.height };
})()`);

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rackPoint.x, y: rackPoint.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rackPoint.x, y: rackPoint.y, button: 'left', clickCount: 1 });
await sleep(800);

const popover = await evaluate(`(() => {
  const el = document.getElementById('device-popover');
  return { hidden: el?.classList.contains('hidden'), title: el?.querySelector('h3')?.textContent, metrics: el?.querySelectorAll('.popover-metric').length };
})()`);

await evaluate(`document.getElementById('device-close')?.click()`);
await evaluate(`document.getElementById('inject-fault').click()`);
await sleep(1400);
const faultState = await evaluate(`(() => {
  const s = window.__AIDC__.engine.getSnapshot();
  return { faults: s.compute.faultCards, migrating: s.compute.migratingTasks, alert: document.getElementById('alert-strip')?.className, alertText: document.getElementById('alert-strip')?.textContent };
})()`);

await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then((result) => {
  fs.writeFileSync('reports/dashboard-fault.png', Buffer.from(result.data, 'base64'));
});

await evaluate(`document.getElementById('add-training').click()`);
await sleep(500);
const queueAfter = await evaluate(`(() => ({
  tasks: document.querySelectorAll('.task-row').length,
  queue: window.__AIDC__.engine.getSnapshot().compute.queueDepth,
  validation: document.getElementById('validation-status')?.textContent,
  agent: document.getElementById('agent-recommendation')?.textContent,
}))()`);

await evaluate(`document.getElementById('walk-toggle').click()`);
await sleep(500);
const walk = await evaluate(`(() => ({
  mode: window.__AIDC__.dashboard.scene.getMode(),
  cursor: getComputedStyle(document.querySelector('#scene-host canvas')).cursor,
  hud: getComputedStyle(document.querySelector('.fp-hud')).display,
}))()`);
await evaluate(`document.getElementById('reset-camera').click()`);

await evaluate(`(() => {
  window.__AIDC__.engine.pause();
  window.__AIDC__.engine.advance(500);
  window.__AIDC__.engine.repairFaults();
  window.__AIDC__.engine.start();
})()`);
await sleep(4600);
const lowLoad = await evaluate(`(() => {
  const s = window.__AIDC__.engine.getSnapshot();
  const right = document.querySelector('.right-scroll');
  const left = document.querySelector('.rail-scroll');
  return {
    pue: s.energy.pue,
    pueStatus: s.energy.pueStatus,
    alert: document.getElementById('alert-strip')?.className,
    alertText: document.getElementById('alert-strip')?.textContent,
    queueDepth: s.compute.queueDepth,
    util: s.compute.utilization,
    layout: {
      rightClient: right?.clientHeight,
      rightScroll: right?.scrollHeight,
      leftClient: left?.clientHeight,
      leftScroll: left?.scrollHeight,
    },
  };
})()`);
await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then((result) => {
  fs.writeFileSync('reports/dashboard-final.png', Buffer.from(result.data, 'base64'));
});

const report = {
  health,
  rackPoint,
  popover,
  faultState,
  queueAfter,
  walk,
  lowLoad,
  consoleMessages,
  exceptions,
  logEntries: logEntries.filter((entry) => entry.level === 'error' || entry.level === 'warning'),
};
console.log(JSON.stringify(report, null, 2));

await send('Browser.close').catch(() => {});
ws.close();
