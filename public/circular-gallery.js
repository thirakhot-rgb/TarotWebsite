// Circular Gallery (พอร์ตจาก circular-gallery-2.tsx เป็น vanilla JS เพราะโปรเจกต์นี้ไม่ได้ใช้ React/TS/Tailwind)
// ใช้ ogl จาก node_modules (server เปิด /vendor/ogl ให้) และเพิ่มความสามารถ "คลิกเลือกใบไพ่"
import { Camera, Mesh, Plane, Program, Renderer, Texture, Transform } from "/vendor/ogl/index.js";

const lerp = (a, b, t) => a + (a === b ? 0 : (b - a) * t);

// วาดหลังไพ่ด้วย canvas (ไม่ต้องใช้ไฟล์รูป)
function makeBackTexture(gl) {
  const w = 512, h = 886;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#2c2150";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#3a2a6b";
  g.lineWidth = 14;
  for (let i = -h; i < w + h; i += 36) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
  }
  g.strokeStyle = "#e0b769";
  g.lineWidth = 10;
  g.strokeRect(40, 70, w - 80, h - 140);
  g.lineWidth = 4;
  g.strokeRect(62, 92, w - 124, h - 184);
  g.fillStyle = "#e0b769";
  g.beginPath(); g.arc(w / 2, h / 2, 46, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#2c2150";
  g.beginPath(); g.arc(w / 2 + 16, h / 2, 40, 0, Math.PI * 2); g.fill();
  const texture = new Texture(gl, { generateMipmaps: true });
  texture.image = c;
  return { texture, width: w, height: h };
}

const VERTEX = /* glsl */ `
  precision highp float;
  attribute vec3 position;
  attribute vec2 uv;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uTime;
  uniform float uSpeed;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.z = (sin(p.x * 4.0 + uTime) * 1.5 + cos(p.y * 2.0 + uTime) * 1.5) * (0.1 + uSpeed * 0.5);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec2 uImageSizes;
  uniform vec2 uPlaneSizes;
  uniform sampler2D tMap;
  uniform float uBorderRadius;
  uniform float uPicked;
  varying vec2 vUv;

  float roundedBoxSDF(vec2 p, vec2 b, float r) {
    vec2 d = abs(p) - b;
    return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - r;
  }

  void main() {
    vec2 ratio = vec2(
      min((uPlaneSizes.x / uPlaneSizes.y) / (uImageSizes.x / uImageSizes.y), 1.0),
      min((uPlaneSizes.y / uPlaneSizes.x) / (uImageSizes.y / uImageSizes.x), 1.0)
    );
    vec2 uv = vec2(
      vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
      vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
    );
    vec4 color = texture2D(tMap, uv);
    float d = roundedBoxSDF(vUv - 0.5, vec2(0.5 - uBorderRadius), uBorderRadius);
    float alpha = 1.0 - smoothstep(-0.002, 0.002, d);
    // ใบที่ถูกเลือกแล้วจะจางลง
    float dim = mix(1.0, 0.28, uPicked);
    gl_FragColor = vec4(color.rgb * dim, alpha * mix(1.0, 0.55, uPicked));
  }
`;

class Media {
  constructor({ geometry, gl, scene, index, length, screen, viewport, bend, borderRadius, back }) {
    this.gl = gl;
    this.index = index;
    this.length = length;
    this.screen = screen;
    this.viewport = viewport;
    this.bend = bend;
    this.extra = 0;
    this.picked = 0; // 0 | 1 (ค่อย ๆ เปลี่ยนเพื่อให้ fade นุ่ม)
    this.pickedTarget = 0;

    this.program = new Program(gl, {
      depthTest: false,
      depthWrite: false,
      vertex: VERTEX,
      fragment: FRAGMENT,
      uniforms: {
        tMap: { value: back.texture },
        uPlaneSizes: { value: [0, 0] },
        uImageSizes: { value: [back.width, back.height] },
        uSpeed: { value: 0 },
        uTime: { value: 100 * Math.random() },
        uBorderRadius: { value: borderRadius },
        uPicked: { value: 0 }
      },
      transparent: true
    });
    this.plane = new Mesh(gl, { geometry, program: this.program });
    this.plane.setParent(scene);
    this.onResize();
  }

  update(scroll, direction) {
    this.plane.position.x = this.x - scroll.current - this.extra;

    const x = this.plane.position.x;
    const H = this.viewport.width / 2;
    if (this.bend === 0) {
      this.plane.position.y = 0;
      this.plane.rotation.z = 0;
    } else {
      const B = Math.abs(this.bend);
      const R = (H * H + B * B) / (2 * B);
      const ex = Math.min(Math.abs(x), H);
      const arc = R - Math.sqrt(R * R - ex * ex);
      const dir = this.bend > 0 ? -1 : 1;
      this.plane.position.y = dir * arc;
      this.plane.rotation.z = dir * Math.sign(x) * Math.asin(ex / R);
    }

    this.program.uniforms.uTime.value += 0.04;
    this.program.uniforms.uSpeed.value = scroll.current - scroll.last;
    this.picked = lerp(this.picked, this.pickedTarget, 0.12);
    this.program.uniforms.uPicked.value = this.picked;

    const half = this.plane.scale.x / 2;
    const vHalf = this.viewport.width / 2;
    const isBefore = this.plane.position.x + half < -vHalf;
    const isAfter = this.plane.position.x - half > vHalf;
    if (direction === "right" && isBefore) this.extra -= this.widthTotal;
    if (direction === "left" && isAfter) this.extra += this.widthTotal;
  }

  // ทดสอบว่าจุด (wx, wy) ในพิกัดโลกอยู่ในใบไพ่นี้ไหม (คิดการหมุนตามความโค้งแล้ว)
  contains(wx, wy) {
    const dx = wx - this.plane.position.x;
    const dy = wy - this.plane.position.y;
    const r = this.plane.rotation.z;
    const lx = dx * Math.cos(r) + dy * Math.sin(r);
    const ly = -dx * Math.sin(r) + dy * Math.cos(r);
    return Math.abs(lx) <= this.plane.scale.x / 2 && Math.abs(ly) <= this.plane.scale.y / 2;
  }

  onResize({ screen, viewport } = {}) {
    if (screen) this.screen = screen;
    if (viewport) this.viewport = viewport;
    // สัดส่วนใบไพ่ทาโร่ ~ 340:588
    const scale = this.screen.height / 1500;
    this.plane.scale.y = (this.viewport.height * (930 * scale)) / this.screen.height;
    this.plane.scale.x = (this.viewport.width * (537 * scale)) / this.screen.width;
    this.program.uniforms.uPlaneSizes.value = [this.plane.scale.x, this.plane.scale.y];
    this.width = this.plane.scale.x + 2; // padding
    this.widthTotal = this.width * this.length;
    this.x = this.width * this.index;
  }
}

/**
 * สร้างแกลเลอรีวงกลมของหลังไพ่
 * @param {HTMLElement} container
 * @param {{count?:number, bend?:number, borderRadius?:number, scrollSpeed?:number, scrollEase?:number,
 *          onPick?:(deckIndex:number)=>void}} opts
 */
export function createCircularGallery(container, opts = {}) {
  const { count = 78, bend = 3, borderRadius = 0.05, scrollSpeed = 2, scrollEase = 0.05, onPick } = opts;

  const renderer = new Renderer({ alpha: true, antialias: true, dpr: Math.min(window.devicePixelRatio || 1, 2) });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);
  container.appendChild(gl.canvas);

  const camera = new Camera(gl);
  camera.fov = 45;
  camera.position.z = 20;
  const scene = new Transform();
  const geometry = new Plane(gl, { heightSegments: 12, widthSegments: 24 });
  const back = makeBackTexture(gl);

  let screen, viewport;
  const measure = () => {
    screen = { width: container.clientWidth || 1, height: container.clientHeight || 1 };
    renderer.setSize(screen.width, screen.height);
    camera.perspective({ aspect: screen.width / screen.height });
    const fov = (camera.fov * Math.PI) / 180;
    const h = 2 * Math.tan(fov / 2) * camera.position.z;
    viewport = { width: h * camera.aspect, height: h };
  };
  measure();

  // ทำสำเนาสองชุดเพื่อให้วนต่อเนื่อง (เหมือน component เดิม)
  const total = count * 2;
  const medias = Array.from({ length: total }, (_, index) =>
    new Media({ geometry, gl, scene, index, length: total, screen, viewport, bend, borderRadius, back })
  );

  const scroll = { ease: scrollEase, current: 0, target: 0, last: 0 };
  let raf = 0;
  let destroyed = false;

  const snap = () => {
    const w = medias[0].width;
    const item = w * Math.round(Math.abs(scroll.target) / w);
    scroll.target = scroll.target < 0 ? -item : item;
  };
  let snapTimer;
  const snapSoon = () => { clearTimeout(snapTimer); snapTimer = setTimeout(snap, 200); };

  const frame = () => {
    if (destroyed) return;
    scroll.current = lerp(scroll.current, scroll.target, scroll.ease);
    const direction = scroll.current > scroll.last ? "right" : "left";
    medias.forEach((m) => m.update(scroll, direction));
    renderer.render({ scene, camera });
    scroll.last = scroll.current;
    raf = requestAnimationFrame(frame);
  };
  frame();

  // ---- หาใบไพ่ที่อยู่ใต้ตำแหน่งเมาส์ ----
  const hitTest = (clientX, clientY) => {
    const rect = container.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const wx = (nx * viewport.width) / 2; // ที่ระนาบ z = 0 ขนาด viewport ตรงกับหน้าจอพอดี
    const wy = (ny * viewport.height) / 2;
    // ใบที่อยู่ใกล้กลางจอก่อน
    let best = null, bestDist = Infinity;
    for (const m of medias) {
      if (m.contains(wx, wy)) {
        const d = Math.abs(m.plane.position.x - wx);
        if (d < bestDist) { best = m; bestDist = d; }
      }
    }
    return best;
  };

  // ---- การควบคุม: ลาก / ล้อเมาส์ / คีย์บอร์ด / คลิก ----
  let down = null;
  const onPointerDown = (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), base: scroll.current, moved: false };
    container.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!down) {
      container.style.cursor = hitTest(e.clientX, e.clientY) ? "pointer" : "grab";
      return;
    }
    const dx = down.x - e.clientX;
    if (Math.abs(dx) > 6 || Math.abs(down.y - e.clientY) > 6) down.moved = true;
    scroll.target = down.base + dx * (scrollSpeed * 0.025);
  };
  const onPointerUp = (e) => {
    if (!down) return;
    const wasClick = !down.moved && performance.now() - down.t < 600;
    down = null;
    if (wasClick) {
      const m = hitTest(e.clientX, e.clientY);
      if (m) onPick?.(m.index % count);
    } else {
      snap();
    }
  };
  const onWheel = (e) => {
    e.preventDefault();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    scroll.target += (delta > 0 ? scrollSpeed : -scrollSpeed) * 0.2;
    snapSoon();
  };
  const onKey = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); api.next(); }
    if (e.key === "ArrowLeft") { e.preventDefault(); api.prev(); }
  };
  const onResize = () => {
    measure();
    medias.forEach((m) => m.onResize({ screen, viewport }));
  };

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", () => { down = null; });
  container.addEventListener("wheel", onWheel, { passive: false });
  container.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);

  const api = {
    next() { scroll.target += medias[0].width; },
    prev() { scroll.target -= medias[0].width; },
    /** ระบุเซ็ตของ index ไพ่ (0..count-1) ที่ถูกเลือกแล้ว เพื่อทำให้ใบนั้นจางลง */
    setPicked(set) {
      medias.forEach((m) => { m.pickedTarget = set.has(m.index % count) ? 1 : 0; });
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(snapTimer);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      gl.canvas.parentNode?.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  };
  return api;
}
