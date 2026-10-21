import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMPUS, COLD_AISLES, RACK_DEFINITIONS, ROWS } from '../data/topology';
import type { EngineSnapshot, RackState } from '../types';

export type SceneLayer = 'campus' | 'hall' | 'network';
export type SceneMode = 'orbit' | 'walk';

export interface SceneDevice {
  id: string;
  kind: string;
  name: string;
}

export interface SceneCallbacks {
  onSelect?: (device: SceneDevice, position: { x: number; y: number }) => void;
  onClearSelection?: () => void;
  onHover?: (device: SceneDevice | null) => void;
  onModeChange?: (mode: SceneMode) => void;
}

interface RackVisual {
  def: (typeof RACK_DEFINITIONS)[number];
  group: THREE.Group;
  bodyMaterial: THREE.MeshStandardMaterial;
  frontMaterial: THREE.MeshStandardMaterial;
  ledMaterial: THREE.MeshStandardMaterial;
  label: THREE.Sprite;
  labelMaterial: THREE.SpriteMaterial;
  faultRing: THREE.Mesh;
  faultLight: THREE.PointLight;
  beacon: THREE.Mesh;
  outline: THREE.LineSegments;
  faultBeam: THREE.Mesh;
  faultLabel: THREE.Sprite;
  fanSpeed: number;
}

interface FlowParticle {
  mesh: THREE.Mesh;
  curve: THREE.CatmullRomCurve3;
  offset: number;
  speed: number;
}

interface SceneLabel {
  element: HTMLDivElement;
  subElement: HTMLElement;
  anchor: THREE.Vector3;
  layer: SceneLayer;
  key?: string;
}

const COLORS = {
  cyan: 0x37dfff,
  cyanDim: 0x0c6173,
  teal: 0x1ba7b9,
  lime: 0xb8ff5a,
  amber: 0xffc857,
  orange: 0xff8c42,
  red: 0xff4d6d,
  violet: 0x9b8cff,
  steel: 0x1b2a34,
  dark: 0x081118,
  glass: 0x7ecbea,
};

const standardMaterial = (
  color: number,
  options: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color,
    metalness: 0.55,
    roughness: 0.4,
    ...options,
  });

const addMesh = (
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
): THREE.Mesh => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
};

const addEdges = (
  mesh: THREE.Mesh,
  color = COLORS.cyanDim,
  opacity = 0.45,
): THREE.LineSegments => {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
  mesh.add(edges);
  return edges;
};

const makeFaultSprite = (): THREE.Sprite => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(46, 7, 15, 0.92)';
    context.strokeStyle = 'rgba(255, 77, 109, 0.95)';
    context.lineWidth = 3;
    context.beginPath();
    context.roundRect(30, 16, 196, 48, 7);
    context.fill();
    context.stroke();
    context.fillStyle = '#ff6c86';
    context.font = '700 23px "Segoe UI", "Microsoft YaHei", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('● FAULT', 128, 41);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.8, 0.56, 1);
  return sprite;
};

const makeTextureLabel = (text: string): THREE.Sprite => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Sprite(new THREE.SpriteMaterial());
  context.clearRect(0, 0, 256, 80);
  context.fillStyle = 'rgba(4, 15, 23, 0.72)';
  context.strokeStyle = 'rgba(84, 206, 240, 0.42)';
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(38, 17, 180, 46, 7);
  context.fill();
  context.stroke();
  context.fillStyle = '#c9ecf6';
  context.font = '600 24px "Segoe UI", "Microsoft YaHei", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 128, 41);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.7, 0.53, 1);
  return sprite;
};

const screenTexture = (): {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  context: CanvasRenderingContext2D;
} | null => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture, context };
};

const drawCduScreen = (
  context: CanvasRenderingContext2D,
  texture: THREE.CanvasTexture,
  supply: number,
  returnC: number,
  load: number,
): void => {
  context.fillStyle = '#041018';
  context.fillRect(0, 0, 256, 128);
  context.strokeStyle = 'rgba(55,223,255,.25)';
  context.lineWidth = 2;
  context.strokeRect(5, 5, 246, 118);
  context.fillStyle = '#37dfff';
  context.font = '600 17px "Segoe UI", sans-serif';
  context.fillText('LIQUID CDU', 16, 28);
  context.fillStyle = 'rgba(130,190,207,.75)';
  context.font = '11px "Cascadia Code", monospace';
  context.fillText('SUPPLY', 16, 58);
  context.fillText('RETURN', 16, 80);
  context.fillText('LOAD', 16, 102);
  context.fillStyle = '#b8ff5a';
  context.font = '600 20px "Cascadia Code", monospace';
  context.textAlign = 'right';
  context.fillText(`${supply.toFixed(1)}°`, 240, 60);
  context.fillStyle = '#ffc857';
  context.fillText(`${returnC.toFixed(1)}°`, 240, 82);
  context.fillStyle = '#37dfff';
  context.fillText(`${load.toFixed(0)} kW`, 240, 104);
  context.textAlign = 'left';
  context.fillStyle = '#54e6b1';
  context.beginPath();
  context.arc(218, 22, 4, 0, Math.PI * 2);
  context.fill();
  texture.needsUpdate = true;
};

/**
 * WebGL digital twin. All scene equipment is registered as a clickable device,
 * while the simulation snapshot drives rack LEDs, fault beacons, fans and data
 * flow. Rendering is isolated from the simulation so one bad frame cannot stop
 * the operations loop.
 */
export class DigitalTwinScene {
  private readonly host: HTMLElement;
  private readonly callbacks: SceneCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly timer = new THREE.Timer();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly layerGroups: Record<SceneLayer, THREE.Group> = {
    campus: new THREE.Group(),
    hall: new THREE.Group(),
    network: new THREE.Group(),
  };
  private readonly layerVisible: Record<SceneLayer, boolean> = {
    campus: true,
    hall: true,
    network: true,
  };
  private readonly pickables: THREE.Object3D[] = [];
  private readonly deviceGroups = new Map<string, THREE.Group>();
  private readonly rackVisuals = new Map<string, RackVisual>();
  private readonly fans: THREE.Group[] = [];
  private readonly flows: FlowParticle[] = [];
  private readonly labels: SceneLabel[] = [];
  private readonly pvMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly bessLeds: THREE.MeshStandardMaterial[] = [];
  private readonly cduScreens: Array<{
    context: CanvasRenderingContext2D;
    texture: THREE.CanvasTexture;
    group: THREE.Group;
  }> = [];
  private readonly labelContainer: HTMLDivElement;
  private selectionOutline: THREE.BoxHelper | null = null;
  private selectedId: string | null = null;
  private latestSnapshot: EngineSnapshot | null = null;
  private mode: SceneMode = 'orbit';
  private resizeObserver: ResizeObserver;
  private frameId = 0;
  private walkYaw = 0;
  private walkPitch = 0;
  private readonly keys = new Set<string>();
  private dragStart = { x: 0, y: 0 };
  private pointerDown = false;
  private pointerMoved = false;
  private lastHoverAt = 0;
  private networkIntensity = 0.7;
  private thermalIntensity = 0.6;
  private savedOrbit = {
    position: new THREE.Vector3(22, 13, 28),
    target: new THREE.Vector3(0, 1.7, 0),
  };
  private disposed = false;

  constructor(host: HTMLElement, callbacks: SceneCallbacks = {}) {
    this.host = host;
    this.callbacks = callbacks;
    this.scene.background = new THREE.Color(0x050d15);
    this.scene.fog = new THREE.FogExp2(0x050d15, 0.0125);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 220);
    this.camera.position.copy(this.savedOrbit.position);
    this.camera.lookAt(this.savedOrbit.target);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(host.clientWidth || 800, host.clientHeight || 500, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'AIDC 三维数字孪生场景');
    host.appendChild(this.renderer.domElement);

    this.labelContainer = document.createElement('div');
    this.labelContainer.className = 'scene-labels';
    host.appendChild(this.labelContainer);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.savedOrbit.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 72;
    this.controls.maxPolarAngle = 1.49;
    this.controls.minPolarAngle = 0.16;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.update();
    this.timer.connect(document);

    this.scene.add(this.layerGroups.campus, this.layerGroups.hall, this.layerGroups.network);
    this.buildLighting();
    this.buildGround();
    this.buildCampus();
    this.buildHall();
    this.buildNetwork();
    this.addLabels();
    this.bindEvents();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);

    this.animate();
  }

  private buildLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xb7e8fa, 0x0a1820, 1.95);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xd3efff, 3.45);
    key.position.set(22, 30, 24);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -34;
    key.shadow.camera.right = 34;
    key.shadow.camera.top = 30;
    key.shadow.camera.bottom = -30;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 90;
    key.shadow.bias = -0.001;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x2d8fc0, 1.35);
    rim.position.set(-26, 14, -22);
    this.scene.add(rim);

    const warm = new THREE.PointLight(0xffb86b, 24, 28, 2);
    warm.position.set(10, 4, 9);
    this.scene.add(warm);

    const cold = new THREE.PointLight(0x37dfff, 20, 30, 2);
    cold.position.set(-6, 4, -4);
    this.scene.add(cold);

    for (const [x, z] of [
      [-7, -5],
      [7, -5],
      [-7, 5],
      [7, 5],
    ] as Array<[number, number]>) {
      const light = new THREE.PointLight(0x6bdcff, 11, 13, 2);
      light.position.set(x, 4.2, z);
      this.scene.add(light);
    }
  }

  private buildGround(): void {
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x06121a,
      metalness: 0.22,
      roughness: 0.88,
    });
    const ground = addMesh(
      this.scene,
      new THREE.PlaneGeometry(100, 82),
      groundMaterial,
      [0, -0.03, 0],
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;

    const grid = new THREE.GridHelper(94, 94, 0x165267, 0x0b2633);
    grid.position.y = 0.008;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of gridMaterials) {
      material.transparent = true;
      material.opacity = 0.25;
    }
    this.scene.add(grid);

    for (const radius of [17.5, 22.5, 27.5]) {
      const ring = addMesh(
        this.scene,
        new THREE.RingGeometry(radius - 0.025, radius + 0.025, 128),
        new THREE.MeshBasicMaterial({
          color: 0x1a7f99,
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
        }),
        [0, 0.015, 0],
      );
      ring.rotation.x = -Math.PI / 2;
    }

    const pad = addMesh(
      this.scene,
      new THREE.CylinderGeometry(15.8, 16.1, 0.18, 64),
      standardMaterial(0x08161f, { metalness: 0.34, roughness: 0.7 }),
      [0, 0.06, 0],
    );
    pad.receiveShadow = true;
    addEdges(pad, 0x174d5f, 0.35);

    const walkwayMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a1c27,
      roughness: 0.76,
      metalness: 0.2,
    });
    for (const z of [-12.4, 12.4]) {
      const walkway = addMesh(
        this.scene,
        new THREE.PlaneGeometry(46, 3.2),
        walkwayMaterial,
        [0, 0.005, z],
      );
      walkway.rotation.x = -Math.PI / 2;
    }
    for (const x of [-24, 24]) {
      const line = addMesh(
        this.scene,
        new THREE.PlaneGeometry(0.09, 46),
        new THREE.MeshBasicMaterial({ color: 0x143d4c, transparent: true, opacity: 0.8 }),
        [x, 0.007, 0],
      );
      line.rotation.x = -Math.PI / 2;
    }
  }

  private buildCampus(): void {
    const group = this.layerGroups.campus;
    this.buildSolarRoof(group);
    this.buildBess(group);
    this.buildDiesel(group);
    this.buildSwitchgear(group);
    this.buildTransformer(group);
    this.buildCoolingPlant(group);
    this.buildLandscape(group);
  }

  private buildSolarRoof(group: THREE.Group): void {
    const solar = new THREE.Group();
    solar.position.y = 6.05;
    const panelMaterial = standardMaterial(0x0b2c52, {
      metalness: 0.58,
      roughness: 0.22,
      emissive: new THREE.Color(0x0a4d8a),
      emissiveIntensity: 0.65,
    });
    this.pvMaterials.push(panelMaterial);
    const frameMaterial = standardMaterial(0x526a77, { metalness: 0.8, roughness: 0.28 });
    const positions: Array<[number, number]> = [];
    for (const x of [-7.2, -2.4, 2.4, 7.2]) {
      for (const z of [-5.6, -1.9]) positions.push([x, z]);
    }
    for (const [x, z] of positions) {
      const panel = addMesh(
        solar,
        new THREE.BoxGeometry(3.15, 0.08, 1.5),
        panelMaterial,
        [x, 0.32, z],
      );
      panel.rotation.x = -0.22;
      panel.castShadow = true;
      const frame = addMesh(
        solar,
        new THREE.BoxGeometry(3.25, 0.04, 1.6),
        frameMaterial,
        [x, 0.27, z],
      );
      frame.rotation.x = -0.22;
      addEdges(panel, 0x2b8dbb, 0.42);
      const leg = addMesh(
        solar,
        new THREE.BoxGeometry(0.07, 0.65, 0.07),
        frameMaterial,
        [x, -0.02, z],
      );
      leg.castShadow = true;
    }
    this.register(solar, 'pv-array', 'pv', '光伏屋顶阵列');

    const canopy = new THREE.Group();
    canopy.position.set(-17.5, 0, 13.5);
    const canopyPanelMaterial = standardMaterial(0x0c325b, {
      metalness: 0.55,
      roughness: 0.24,
      emissive: new THREE.Color(0x0a4d8a),
      emissiveIntensity: 0.62,
    });
    this.pvMaterials.push(canopyPanelMaterial);
    for (let index = 0; index < 4; index += 1) {
      const panel = addMesh(
        canopy,
        new THREE.BoxGeometry(3.4, 0.08, 1.55),
        canopyPanelMaterial,
        [index * 3.8, 3.2, 0],
      );
      panel.rotation.x = -0.18;
      addEdges(panel, 0x2b8dbb, 0.36);
      for (const z of [-1.2, 1.2]) {
        addMesh(
          canopy,
          new THREE.CylinderGeometry(0.045, 0.045, 3.2, 8),
          frameMaterial,
          [index * 3.8, 1.6, z],
        );
      }
    }
    group.add(solar, canopy);
  }

  private buildBess(group: THREE.Group): void {
    const bess = new THREE.Group();
    bess.position.set(-19.2, 0, 2.4);
    const shell = standardMaterial(0x123c35, { metalness: 0.56, roughness: 0.36 });
    const accent = standardMaterial(0x0c1a1d, { metalness: 0.7, roughness: 0.3 });
    for (let index = 0; index < 4; index += 1) {
      const container = new THREE.Group();
      container.position.set(0, 0, index * 2.25);
      const body = addMesh(container, new THREE.BoxGeometry(3.2, 2.0, 1.75), shell, [0, 1.1, 0]);
      body.castShadow = true;
      addEdges(body, 0x3aa78f, 0.38);
      addMesh(container, new THREE.BoxGeometry(2.85, 0.08, 1.35), accent, [0, 2.12, 0]);
      const ledMaterial = standardMaterial(0x54e6b1, {
        emissive: new THREE.Color(0x39ffb3),
        emissiveIntensity: 1.2,
      });
      this.bessLeds.push(ledMaterial);
      for (let led = 0; led < 5; led += 1) {
        addMesh(
          container,
          new THREE.BoxGeometry(0.42, 0.018, 0.02),
          ledMaterial,
          [-1.25 + led * 0.53, 1.56, 0.89],
        );
      }
      for (let vent = 0; vent < 4; vent += 1) {
        addMesh(
          container,
          new THREE.BoxGeometry(2.6, 0.035, 0.02),
          new THREE.MeshBasicMaterial({ color: 0x1d5e53 }),
          [0, 0.55 + vent * 0.16, 0.895],
        );
      }
      bess.add(container);
    }
    this.register(bess, 'bess', 'bess', '储能系统 BESS');
    group.add(bess);
  }

  private buildDiesel(group: THREE.Group): void {
    const diesel = new THREE.Group();
    diesel.position.set(17.6, 0, 6.8);
    const shell = standardMaterial(0x3c4146, { metalness: 0.7, roughness: 0.34 });
    const yellow = standardMaterial(0xd9a62e, { metalness: 0.45, roughness: 0.45 });
    const dark = standardMaterial(0x10171c, { metalness: 0.5, roughness: 0.55 });
    for (let index = 0; index < 2; index += 1) {
      const unit = new THREE.Group();
      unit.position.set(index * 3.4, 0, 0);
      const body = addMesh(unit, new THREE.BoxGeometry(3.0, 2.0, 1.85), shell, [0, 1.1, 0]);
      body.castShadow = true;
      addEdges(body, 0x6e8a98, 0.35);
      addMesh(unit, new THREE.BoxGeometry(2.65, 0.13, 1.4), yellow, [0, 1.74, 0.06]);
      addMesh(unit, new THREE.BoxGeometry(2.1, 0.55, 0.04), dark, [0, 1.05, 0.94]);
      addMesh(
        unit,
        new THREE.CylinderGeometry(0.14, 0.17, 2.2, 14),
        dark,
        [1.15, 2.75, -0.42],
      );
      const tank = addMesh(
        unit,
        new THREE.CylinderGeometry(0.65, 0.65, 2.9, 18),
        yellow,
        [-2.1, 0.85, 0],
      );
      tank.rotation.z = Math.PI / 2;
      tank.castShadow = true;
      for (let vent = 0; vent < 4; vent += 1) {
        addMesh(unit, new THREE.BoxGeometry(2.3, 0.04, 0.02), dark, [0, 0.45 + vent * 0.15, 0.94]);
      }
      diesel.add(unit);
    }
    this.register(diesel, 'diesel', 'diesel', '柴油发电机');
    group.add(diesel);
  }

  private buildSwitchgear(group: THREE.Group): void {
    const switchgear = new THREE.Group();
    switchgear.position.set(17.5, 0, -3.2);
    const metal = standardMaterial(0x34444e, { metalness: 0.82, roughness: 0.25 });
    const screen = new THREE.MeshStandardMaterial({
      color: 0x0a2029,
      emissive: new THREE.Color(0x2ad7f2),
      emissiveIntensity: 0.7,
      metalness: 0.3,
      roughness: 0.4,
    });
    for (let index = 0; index < 3; index += 1) {
      const cabinet = new THREE.Group();
      cabinet.position.set(index * 2.25, 0, 0);
      const body = addMesh(
        cabinet,
        new THREE.BoxGeometry(2.0, 2.35, 1.1),
        metal,
        [0, 1.28, 0],
      );
      body.castShadow = true;
      addEdges(body, 0x668595, 0.4);
      addMesh(cabinet, new THREE.BoxGeometry(0.62, 0.3, 0.02), screen, [0.35, 1.68, 0.56]);
      for (let row = 0; row < 5; row += 1) {
        addMesh(
          cabinet,
          new THREE.BoxGeometry(1.55, 0.035, 0.02),
          new THREE.MeshBasicMaterial({ color: 0x182b34 }),
          [0, 0.55 + row * 0.17, 0.56],
        );
      }
      switchgear.add(cabinet);
    }
    this.register(switchgear, 'switchgear', 'switchgear', '10kV 主进线柜');
    group.add(switchgear);
  }

  private buildTransformer(group: THREE.Group): void {
    const transformer = new THREE.Group();
    transformer.position.set(20.8, 0, -9.8);
    const body = addMesh(
      transformer,
      new THREE.BoxGeometry(3.3, 2.4, 2.1),
      standardMaterial(0x425661, { metalness: 0.66, roughness: 0.38 }),
      [0, 1.35, 0],
    );
    body.castShadow = true;
    addEdges(body, 0x75939f, 0.35);
    for (let fin = 0; fin < 7; fin += 1) {
      addMesh(
        transformer,
        new THREE.BoxGeometry(0.1, 1.5, 2.55),
        standardMaterial(0x2d3f49, { metalness: 0.7, roughness: 0.3 }),
        [-1.3 + fin * 0.44, 1.35, 0],
      );
    }
    for (const x of [-0.8, 0, 0.8]) {
      addMesh(
        transformer,
        new THREE.CylinderGeometry(0.08, 0.11, 1.0, 8),
        standardMaterial(0x8b6d45, { metalness: 0.15, roughness: 0.7 }),
        [x, 3.05, 0],
      );
    }
    this.register(transformer, 'transformer', 'transformer', '主变压器 / 市电接入');
    group.add(transformer);

    const pylon = new THREE.Group();
    pylon.position.set(25.5, 0, -14.5);
    const steel = new THREE.LineBasicMaterial({ color: 0x4b7385, transparent: true, opacity: 0.7 });
    for (const side of [-1, 1]) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(side * 1.1, 0, 0),
        new THREE.Vector3(side * 0.34, 8.2, 0),
      ]);
      pylon.add(new THREE.Line(geometry, steel));
    }
    for (let level = 0; level < 5; level += 1) {
      const y = 1.2 + level * 1.65;
      const width = 1.0 - level * 0.12;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-width, y, 0),
        new THREE.Vector3(width, y, 0),
      ]);
      pylon.add(new THREE.Line(geometry, steel));
    }
    group.add(pylon);
  }

  private buildCoolingPlant(group: THREE.Group): void {
    const plant = new THREE.Group();
    plant.position.set(-18.8, 0, -7.2);
    const shell = standardMaterial(0x213743, { metalness: 0.62, roughness: 0.4 });
    for (let index = 0; index < 2; index += 1) {
      const unit = new THREE.Group();
      unit.position.set(index * 4.0, 0, 0);
      const body = addMesh(unit, new THREE.BoxGeometry(3.5, 1.8, 2.6), shell, [0, 1.05, 0]);
      body.castShadow = true;
      addEdges(body, 0x4a849b, 0.35);
      for (const x of [-0.82, 0.82]) {
        const fan = new THREE.Group();
        fan.position.set(x, 2.03, 0);
        addMesh(
          fan,
          new THREE.CylinderGeometry(0.67, 0.67, 0.08, 28),
          standardMaterial(0x0b1b22, { metalness: 0.5, roughness: 0.65 }),
          [0, 0, 0],
        );
        for (let blade = 0; blade < 5; blade += 1) {
          const mesh = addMesh(
            fan,
            new THREE.BoxGeometry(0.48, 0.02, 0.11),
            standardMaterial(0x5c8294, { metalness: 0.5, roughness: 0.45 }),
            [0.26, 0.05, 0],
          );
          mesh.rotation.y = (blade / 5) * Math.PI * 2;
        }
        this.fans.push(fan);
        unit.add(fan);
      }
      plant.add(unit);
    }
    this.register(plant, 'chiller-plant', 'chiller', '干冷器 / 冷源机组');
    group.add(plant);
  }

  private buildLandscape(group: THREE.Group): void {
    const trunkMaterial = standardMaterial(0x5b4633, { metalness: 0.05, roughness: 0.9 });
    const leafMaterial = standardMaterial(0x1f5c4b, { metalness: 0.05, roughness: 0.9 });
    const positions: Array<[number, number, number]> = [
      [-27, 0, 11],
      [-24, 0, 15],
      [24, 0, 16],
      [28, 0, 9],
      [-28, 0, -4],
      [-25, 0, -12],
      [8, 0, -16],
      [-8, 0, 16],
    ];
    for (const [x, , z] of positions) {
      const tree = new THREE.Group();
      tree.position.set(x, 0, z);
      const trunk = addMesh(tree, new THREE.CylinderGeometry(0.12, 0.18, 1.8, 7), trunkMaterial, [0, 0.9, 0]);
      trunk.castShadow = true;
      const crown = addMesh(tree, new THREE.ConeGeometry(1.15, 2.8, 8), leafMaterial, [0, 2.65, 0]);
      crown.castShadow = true;
      group.add(tree);
    }

    const parking = addMesh(
      group,
      new THREE.PlaneGeometry(16, 7.5),
      new THREE.MeshStandardMaterial({ color: 0x0b1c26, roughness: 0.84, metalness: 0.15 }),
      [-16, 0.012, 15.2],
    );
    parking.rotation.x = -Math.PI / 2;
    for (let index = 0; index < 5; index += 1) {
      addMesh(
        group,
        new THREE.PlaneGeometry(0.07, 6.5),
        new THREE.MeshBasicMaterial({ color: 0x1c4a5c, transparent: true, opacity: 0.65 }),
        [-21.5 + index * 2.7, 0.02, 15.2],
      ).rotation.x = -Math.PI / 2;
    }
  }

  private buildHall(): void {
    const group = this.layerGroups.hall;

    const floor = addMesh(
      group,
      new THREE.BoxGeometry(26, 0.25, 21),
      standardMaterial(0x0d202b, { metalness: 0.32, roughness: 0.68 }),
      [0, 0.05, 0],
    );
    floor.receiveShadow = true;
    addEdges(floor, 0x205a6d, 0.5);

    const wallMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0d2736,
      metalness: 0.42,
      roughness: 0.18,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const glassGeometry = new THREE.BoxGeometry(26, 5.4, 0.12);
    for (const z of [-10.5, 10.5]) {
      const wall = addMesh(group, glassGeometry, wallMaterial, [0, 2.85, z]);
      wall.renderOrder = 3;
    }
    const sideGlass = new THREE.BoxGeometry(0.12, 5.4, 21);
    for (const x of [-13, 13]) {
      const wall = addMesh(group, sideGlass, wallMaterial, [x, 2.85, 0]);
      wall.renderOrder = 3;
    }

    const frameMaterial = standardMaterial(0x24414e, { metalness: 0.72, roughness: 0.3 });
    for (const x of [-13, -6.5, 0, 6.5, 13]) {
      for (const z of [-10.5, 10.5]) {
        addMesh(group, new THREE.BoxGeometry(0.11, 5.7, 0.11), frameMaterial, [x, 2.85, z]);
      }
    }
    for (const z of [-10.5, 10.5]) {
      addMesh(group, new THREE.BoxGeometry(26, 0.12, 0.16), frameMaterial, [0, 5.62, z]);
    }
    for (const x of [-13, 13]) {
      addMesh(group, new THREE.BoxGeometry(0.16, 5.7, 0.12), frameMaterial, [x, 2.85, 0]);
    }

    const roofBeamMaterial = standardMaterial(0x1a2d38, { metalness: 0.7, roughness: 0.36 });
    for (let index = 0; index < 7; index += 1) {
      addMesh(
        group,
        new THREE.BoxGeometry(26, 0.12, 0.13),
        roofBeamMaterial,
        [0, 5.62, -9 + index * 3],
      );
    }
    addMesh(
      group,
      new THREE.BoxGeometry(26, 0.1, 21),
      new THREE.MeshPhysicalMaterial({
        color: 0x11303c,
        transparent: true,
        opacity: 0.085,
        metalness: 0.2,
        roughness: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      [0, 5.62, 0],
    );

    const ceilingLightMaterial = new THREE.MeshBasicMaterial({
      color: 0xc9f4ff,
      transparent: true,
      opacity: 0.88,
    });
    for (const x of [-9.2, -4.6, 0, 4.6, 9.2]) {
      addMesh(
        group,
        new THREE.BoxGeometry(0.12, 0.035, 8.4),
        ceilingLightMaterial,
        [x, 5.45, 0.2],
      );
    }

    const entrance = addMesh(
      group,
      new THREE.BoxGeometry(4.6, 2.5, 0.18),
      new THREE.MeshPhysicalMaterial({
        color: 0x123849,
        transparent: true,
        opacity: 0.38,
        metalness: 0.4,
        roughness: 0.15,
      }),
      [0, 1.25, 10.58],
    );
    addEdges(entrance, 0x3c9bbb, 0.4);

    this.buildAisles(group);
    this.buildRacks(group);
    this.buildCooling(group);
    this.buildPowerDistribution(group);
  }

  private buildAisles(group: THREE.Group): void {
    for (const aisle of COLD_AISLES) {
      const floor = addMesh(
        group,
        new THREE.PlaneGeometry(20.2, 2.2),
        new THREE.MeshBasicMaterial({
          color: COLORS.cyan,
          transparent: true,
          opacity: 0.075,
          side: THREE.DoubleSide,
        }),
        [0, 0.21, aisle.z],
      );
      floor.rotation.x = -Math.PI / 2;
      const lineMaterial = new THREE.LineBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity: 0.4,
      });
      for (const z of [aisle.z - 1.1, aisle.z + 1.1]) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-10.1, 0.23, z),
          new THREE.Vector3(10.1, 0.23, z),
        ]);
        group.add(new THREE.Line(geometry, lineMaterial));
      }
      for (let index = 0; index < 8; index += 1) {
        const sign = index % 2 === 0 ? 1 : -1;
        const chevron = addMesh(
          group,
          new THREE.BoxGeometry(0.42, 0.015, 0.04),
          new THREE.MeshBasicMaterial({
            color: COLORS.cyan,
            transparent: true,
            opacity: 0.22,
          }),
          [-8.2 + index * 2.35, 0.235, aisle.z],
        );
        chevron.rotation.y = sign * 0.6;
      }
    }

    const hotFloor = addMesh(
      group,
      new THREE.PlaneGeometry(20.2, 3.1),
      new THREE.MeshBasicMaterial({
        color: COLORS.orange,
        transparent: true,
        opacity: 0.045,
        side: THREE.DoubleSide,
      }),
      [0, 0.205, 0],
    );
    hotFloor.rotation.x = -Math.PI / 2;

    for (const row of ROWS) {
      const aisleZ = row.z + row.facing * 1.75;
      const labelGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-9.8, 0.235, aisleZ),
        new THREE.Vector3(9.8, 0.235, aisleZ),
      ]);
      const line = new THREE.Line(
        labelGeometry,
        new THREE.LineDashedMaterial({
          color: row.liquidCooled ? 0x5e8bff : 0x37dfff,
          transparent: true,
          opacity: 0.22,
          dashSize: 0.25,
          gapSize: 0.5,
        }),
      );
      line.computeLineDistances();
      group.add(line);
    }
  }

  private buildRacks(group: THREE.Group): void {
    for (const def of RACK_DEFINITIONS) {
      const rack = new THREE.Group();
      rack.position.set(def.x, 0.2, def.z);
      rack.rotation.y = def.facing === 1 ? 0 : Math.PI;

      const bodyMaterial = standardMaterial(0x0c1921, { metalness: 0.7, roughness: 0.3 });
      const body = addMesh(
        rack,
        new THREE.BoxGeometry(1.42, 2.3, 1.42),
        bodyMaterial,
        [0, 1.28, 0],
      );
      body.castShadow = true;
      body.receiveShadow = true;
      addEdges(body, 0x1d4c5c, 0.55);

      const frontMaterial = standardMaterial(0x07141c, {
        metalness: 0.35,
        roughness: 0.55,
        emissive: new THREE.Color(0x073340),
        emissiveIntensity: 0.45,
      });
      addMesh(rack, new THREE.PlaneGeometry(1.1, 1.86), frontMaterial, [0, 1.32, 0.715]);

      const ledMaterial = standardMaterial(0x37dfff, {
        metalness: 0.15,
        roughness: 0.25,
        emissive: new THREE.Color(COLORS.cyan),
        emissiveIntensity: 0.75,
      });
      addMesh(rack, new THREE.BoxGeometry(0.035, 1.57, 0.025), ledMaterial, [-0.49, 1.34, 0.73]);
      addMesh(rack, new THREE.BoxGeometry(0.035, 1.57, 0.025), ledMaterial, [0.49, 1.34, 0.73]);
      const slotMaterial = new THREE.MeshStandardMaterial({
        color: 0x10232c,
        metalness: 0.45,
        roughness: 0.5,
      });
      for (let slot = 0; slot < 8; slot += 1) {
        addMesh(
          rack,
          new THREE.BoxGeometry(0.82, 0.035, 0.026),
          slotMaterial,
          [0, 0.72 + slot * 0.17, 0.728],
        );
      }
      addMesh(
        rack,
        new THREE.BoxGeometry(0.9, 0.06, 0.02),
        new THREE.MeshBasicMaterial({ color: def.liquidCooled ? 0x5e8bff : 0x1b3a47 }),
        [0, 2.12, 0.728],
      );

      const topPlate = addMesh(
        rack,
        new THREE.BoxGeometry(1.5, 0.06, 1.5),
        standardMaterial(0x162c36, { metalness: 0.6, roughness: 0.35 }),
        [0, 2.46, 0],
      );
      addEdges(topPlate, 0x2d6f82, 0.35);

      const label = makeTextureLabel(def.id);
      label.position.set(0, 2.78, 0);
      rack.add(label);

      const faultRing = addMesh(
        rack,
        new THREE.RingGeometry(0.93, 1.14, 40),
        new THREE.MeshBasicMaterial({
          color: COLORS.red,
          transparent: true,
          opacity: 0.75,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
        [0, 0.02, 0],
      );
      faultRing.rotation.x = -Math.PI / 2;
      faultRing.visible = false;

      const beacon = addMesh(
        rack,
        new THREE.SphereGeometry(0.09, 14, 14),
        new THREE.MeshBasicMaterial({ color: COLORS.red }),
        [0, 2.9, 0],
      );
      beacon.visible = false;

      const faultLight = new THREE.PointLight(COLORS.red, 0, 4.5, 2);
      faultLight.position.set(0, 1.4, 0.4);
      rack.add(faultLight);

      const faultBeam = addMesh(
        rack,
        new THREE.CylinderGeometry(0.035, 0.1, 2.1, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: COLORS.red,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
        [0, 3.6, 0],
      );
      faultBeam.visible = false;
      const faultLabel = makeFaultSprite();
      faultLabel.position.set(0, 3.25, 0);
      faultLabel.visible = false;
      rack.add(faultLabel);

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1.6, 2.55, 1.6)),
        new THREE.LineBasicMaterial({
          color: 0x51e9ff,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
        }),
      );
      outline.position.y = 1.28;
      outline.visible = false;
      rack.add(outline);

      this.register(rack, def.id, 'rack', `${def.id} 算力机柜`);
      this.rackVisuals.set(def.id, {
        def,
        group: rack,
        bodyMaterial,
        frontMaterial,
        ledMaterial,
        label,
        labelMaterial: label.material as THREE.SpriteMaterial,
        faultRing,
        faultLight,
        beacon,
        outline,
        faultBeam,
        faultLabel,
        fanSpeed: 0,
      });
      group.add(rack);
    }
  }

  private buildCooling(group: THREE.Group): void {
    const positions: Array<[number, number, number]> = [
      [-11.3, -5.4, 1],
      [11.3, -5.4, -1],
      [-11.3, 5.4, 1],
      [11.3, 5.4, -1],
    ];
    positions.forEach(([x, z, rotation], index) => {
      const unit = new THREE.Group();
      unit.position.set(x, 0.2, z);
      unit.rotation.y = rotation * Math.PI * 0.5;
      const shell = standardMaterial(0x1a303b, { metalness: 0.58, roughness: 0.42 });
      const body = addMesh(unit, new THREE.BoxGeometry(1.9, 2.55, 1.15), shell, [0, 1.3, 0]);
      body.castShadow = true;
      addEdges(body, 0x4a8094, 0.4);
      addMesh(unit, new THREE.BoxGeometry(1.55, 0.36, 0.04), standardMaterial(0x0a1a22), [0, 2.38, 0.59]);
      for (let fanIndex = 0; fanIndex < 2; fanIndex += 1) {
        const fan = new THREE.Group();
        fan.position.set(-0.38 + fanIndex * 0.76, 1.35, 0.605);
        addMesh(
          fan,
          new THREE.TorusGeometry(0.28, 0.025, 8, 24),
          standardMaterial(0x4e7383, { metalness: 0.8, roughness: 0.25 }),
        );
        for (let blade = 0; blade < 4; blade += 1) {
          const mesh = addMesh(
            fan,
            new THREE.BoxGeometry(0.4, 0.025, 0.07),
            standardMaterial(0x6d8d9b, { metalness: 0.5, roughness: 0.4 }),
            [0.17, 0, 0],
          );
          mesh.rotation.z = (blade / 4) * Math.PI * 2;
        }
        this.fans.push(fan);
        unit.add(fan);
      }
      addMesh(
        unit,
        new THREE.BoxGeometry(0.05, 0.08, 0.02),
        new THREE.MeshBasicMaterial({ color: COLORS.cyan }),
        [0.62, 2.38, 0.62],
      );
      this.register(unit, `crah-${index + 1}`, 'crah', `行级空调 CRAH-${index + 1}`);
      group.add(unit);
    });

    for (const [index, x] of [-2.6, 2.6].entries()) {
      const cdu = new THREE.Group();
      cdu.position.set(x, 0.2, -0.2);
      const body = addMesh(
        cdu,
        new THREE.BoxGeometry(1.25, 2.15, 1.0),
        standardMaterial(0x1b303c, { metalness: 0.62, roughness: 0.36 }),
        [0, 1.1, 0],
      );
      body.castShadow = true;
      addEdges(body, 0x4b8ca5, 0.4);
      const screen = screenTexture();
      if (screen) {
        const texture = new THREE.MeshBasicMaterial({ map: screen.texture });
        addMesh(cdu, new THREE.PlaneGeometry(0.82, 0.4), texture, [0, 1.59, 0.505]);
        drawCduScreen(screen.context, screen.texture, 31.8, 42.2, 210);
        this.cduScreens.push({ context: screen.context, texture: screen.texture, group: cdu });
      }
      for (let row = 0; row < 3; row += 1) {
        addMesh(
          cdu,
          new THREE.BoxGeometry(0.82, 0.035, 0.02),
          new THREE.MeshBasicMaterial({ color: 0x172c37 }),
          [0, 0.48 + row * 0.15, 0.505],
        );
      }
      this.register(cdu, `cdu-${index + 1}`, 'cdu', `液冷 CDU-${index + 1}`);
      group.add(cdu);
    }

    const pipeMaterial = new THREE.MeshStandardMaterial({
      color: 0x5e8bff,
      metalness: 0.66,
      roughness: 0.28,
      emissive: new THREE.Color(0x10294d),
      emissiveIntensity: 0.5,
    });
    const returnMaterial = new THREE.MeshStandardMaterial({
      color: 0xff8c42,
      metalness: 0.56,
      roughness: 0.3,
      emissive: new THREE.Color(0x4f1e0d),
      emissiveIntensity: 0.5,
    });
    for (const z of [-2.35, 2.35]) {
      const pipe = addMesh(group, new THREE.CylinderGeometry(0.045, 0.045, 18.5, 12), pipeMaterial, [0, 2.93, z]);
      pipe.rotation.z = Math.PI / 2;
      const ret = addMesh(group, new THREE.CylinderGeometry(0.045, 0.045, 18.5, 12), returnMaterial, [0, 3.01, z + 0.13]);
      ret.rotation.z = Math.PI / 2;
    }
    for (const x of [-2.6, 2.6, -7.5, 7.5]) {
      addMesh(group, new THREE.CylinderGeometry(0.04, 0.04, 2.7, 10), pipeMaterial, [x, 1.55, -2.35]);
    }
  }

  private buildPowerDistribution(group: THREE.Group): void {
    const buswayMaterial = standardMaterial(0x60747d, { metalness: 0.85, roughness: 0.25 });
    for (const z of [-8.7, 8.7]) {
      const rail = addMesh(group, new THREE.BoxGeometry(18.5, 0.18, 0.34), buswayMaterial, [0, 3.55, z]);
      addEdges(rail, 0x94adb8, 0.35);
      for (let index = 0; index < 6; index += 1) {
        addMesh(
          group,
          new THREE.BoxGeometry(0.24, 0.3, 0.42),
          standardMaterial(0x2e454f, { metalness: 0.7, roughness: 0.32 }),
          [-7.5 + index * 3, 3.36, z],
        );
        addMesh(
          group,
          new THREE.CylinderGeometry(0.025, 0.025, 0.72, 8),
          standardMaterial(0x425a64, { metalness: 0.7, roughness: 0.3 }),
          [-7.5 + index * 3, 3.9, z],
        );
      }
      for (const x of [-9.2, 9.2]) {
        addMesh(group, new THREE.CylinderGeometry(0.035, 0.035, 2.8, 8), buswayMaterial, [x, 4.9, z]);
      }
    }
    const busway = new THREE.Group();
    for (const z of [-8.7, 8.7]) {
      const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(18.5, 0.5, 0.5),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hitbox.position.set(0, 3.6, z);
      busway.add(hitbox);
    }
    group.add(busway);
    this.register(busway, 'busway', 'busway', '智能母线槽');
  }

  private buildNetwork(): void {
    const group = this.layerGroups.network;
    const spinePositions = [-4.5, -1.5, 1.5, 4.5];
    const spines: THREE.Vector3[] = [];
    spinePositions.forEach((x, index) => {
      const spine = new THREE.Group();
      spine.position.set(x, 0.2, -9.65);
      const body = addMesh(
        spine,
        new THREE.BoxGeometry(1.05, 2.1, 0.82),
        standardMaterial(0x101f29, { metalness: 0.65, roughness: 0.32 }),
        [0, 1.05, 0],
      );
      addEdges(body, 0x5d8dff, 0.45);
      const portMaterial = new THREE.MeshStandardMaterial({
        color: 0x86a9ff,
        emissive: new THREE.Color(0x4b74ff),
        emissiveIntensity: 1.1,
      });
      for (let port = 0; port < 10; port += 1) {
        addMesh(
          spine,
          new THREE.BoxGeometry(0.09, 0.045, 0.02),
          portMaterial,
          [-0.34 + (port % 5) * 0.17, 1.44 - Math.floor(port / 5) * 0.17, 0.42],
        );
      }
      addMesh(
        spine,
        new THREE.BoxGeometry(0.72, 0.1, 0.02),
        new THREE.MeshBasicMaterial({ color: 0x9b8cff }),
        [0, 2.13, 0.42],
      );
      this.register(spine, `spine-${index + 1}`, 'spine', `Spine-${index + 1} 核心交换机`);
      group.add(spine);
      spines.push(new THREE.Vector3(x, 2.25, -9.65));
    });

    const leafAnchors: THREE.Vector3[] = [];
    const leafSides = [
      { x: -9.8, rot: -Math.PI / 2 },
      { x: 9.8, rot: Math.PI / 2 },
    ];
    for (const row of ROWS) {
      for (const [sideIndex, side] of leafSides.entries()) {
        const leaf = new THREE.Group();
        leaf.position.set(side.x, 2.75, row.z);
        leaf.rotation.y = side.rot;
        const body = addMesh(
          leaf,
          new THREE.BoxGeometry(0.82, 0.15, 0.62),
          standardMaterial(0x14232c, { metalness: 0.65, roughness: 0.3 }),
          [0, 0, 0],
        );
        addEdges(body, 0x44cee9, 0.5);
        const ports = new THREE.MeshStandardMaterial({
          color: 0x49e4ff,
          emissive: new THREE.Color(0x37dfff),
          emissiveIntensity: 0.9,
        });
        for (let port = 0; port < 8; port += 1) {
          addMesh(
            leaf,
            new THREE.BoxGeometry(0.035, 0.045, 0.02),
            ports,
            [-0.3 + port * 0.085, 0.015, 0.32],
          );
        }
        this.register(
          leaf,
          `leaf-${row.id}-${sideIndex + 1}`,
          'leaf',
          `Leaf-${row.id}${sideIndex + 1} 接入交换机`,
        );
        group.add(leaf);
        leafAnchors.push(new THREE.Vector3(side.x, 2.75, row.z));
      }
    }

    const fiberMaterial = new THREE.MeshBasicMaterial({
      color: 0x44d7ff,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const busMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb05a,
      transparent: true,
      opacity: 0.33,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const [leafIndex, leaf] of leafAnchors.entries()) {
      const spine = spines[leafIndex % spines.length];
      const curve = new THREE.CatmullRomCurve3([
        leaf.clone(),
        new THREE.Vector3((leaf.x + spine.x) / 2, 4.6, -2.2 - (leafIndex % 3) * 0.5),
        new THREE.Vector3(spine.x, 4.3, -7.8),
        spine.clone(),
      ]);
      this.addFiber(curve, fiberMaterial, group, 2, 0.24);
      const alternateSpine = spines[(leafIndex + 2) % spines.length];
      this.addFiber(
        new THREE.CatmullRomCurve3([
          leaf.clone(),
          new THREE.Vector3(leaf.x * 0.55, 4.9, -3.5),
          new THREE.Vector3(alternateSpine.x * 0.5, 4.4, -7.6),
          alternateSpine.clone(),
        ]),
        fiberMaterial,
        group,
        1,
        0.18,
      );
    }

    for (const row of ROWS) {
      const points: THREE.Vector3[] = [];
      for (let index = 0; index < 6; index += 1) {
        const x = -7.5 + index * 3;
        points.push(new THREE.Vector3(x, 2.48 + (index % 2) * 0.12, row.z));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      this.addFiber(curve, busMaterial, group, 3, 0.2);
    }

    const busTop = new THREE.Mesh(
      new THREE.TorusGeometry(6.8, 0.025, 5, 80, Math.PI),
      busMaterial,
    );
    busTop.position.set(0, 1.4, 0);
    busTop.rotation.x = Math.PI / 2;
    busTop.rotation.z = 0;
    group.add(busTop);
  }

  private addFiber(
    curve: THREE.CatmullRomCurve3,
    material: THREE.MeshBasicMaterial,
    group: THREE.Group,
    particles: number,
    speed: number,
  ): void {
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 44, 0.018, 5, false), material);
    group.add(tube);
    const dotGeometry = new THREE.SphereGeometry(0.055, 6, 6);
    for (let index = 0; index < particles; index += 1) {
      const mesh = new THREE.Mesh(dotGeometry, material.clone());
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
      group.add(mesh);
      this.flows.push({
        mesh,
        curve,
        offset: (index / particles + Math.random() * 0.16) % 1,
        speed,
      });
    }
  }

  private addLabels(): void {
    this.addLabel('campus', '光伏屋顶', '760 kWp · 2.1 MW 园区负荷', new THREE.Vector3(0, 8.1, 0), 'pv');
    this.addLabel('campus', '储能系统', '1.2 MWh · 削峰填谷', new THREE.Vector3(-19.2, 3.1, 4.6), 'bess');
    this.addLabel('campus', '柴油发电机', '2 × 1000 kW · 热备', new THREE.Vector3(18.6, 3.4, 8.2), 'diesel');
    this.addLabel('campus', '主进线柜', '10 kV · 双路市电', new THREE.Vector3(18.4, 2.9, -3.2), 'switchgear');
    this.addLabel('hall', '冷通道 AB', '封闭冷通道 · 22.6°C', new THREE.Vector3(-9.5, 1.5, -5.4), 'cold');
    this.addLabel('hall', '冷通道 CD', '封闭冷通道 · 22.5°C', new THREE.Vector3(9.5, 1.5, 5.4), 'cold');
    this.addLabel('hall', '热通道', '回风汇集 · 33.6°C', new THREE.Vector3(-9.7, 1.4, 0), 'hot');
    this.addLabel('hall', '液冷 CDU', '供液 / 回液 · 41.8°C', new THREE.Vector3(2.6, 2.9, -0.2), 'cdu');
    this.addLabel('hall', '母线槽', '智能小母线 · 800A', new THREE.Vector3(7.3, 4.35, 8.7), 'busway');
    this.addLabel('network', 'SPINE-LEAF', '800G · 4 Spine / 8 Leaf', new THREE.Vector3(0, 3.8, -9.65), 'spine');
    this.addLabel('network', 'UnifiedBus', '跨柜无损互联', new THREE.Vector3(0, 1.0, 0.3), 'bus');
  }

  private addLabel(
    layer: SceneLayer,
    text: string,
    sub: string,
    anchor: THREE.Vector3,
    key?: string,
  ): void {
    const element = document.createElement('div');
    element.className = 'scene-label';
    const title = document.createElement('b');
    title.innerHTML = `<i></i>${text}`;
    const subElement = document.createElement('small');
    subElement.textContent = sub;
    element.append(title, subElement);
    this.labelContainer.appendChild(element);
    this.labels.push({ element, subElement, anchor, layer, key });
  }

  private register(group: THREE.Group, id: string, kind: string, name: string): void {
    group.userData.deviceId = id;
    group.userData.deviceKind = kind;
    group.userData.deviceName = name;
    this.deviceGroups.set(id, group);
    this.pickables.push(group);
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerDown = true;
    this.pointerMoved = false;
    this.dragStart = { x: event.clientX, y: event.clientY };
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pointerDown) {
      const now = performance.now();
      if (now - this.lastHoverAt > 90) {
        this.lastHoverAt = now;
        this.hoverAt(event.clientX, event.clientY);
      }
      return;
    }
    const dx = event.clientX - this.dragStart.x;
    const dy = event.clientY - this.dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) this.pointerMoved = true;
    if (this.mode === 'walk' && this.pointerMoved) {
      this.walkYaw -= event.movementX * 0.0025;
      this.walkPitch = clamp(this.walkPitch - event.movementY * 0.0022, -1.2, 0.9);
      this.applyWalkRotation();
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    if (this.pointerMoved) return;
    this.pickAt(event.clientX, event.clientY);
  };

  private onPointerLeave = (): void => {
    this.pointerDown = false;
    this.callbacks.onHover?.(null);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (event.key === 'Escape' && this.mode === 'walk') {
      this.toggleWalk();
      return;
    }
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private hoverAt(clientX: number, clientY: number): void {
    const hit = this.raycastAt(clientX, clientY);
    const canvas = this.renderer.domElement;
    if (hit) {
      canvas.style.cursor = this.mode === 'walk' ? 'crosshair' : 'pointer';
      this.callbacks.onHover?.(hit.device);
    } else {
      canvas.style.cursor = this.mode === 'walk' ? 'crosshair' : 'grab';
      this.callbacks.onHover?.(null);
    }
  }

  private pickAt(clientX: number, clientY: number): void {
    const hit = this.raycastAt(clientX, clientY);
    if (!hit) {
      this.callbacks.onClearSelection?.();
      return;
    }
    this.selectedId = hit.device.id;
    this.setSelectionOutline(hit.group);
    const rect = this.host.getBoundingClientRect();
    this.callbacks.onSelect?.(hit.device, {
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  }

  private raycastAt(
    clientX: number,
    clientY: number,
  ): { device: SceneDevice; group: THREE.Group } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(this.pickables, true);
    for (const intersection of intersections) {
      let object: THREE.Object3D | null = intersection.object;
      while (object) {
        if (object.userData.deviceId) {
          return {
            device: {
              id: String(object.userData.deviceId),
              kind: String(object.userData.deviceKind),
              name: String(object.userData.deviceName),
            },
            group: object as THREE.Group,
          };
        }
        object = object.parent;
      }
    }
    return null;
  }

  private setSelectionOutline(group: THREE.Group): void {
    if (this.selectionOutline) {
      this.scene.remove(this.selectionOutline);
      this.selectionOutline.geometry.dispose();
      (this.selectionOutline.material as THREE.Material).dispose();
    }
    this.selectionOutline = new THREE.BoxHelper(group, 0x74f0ff);
    const material = this.selectionOutline.material as THREE.LineBasicMaterial;
    material.transparent = true;
    material.opacity = 0.85;
    material.depthTest = false;
    this.scene.add(this.selectionOutline);
  }

  applySnapshot(snapshot: EngineSnapshot): void {
    this.latestSnapshot = snapshot;
    const rackMap = new Map<string, RackState>(snapshot.compute.racks.map((rack) => [rack.id, rack]));
    for (const [id, visual] of this.rackVisuals) {
      const rack = rackMap.get(id);
      if (!rack) continue;
      const utilization = clamp(rack.utilization / 100, 0, 1);
      const fault = rack.status === 'fault';
      const hot = this.thermalIntensity > 0.75 && utilization > 0.78;
      const color = fault ? COLORS.red : hot ? COLORS.amber : COLORS.cyan;
      visual.frontMaterial.emissive.setHex(fault ? COLORS.red : hot ? 0x6d4f0f : 0x073340);
      visual.frontMaterial.emissiveIntensity = fault ? 1.45 : 0.42 + utilization * 0.9;
      visual.ledMaterial.color.setHex(color);
      visual.ledMaterial.emissive.setHex(color);
      visual.ledMaterial.emissiveIntensity = fault ? 2.1 : 0.55 + utilization * 1.4;
      visual.bodyMaterial.emissive.setHex(fault ? 0x24050b : 0x000000);
      visual.bodyMaterial.emissiveIntensity = fault ? 0.9 : 0;
      visual.outline.visible = this.selectedId === id || fault;
      (visual.outline.material as THREE.LineBasicMaterial).color.setHex(
        fault ? COLORS.red : 0x51e9ff,
      );
      visual.faultRing.visible = fault;
      visual.beacon.visible = fault;
      visual.faultBeam.visible = fault;
      visual.faultLabel.visible = fault;
      visual.faultLight.intensity = fault ? 2.4 : 0;
      visual.labelMaterial.color.setHex(fault ? 0xff8095 : 0xffffff);
      visual.fanSpeed = 0.55 + utilization * 1.9;
    }

    const solarFactor = clamp(snapshot.energy.pvKw / CAMPUS.pvRatedKw, 0, 1);
    for (const material of this.pvMaterials) {
      material.emissiveIntensity = 0.18 + solarFactor * 1.1;
    }
    const soc = snapshot.energy.batterySocPct / 100;
    for (const material of this.bessLeds) {
      material.emissiveIntensity = 0.35 + soc * 0.95;
      material.color.setHex(soc < 0.2 ? COLORS.amber : 0x54e6b1);
    }
    this.networkIntensity = 0.35 + clamp(snapshot.compute.utilization / 100, 0, 1) * 1.7;
    this.thermalIntensity = clamp((snapshot.thermal.hotAisleC - 29) / 12, 0, 1);

    const supply = snapshot.thermal.liquidSupplyC;
    const returnC = snapshot.thermal.liquidReturnC;
    const liquidLoad = snapshot.energy.liquidCoolingKw;
    for (const screen of this.cduScreens) {
      drawCduScreen(screen.context, screen.texture, supply, returnC, liquidLoad);
    }

    for (const label of this.labels) {
      if (label.key === 'cold') {
        label.subElement.textContent = `封闭冷通道 · ${snapshot.thermal.coldAisleC.toFixed(1)}°C`;
      } else if (label.key === 'hot') {
        label.subElement.textContent = `回风汇集 · ${snapshot.thermal.hotAisleC.toFixed(1)}°C`;
      } else if (label.key === 'cdu') {
        label.subElement.textContent = `供液 ${supply.toFixed(1)}°C / 回液 ${returnC.toFixed(1)}°C`;
      } else if (label.key === 'pv') {
        label.subElement.textContent = `实时 ${snapshot.energy.pvKw.toFixed(0)} kW · 消纳 ${snapshot.energy.renewableSharePct.toFixed(0)}%`;
      } else if (label.key === 'bess') {
        label.subElement.textContent = `SOC ${snapshot.energy.batterySocPct.toFixed(0)}% · 削峰填谷`;
      } else if (label.key === 'spine') {
        label.subElement.textContent = `800G · 利用率 ${snapshot.compute.utilization.toFixed(0)}%`;
      }
    }
  }

  setLayer(layer: SceneLayer, visible: boolean): void {
    this.layerVisible[layer] = visible;
    this.layerGroups[layer].visible = visible;
  }

  isLayerVisible(layer: SceneLayer): boolean {
    return this.layerVisible[layer];
  }

  toggleWalk(): SceneMode {
    if (this.mode === 'orbit') {
      this.savedOrbit.position.copy(this.camera.position);
      this.savedOrbit.target.copy(this.controls.target);
      this.mode = 'walk';
      this.controls.enabled = false;
      this.camera.position.set(-9.1, 1.7, 5.4);
      this.walkYaw = -Math.PI / 2;
      this.walkPitch = -0.05;
      this.applyWalkRotation();
      this.host.classList.add('walk-mode');
      this.host.closest('.viewport-card')?.classList.add('walking');
      this.renderer.domElement.style.cursor = 'crosshair';
    } else {
      this.mode = 'orbit';
      this.keys.clear();
      this.controls.enabled = true;
      this.camera.position.copy(this.savedOrbit.position);
      this.controls.target.copy(this.savedOrbit.target);
      this.controls.update();
      this.host.classList.remove('walk-mode');
      this.host.closest('.viewport-card')?.classList.remove('walking');
      this.renderer.domElement.style.cursor = 'grab';
    }
    this.callbacks.onModeChange?.(this.mode);
    return this.mode;
  }

  getMode(): SceneMode {
    return this.mode;
  }

  resetCamera(): void {
    if (this.mode === 'walk') {
      this.mode = 'orbit';
      this.controls.enabled = true;
      this.host.classList.remove('walk-mode');
      this.host.closest('.viewport-card')?.classList.remove('walking');
      this.callbacks.onModeChange?.(this.mode);
    }
    this.camera.position.set(22, 13, 28);
    this.controls.target.set(0, 1.7, 0);
    this.controls.update();
  }

  focusDevice(id: string): void {
    const group = this.deviceGroups.get(id);
    if (!group) return;
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    if (this.mode === 'walk') {
      this.camera.position.set(center.x, 1.7, center.z + 5);
      this.walkYaw = Math.PI;
      this.walkPitch = -0.08;
      this.applyWalkRotation();
      return;
    }
    this.controls.target.copy(center);
    const direction = new THREE.Vector3(1, 0.65, 1).normalize();
    this.camera.position.copy(center).add(direction.multiplyScalar(11));
    this.controls.update();
  }

  private applyWalkRotation(): void {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
  }

  private updateWalk(delta: number): void {
    if (this.mode !== 'walk') return;
    const direction = new THREE.Vector3();
    const forward = new THREE.Vector3(-Math.sin(this.walkYaw), 0, -Math.cos(this.walkYaw));
    const right = new THREE.Vector3(Math.cos(this.walkYaw), 0, -Math.sin(this.walkYaw));
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) direction.add(forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) direction.sub(forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) direction.add(right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) direction.sub(right);
    if (direction.lengthSq() > 0) {
      direction.normalize();
      const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 9 : 4.6;
      this.camera.position.addScaledVector(direction, speed * delta);
      this.camera.position.x = clamp(this.camera.position.x, -24, 24);
      this.camera.position.z = clamp(this.camera.position.z, -20, 20);
      this.camera.position.y = 1.7;
    }
  }

  private updateLabels(): void {
    const rect = this.host.getBoundingClientRect();
    for (const label of this.labels) {
      if (!this.layerVisible[label.layer]) {
        label.element.classList.remove('visible');
        continue;
      }
      const projected = label.anchor.clone().project(this.camera);
      const visible =
        projected.z < 1 &&
        projected.z > -1 &&
        projected.x > -1.12 &&
        projected.x < 1.12 &&
        projected.y > -1.12 &&
        projected.y < 1.12;
      if (!visible) {
        label.element.classList.remove('visible');
        continue;
      }
      const x = (projected.x * 0.5 + 0.5) * rect.width;
      const y = (-projected.y * 0.5 + 0.5) * rect.height;
      label.element.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      label.element.classList.add('visible');
    }
  }

  private animate = (timestamp?: number): void => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);
    this.timer.update(timestamp);
    const delta = Math.min(0.05, this.timer.getDelta());
    const elapsed = this.timer.getElapsed();

    if (this.mode === 'orbit') this.controls.update();
    else {
      this.updateWalk(delta);
      this.applyWalkRotation();
    }

    for (const visual of this.rackVisuals.values()) {
      if (visual.faultRing.visible) {
        const pulse = 0.72 + Math.sin(elapsed * 4.2) * 0.24;
        (visual.faultRing.material as THREE.MeshBasicMaterial).opacity = pulse;
        visual.faultRing.scale.setScalar(1 + Math.sin(elapsed * 3.4) * 0.07);
        visual.beacon.scale.setScalar(0.85 + Math.sin(elapsed * 5) * 0.25);
        (visual.faultBeam.material as THREE.MeshBasicMaterial).opacity =
          0.3 + (Math.sin(elapsed * 3.2) * 0.5 + 0.5) * 0.38;
        visual.faultLabel.position.y = 3.25 + Math.sin(elapsed * 2.4) * 0.06;
      }
      if (visual.outline.visible) {
        (visual.outline.material as THREE.LineBasicMaterial).opacity =
          0.55 + Math.sin(elapsed * 2.2) * 0.2;
      }
    }

    for (const fan of this.fans) {
      fan.rotation.z += delta * (2.5 + this.thermalIntensity * 8);
    }

    for (const flow of this.flows) {
      const nextOffset = flow.offset + delta * flow.speed * this.networkIntensity;
      flow.offset = Number.isFinite(nextOffset) ? (nextOffset + 1) % 1 : 0;
      try {
        const position = flow.curve.getPoint(flow.offset);
        if (!position) continue;
        flow.mesh.position.copy(position);
        const material = flow.mesh.material as THREE.MeshBasicMaterial;
        material.opacity = 0.45 + Math.sin(elapsed * 3 + flow.offset * 8) * 0.35;
      } catch {
        // A malformed link must never take down the render loop.
        flow.offset = 0;
        flow.mesh.visible = false;
      }
    }

    if (this.selectionOutline) this.selectionOutline.update();
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  clearSelection(): void {
    this.selectedId = null;
    if (this.selectionOutline) {
      this.scene.remove(this.selectionOutline);
      this.selectionOutline.geometry.dispose();
      (this.selectionOutline.material as THREE.Material).dispose();
      this.selectionOutline = null;
    }
    for (const visual of this.rackVisuals.values()) {
      visual.outline.visible = visual.faultRing.visible;
    }
  }

  getLatestSnapshot(): EngineSnapshot | null {
    return this.latestSnapshot;
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.timer.dispose();
    this.renderer.dispose();
    this.labelContainer.remove();
    this.renderer.domElement.remove();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
