"use client";

// 馆藏星系（Three.js）——首页开场天窗：太阳系式布局，中央太阳，
// 每颗行星 = 媒体库里一部真实作品（橙=电影 / 蓝=剧集 / 青=动漫 / 绿=其他），
// 行星分布在多条不同倾角平面的轨道上公转（内圈快外圈慢），轨道画淡环线，相机微俯视。
// hover 行星时全系停转、那颗放大发亮，点击直达详情/播放，整个星系可拖拽旋转。
// 星星走自定义 ShaderMaterial：三种形态（柔光圆点 / 凹四角闪钻 / 六芒细星）打在一张图集上，
// 闪钻与六芒会缓慢自转；逐星随机大小与闪烁相位；底下再铺一层细星尘反向慢转，做出视差纵深。
// 日夜双模式：夜间 Additive 发光星空，日间白昼底 + Normal 混合深色星，跟随全站主题渐变切换。
// children 叠加在星空上（问候/头条浮卡等）；带 data-gx-ui 的元素内不触发星星交互。
// 性能：进视口才懒加载 three，离开视口/切后台暂停，DPR≤1.5，reduced-motion 不自转，
// 无 WebGL / three 加载失败时容器与 children 保留，只是没有星星（天窗不塌）。
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface GalaxyItem { title: string; href: string; type: string }

const TYPE_COLOR: Record<string, [number, number, number]> = {
    movie: [0.94, 0.47, 0.29],   // 品牌橙
    series: [0.24, 0.62, 0.95],  // 蓝
    anime: [0.0, 0.78, 0.75],    // 青
    travel: [0.35, 0.78, 0.45],  // 绿
};

const inUi = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("[data-gx-ui]");

// 图集 384×128 三格：①柔光圆点 ②凹四角闪钻（动漫 sparkle，会缓慢自转）③六芒细星。
// 图案半径 ≤52px、格边留 12px 透明：fragment 里旋转采样时越出格界也只会摸到透明边。
function makeAtlas(): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = 384; cv.height = 128;
    const c = cv.getContext("2d")!;

    // ① 柔光圆点
    let g = c.createRadialGradient(64, 64, 0, 64, 64, 50);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.7)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(4, 4, 120, 120);

    // ② 凹四角闪钻：四条二次贝塞尔往中心收，出尖锐的钻石闪（✦），叠中心亮核 + 淡光晕
    c.save(); c.translate(192, 64);
    g = c.createRadialGradient(0, 0, 0, 0, 0, 50);
    g.addColorStop(0, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, 50, 0, Math.PI * 2); c.fill();
    const spark = (r: number, w: number, alpha: number) => {
        c.fillStyle = `rgba(255,255,255,${alpha})`;
        c.beginPath();
        c.moveTo(0, -r);
        c.quadraticCurveTo(w, -w, r, 0);
        c.quadraticCurveTo(w, w, 0, r);
        c.quadraticCurveTo(-w, w, -r, 0);
        c.quadraticCurveTo(-w, -w, 0, -r);
        c.fill();
    };
    spark(52, 7, 0.95);
    c.rotate(Math.PI / 4); spark(26, 4, 0.8); c.rotate(-Math.PI / 4);
    g = c.createRadialGradient(0, 0, 0, 0, 0, 11);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, 11, 0, Math.PI * 2); c.fill();
    c.restore();

    // ③ 六芒细星：三条细长光芒互转 60°，中心亮核
    c.save(); c.translate(320, 64);
    const rayN = (len: number, w: number) => {
        const gg = c.createLinearGradient(0, -len, 0, len);
        gg.addColorStop(0, "rgba(255,255,255,0)");
        gg.addColorStop(0.5, "rgba(255,255,255,0.9)");
        gg.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = gg;
        c.beginPath(); c.moveTo(0, -len); c.quadraticCurveTo(w, 0, 0, len); c.quadraticCurveTo(-w, 0, 0, -len); c.fill();
    };
    for (let k = 0; k < 3; k++) { rayN(50, 5); c.rotate(Math.PI / 3); }
    g = c.createRadialGradient(0, 0, 0, 0, 0, 10);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, 10, 0, Math.PI * 2); c.fill();
    c.restore();

    return cv;
}

const STAR_VERT = `
attribute float aSize; attribute float aPhase; attribute float aTex; attribute float aIdx; attribute float aSpin;
uniform float uT; uniform float uHover; uniform float uPx;
varying vec3 vColor; varying float vTex; varying float vGlow; varying float vRot;
void main(){
  vColor = color; vTex = aTex;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw  = 0.8 + 0.3 * sin(uT * 1.7 + aPhase);          // 逐星错相闪烁
  float hov = abs(aIdx - uHover) < 0.5 ? 1.9 : 1.0;        // hover 那颗放大
  vGlow = hov > 1.5 ? 1.0 : 0.0;
  vRot = aSpin * (uT * 0.35 + aPhase * 6.2831);            // 闪钻/六芒缓慢自转
  gl_PointSize = aSize * tw * hov * uPx * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const STAR_FRAG = `
uniform sampler2D uMap; uniform float uLight;
varying vec3 vColor; varying float vTex; varying float vGlow; varying float vRot;
void main(){
  vec2 pc = gl_PointCoord - 0.5;
  float cA = cos(vRot), sA = sin(vRot);
  pc = mat2(cA, -sA, sA, cA) * pc + 0.5;                    // 图案自转
  float inb = step(0.0, pc.x) * step(pc.x, 1.0) * step(0.0, pc.y) * step(pc.y, 1.0);
  vec2 uv = vec2(pc.x / 3.0 + vTex / 3.0, pc.y);
  vec4 t = texture2D(uMap, uv);
  // 夜：类型色加白光晕（additive 发光）；日：颜色压深一档（normal 混合印在白昼上）
  vec3 night = mix(vColor, vec3(1.0), vGlow * 0.55);
  vec3 day   = mix(vColor * 0.78, vColor * 1.05, vGlow);    // hover 提亮提饱和
  vec3 col = mix(night, day, uLight);
  float alpha = t.a * mix(1.0, 0.92, uLight) * inb;
  gl_FragColor = vec4(col * alpha, alpha);
}`;

export function LibraryGalaxy({ items, className, children }: {
    items: GalaxyItem[];
    className?: string;   // 容器高度/圆角等由调用方给
    children?: React.ReactNode;
}) {
    const router = useRouter();
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [hover, setHover] = useState<{ title: string; x: number; y: number } | null>(null);

    useEffect(() => {
        const wrap = wrapRef.current, canvas = canvasRef.current;
        if (!wrap || !canvas || items.length < 8) return;
        let disposed = false;
        let cleanup: (() => void) | null = null;

        // 进视口才初始化（three 懒加载）
        const io = new IntersectionObserver(async (entries) => {
            if (!entries.some((e) => e.isIntersecting) || cleanup) return;
            io.disconnect();
            try {
                const THREE = await import("three");
                if (disposed) return;
                const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

                const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
                renderer.setPixelRatio(dpr);
                const scene = new THREE.Scene();
                const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
                camera.position.set(0, 3.4, 10.6);              // 微俯视：轨道有透视纵深才像星系
                camera.lookAt(0, 0.1, 0);

                const atlas = new THREE.CanvasTexture(makeAtlas());

                // ── 行星系：每部作品一颗行星，分配到多条轨道上公转 ──
                // 轨道分两组倾角平面（浅盘 / 深斜面），同环同速、内圈快外圈慢（开普勒感）
                const n = items.length;
                const RINGS = Math.max(4, Math.min(8, Math.round(n / 12)));
                const ringMats: InstanceType<typeof THREE.Matrix4>[] = [];
                const ringR: number[] = [];
                const ringW: number[] = [];
                for (let k = 0; k < RINGS; k++) {
                    const hk = ((k * 2654435761 + 97) % 1000) / 1000;
                    const r = 2.1 + (k / Math.max(1, RINGS - 1)) * 4.9 + hk * 0.3;
                    // 偶数环浅盘（近水平），奇数环深斜面——"另外几个行星沿另一个平面旋转"
                    const tiltX = (k % 2 === 0 ? 0.26 : 0.92) + (hk - 0.5) * 0.18;
                    const tiltY = hk * Math.PI;
                    ringR.push(r);
                    ringW.push((0.16 / Math.pow(r / 2.4, 1.5)) * (k % 3 === 2 ? -1 : 1)); // 少数环逆行
                    ringMats.push(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tiltX, tiltY, 0)));
                }

                const pos = new Float32Array(n * 3);
                const col = new Float32Array(n * 3);
                const size = new Float32Array(n);
                const phase = new Float32Array(n);
                const texIdx = new Float32Array(n);
                const spin = new Float32Array(n);
                const idx = new Float32Array(n);
                const ringOf = new Int32Array(n);
                const ang0 = new Float32Array(n);
                const radJit = new Float32Array(n);
                for (let i = 0; i < n; i++) {
                    const h1 = ((i * 2654435761) % 1000) / 1000;      // 确定性伪随机（SSR/重渲染稳定）
                    const h2 = ((i * 1103515245 + 12345) % 1000) / 1000;
                    const k = i % RINGS;
                    ringOf[i] = k;
                    ang0[i] = (Math.floor(i / RINGS) / Math.max(1, Math.ceil(n / RINGS))) * Math.PI * 2 + h1 * 0.9;
                    radJit[i] = (h2 - 0.5) * 0.34;
                    const c = TYPE_COLOR[items[i].type] || [0.7, 0.7, 0.75];
                    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
                    // 形态分布：50% 柔光圆 / 32% 凹四角闪钻 / 18% 六芒细星
                    const kind = h2 > 0.82 ? 2 : h2 > 0.5 ? 1 : 0;
                    texIdx[i] = kind;
                    spin[i] = kind === 0 ? 0 : (h1 > 0.5 ? 1 : -1);    // 闪钻/六芒正反向慢转
                    size[i] = kind === 0 ? 0.34 + h1 * 0.2 : kind === 1 ? 0.6 + h1 * 0.32 : 0.52 + h1 * 0.26;
                    phase[i] = h2 * Math.PI * 2;
                    idx[i] = i;
                }
                // 公转位置：CPU 每帧写回 position（raycast 拾取必须用真实几何位置）
                const v3 = new THREE.Vector3();
                const updatePos = (t: number) => {
                    for (let i = 0; i < n; i++) {
                        const k = ringOf[i];
                        const th = ang0[i] + ringW[k] * t;
                        const r = ringR[k] + radJit[i];
                        v3.set(Math.cos(th) * r, 0, Math.sin(th) * r).applyMatrix4(ringMats[k]);
                        pos[i * 3] = v3.x; pos[i * 3 + 1] = v3.y; pos[i * 3 + 2] = v3.z;
                    }
                };
                updatePos(0);
                const geo = new THREE.BufferGeometry();
                geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
                geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
                geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
                geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
                geo.setAttribute("aTex", new THREE.BufferAttribute(texIdx, 1));
                geo.setAttribute("aSpin", new THREE.BufferAttribute(spin, 1));
                geo.setAttribute("aIdx", new THREE.BufferAttribute(idx, 1));
                const isLight = () => !document.documentElement.classList.contains("dark");
                let light = isLight() ? 1 : 0, lightT = light;
                const mat = new THREE.ShaderMaterial({
                    uniforms: { uT: { value: 0 }, uHover: { value: -1 }, uPx: { value: dpr }, uMap: { value: atlas }, uLight: { value: light } },
                    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
                    vertexColors: true, transparent: true, depthWrite: false,
                    blending: light > 0.5 ? THREE.NormalBlending : THREE.AdditiveBlending,
                });
                const points = new THREE.Points(geo, mat);

                const galaxy = new THREE.Group();
                galaxy.add(points);
                scene.add(galaxy);

                // ── 太阳：中央光核（canvas 径向纹理 Sprite） ──
                const sunCv = document.createElement("canvas");
                sunCv.width = sunCv.height = 128;
                const sc = sunCv.getContext("2d")!;
                const sg = sc.createRadialGradient(64, 64, 0, 64, 64, 62);
                sg.addColorStop(0, "rgba(255,255,255,1)");
                sg.addColorStop(0.22, "rgba(255,214,150,0.95)");
                sg.addColorStop(0.5, "rgba(240,120,74,0.55)");
                sg.addColorStop(1, "rgba(240,120,74,0)");
                sc.fillStyle = sg; sc.fillRect(0, 0, 128, 128);
                const sunTex = new THREE.CanvasTexture(sunCv);
                const sunMat = new THREE.SpriteMaterial({
                    map: sunTex, transparent: true, depthWrite: false,
                    blending: light > 0.5 ? THREE.NormalBlending : THREE.AdditiveBlending,
                    color: light > 0.5 ? 0xe06a3e : 0xffffff,
                    opacity: light > 0.5 ? 0.95 : 1,
                });
                const sun = new THREE.Sprite(sunMat);
                sun.scale.set(2.4, 2.4, 1);
                galaxy.add(sun);

                // ── 轨道环线：每条轨道一圈淡线（倾角烘进顶点） ──
                const LINE_NIGHT = 0xffffff, LINE_DAY = 0x51617f;
                const lineGeos: InstanceType<typeof THREE.BufferGeometry>[] = [];
                const lineMats: InstanceType<typeof THREE.LineBasicMaterial>[] = [];
                for (let k = 0; k < RINGS; k++) {
                    const SEG = 96;
                    const lp = new Float32Array((SEG + 1) * 3);
                    for (let sIdx = 0; sIdx <= SEG; sIdx++) {
                        const th = (sIdx / SEG) * Math.PI * 2;
                        v3.set(Math.cos(th) * ringR[k], 0, Math.sin(th) * ringR[k]).applyMatrix4(ringMats[k]);
                        lp[sIdx * 3] = v3.x; lp[sIdx * 3 + 1] = v3.y; lp[sIdx * 3 + 2] = v3.z;
                    }
                    const lg = new THREE.BufferGeometry();
                    lg.setAttribute("position", new THREE.BufferAttribute(lp, 3));
                    const lm = new THREE.LineBasicMaterial({
                        color: light > 0.5 ? LINE_DAY : LINE_NIGHT, transparent: true,
                        opacity: light > 0.5 ? 0.16 : 0.09, depthWrite: false,
                    });
                    lineGeos.push(lg); lineMats.push(lm);
                    galaxy.add(new THREE.Line(lg, lm));
                }

                // ── 背景星尘：纯装饰的细小白点，反向慢转做视差纵深 ──
                const DUST = 260;
                const dpos = new Float32Array(DUST * 3);
                for (let i = 0; i < DUST; i++) {
                    const h1 = ((i * 2246822519) % 1000) / 1000;
                    const h2 = ((i * 3266489917 + 374761393) % 1000) / 1000;
                    const h3 = ((i * 668265263 + 1013904223) % 1000) / 1000;
                    const th = h1 * Math.PI * 2, ph = Math.acos(2 * h2 - 1), R = 9 + h3 * 6;
                    dpos[i * 3] = Math.sin(ph) * Math.cos(th) * R;
                    dpos[i * 3 + 1] = Math.cos(ph) * R * 0.7;
                    dpos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * R;
                }
                const dgeo = new THREE.BufferGeometry();
                dgeo.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
                const DUST_NIGHT = 0xaabbdd, DUST_DAY = 0x7e8ba3;
                const dmat = new THREE.PointsMaterial({
                    size: 0.07, color: light > 0.5 ? DUST_DAY : DUST_NIGHT, map: atlas, transparent: true,
                    opacity: light > 0.5 ? 0.4 : 0.55,
                    depthWrite: false, blending: light > 0.5 ? THREE.NormalBlending : THREE.AdditiveBlending,
                    sizeAttenuation: true,
                });
                // 星尘只用图集左格（柔光圆）：把 UV 压到左半
                dmat.onBeforeCompile = (sh) => {
                    sh.fragmentShader = sh.fragmentShader.replace(
                        "#include <map_particle_fragment>",
                        "vec2 dUv = vec2(gl_PointCoord.x / 3.0, gl_PointCoord.y);\ndiffuseColor *= texture2D(map, dUv);"
                    );
                };
                const dust = new THREE.Points(dgeo, dmat);
                scene.add(dust);

                const raycaster = new THREE.Raycaster();
                raycaster.params.Points = { threshold: 0.32 };
                const ndc = new THREE.Vector2();

                let targetRY = 0, dragging = false, lastX = 0, moved = 0;
                let hoverIdx = -1;
                const resize = () => {
                    const w = wrap.clientWidth, h = wrap.clientHeight;
                    renderer.setSize(w, h, false);
                    camera.aspect = w / Math.max(1, h);
                    camera.updateProjectionMatrix();
                    // 宽屏时星系重心右移，把左侧让给问候与头条浮卡
                    galaxy.position.x = w > 900 ? 2.3 : 0;
                };
                resize();
                const ro = new ResizeObserver(resize); ro.observe(wrap);

                const onDown = (e: PointerEvent) => {
                    if (inUi(e.target)) return; // 浮卡/按钮上不启动拖拽
                    dragging = true; moved = 0; lastX = e.clientX;
                };
                const onMove = (e: PointerEvent) => {
                    if (inUi(e.target) && !dragging) {
                        hoverIdx = -1; mat.uniforms.uHover.value = -1; setHover(null); wrap.style.cursor = "";
                        return;
                    }
                    const rect = wrap.getBoundingClientRect();
                    if (dragging) {
                        const dx = e.clientX - lastX; lastX = e.clientX; moved += Math.abs(dx);
                        targetRY += dx * 0.005;
                    }
                    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
                    raycaster.setFromCamera(ndc, camera);
                    const hits = raycaster.intersectObject(points);
                    if (hits.length && typeof hits[0].index === "number") {
                        hoverIdx = hits[0].index;
                        mat.uniforms.uHover.value = hoverIdx;
                        setHover({ title: items[hoverIdx].title, x: e.clientX - rect.left, y: e.clientY - rect.top });
                        wrap.style.cursor = "pointer";
                    } else {
                        hoverIdx = -1; mat.uniforms.uHover.value = -1; setHover(null);
                        wrap.style.cursor = dragging ? "grabbing" : "grab";
                    }
                };
                const onUp = (e: PointerEvent) => {
                    if (!inUi(e.target) && moved < 6 && hoverIdx >= 0) router.push(items[hoverIdx].href); // 没拖动=点击星星
                    dragging = false;
                };
                const onLeave = () => { dragging = false; hoverIdx = -1; mat.uniforms.uHover.value = -1; setHover(null); };
                wrap.addEventListener("pointerdown", onDown);
                wrap.addEventListener("pointermove", onMove);
                wrap.addEventListener("pointerup", onUp);
                wrap.addEventListener("pointerleave", onLeave);

                // 全站主题切换 → uLight 目标翻转，帧内渐变；过半时切混合模式与星尘配色
                const mo = new MutationObserver(() => { lightT = isLight() ? 1 : 0; });
                mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

                let raf = 0, running = true;
                let simT = 0, lastMs = performance.now();
                const t0 = performance.now();
                const frame = () => {
                    if (!running) return;
                    const now = performance.now();
                    const dt = Math.min(0.1, (now - lastMs) / 1000);
                    lastMs = now;
                    mat.uniforms.uT.value = (now - t0) / 1000;
                    if (Math.abs(lightT - light) > 0.001) {
                        light += (lightT - light) * 0.08;
                        mat.uniforms.uLight.value = light;
                        const wantNormal = light > 0.5;
                        if ((mat.blending === THREE.NormalBlending) !== wantNormal) {
                            mat.blending = wantNormal ? THREE.NormalBlending : THREE.AdditiveBlending;
                            dmat.blending = mat.blending;
                            dmat.color.setHex(wantNormal ? DUST_DAY : DUST_NIGHT);
                            dmat.opacity = wantNormal ? 0.4 : 0.55;
                            sunMat.blending = mat.blending;
                            sunMat.color.setHex(wantNormal ? 0xe06a3e : 0xffffff);
                            lineMats.forEach((lm) => { lm.color.setHex(wantNormal ? LINE_DAY : LINE_NIGHT); lm.opacity = wantNormal ? 0.16 : 0.09; });
                            mat.needsUpdate = true; dmat.needsUpdate = true; sunMat.needsUpdate = true;
                        }
                    }
                    // hover 行星或拖拽中：公转与自转全部停下，让人看清、点准
                    const active = !reduced && !dragging && hoverIdx < 0;
                    if (active) {
                        simT += dt;
                        targetRY += 0.0009;
                        updatePos(simT);
                        geo.attributes.position.needsUpdate = true;
                    }
                    galaxy.rotation.y += (targetRY - galaxy.rotation.y) * 0.08;
                    dust.rotation.y = -galaxy.rotation.y * 0.35;                   // 星尘反向慢转（视差）
                    renderer.render(scene, camera);
                    raf = requestAnimationFrame(frame);
                };
                frame();

                const onVis = () => {
                    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
                    else { running = true; frame(); }
                };
                document.addEventListener("visibilitychange", onVis);
                // 离开视口暂停（省电）
                const io2 = new IntersectionObserver((es) => {
                    const vis = es.some((x) => x.isIntersecting);
                    if (!vis) { running = false; cancelAnimationFrame(raf); }
                    else if (!document.hidden && !running) { running = true; frame(); }
                });
                io2.observe(wrap);

                cleanup = () => {
                    running = false; cancelAnimationFrame(raf);
                    document.removeEventListener("visibilitychange", onVis);
                    wrap.removeEventListener("pointerdown", onDown);
                    wrap.removeEventListener("pointermove", onMove);
                    wrap.removeEventListener("pointerup", onUp);
                    wrap.removeEventListener("pointerleave", onLeave);
                    ro.disconnect(); io2.disconnect(); mo.disconnect();
                    geo.dispose(); mat.dispose(); dgeo.dispose(); dmat.dispose(); atlas.dispose();
                    sunTex.dispose(); sunMat.dispose();
                    lineGeos.forEach((g) => g.dispose()); lineMats.forEach((m) => m.dispose());
                    renderer.dispose();
                };
            } catch { /* three 加载失败：保留天窗容器，只是没有星星 */ }
        }, { rootMargin: "200px" });
        io.observe(wrap);

        return () => { disposed = true; io.disconnect(); cleanup?.(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items.length]);

    return (
        <div
            ref={wrapRef}
            className={`relative touch-none select-none overflow-hidden ${className ?? "h-[360px] rounded-2xl"}`}
            style={{ background: "var(--gx-sky)" }}
        >
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
            {/* 底缘轻渐隐：用页面底色变量渐入，日夜通用 */}
            <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-16 opacity-60"
                style={{ background: "linear-gradient(to top, var(--color-bg), transparent)" }}
            />
            {children}
            {/* 右下角小字：交互提示（分区图例撤掉——顶栏已有分区导航，不重复） */}
            <div className="pointer-events-none absolute bottom-3 right-4 hidden text-[11px] text-text-3/70 dark:text-white/40 sm:block">
                每颗行星都是一部作品 · 拖动旋转 · 点星直达
            </div>
            {hover && (
                <div
                    className="pointer-events-none absolute z-10 max-w-[240px] -translate-x-1/2 rounded-lg border border-line bg-white/92 px-3 py-1.5 text-[12.5px] font-medium text-text-1 shadow-xl backdrop-blur dark:border-white/15 dark:bg-black/70 dark:text-white"
                    style={{ left: hover.x, top: Math.max(8, hover.y - 40) }}
                >
                    {hover.title}
                </div>
            )}
        </div>
    );
}
