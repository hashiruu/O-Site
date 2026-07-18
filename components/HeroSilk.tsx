"use client";

// 首页 Hero：原生 WebGL 片元着色器「流体丝绸」——品牌橙×青在底色上流动，
// 指针扰动流场、日夜主题双配色（切主题时丝绸颜色同步渐变）。
// 零依赖（不引 Three.js：一块全屏三角形 + 一个 fragment shader，~6KB，帧预算自己攥着）。
// 降级链：无 WebGL / reduced-motion → 静态品牌渐变；页面不可见暂停渲染；DPR 封顶 1.5。
import { useEffect, useRef } from "react";

const FRAG = `
precision highp float;
uniform vec2 u_res; uniform float u_t; uniform vec2 u_m; uniform float u_dark;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.55; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p  = uv * vec2(u_res.x/u_res.y, 1.0);
  vec2 m  = (u_m - 0.5) * 0.55;
  float t = u_t * 0.055;
  // domain warping：q 扭 r、r 扭最终场——丝绸的流动感来自这两层嵌套
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2,1.3) - t));
  vec2 r = vec2(fbm(p + 2.5*q + m + vec2(1.7,9.2)), fbm(p + 2.5*q + vec2(8.3,2.8) + t*0.6));
  float f = fbm(p + 3.0*r);
  vec3 orange = vec3(0.941,0.471,0.290);
  vec3 cyan   = vec3(0.000,0.710,0.898);
  vec3 base   = mix(vec3(0.958,0.962,0.968), vec3(0.068,0.068,0.094), u_dark);
  float glow  = smoothstep(0.28, 0.95, f);
  vec3 tint   = mix(orange, cyan, clamp(q.x*1.5 - 0.25, 0.0, 1.0));
  float amt   = mix(0.20, 0.40, u_dark);           // 日间淡雅、夜间深邃
  vec3 col    = mix(base, tint, glow * amt);
  col *= 1.0 - 0.16 * length(uv - 0.5);            // 轻 vignette 聚焦文字
  gl_FragColor = vec4(col, 1.0);
}`;

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

export function HeroSilk({ children, className, canvasClassName }: {
    children?: React.ReactNode;
    className?: string;        // 覆盖容器样式（如叠加在海报上时去边框/圆角）
    canvasClassName?: string;  // 覆盖 canvas 样式（如 mix-blend-soft-light 与海报融合）
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current, wrap = wrapRef.current;
        if (!canvas || !wrap) return;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
        if (!gl) { canvas.style.display = "none"; return; } // 无 WebGL：容器自带 CSS 渐变兜底

        const mk = (type: number, src: string) => {
            const s = gl.createShader(type)!;
            gl.shaderSource(s, src); gl.compileShader(s);
            return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
        };
        const vs = mk(gl.VERTEX_SHADER, VERT), fs = mk(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) { canvas.style.display = "none"; return; }
        const prog = gl.createProgram()!;
        gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // 全屏三角形
        const aLoc = gl.getAttribLocation(prog, "a");
        gl.enableVertexAttribArray(aLoc); gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
        const uRes = gl.getUniformLocation(prog, "u_res"), uT = gl.getUniformLocation(prog, "u_t");
        const uM = gl.getUniformLocation(prog, "u_m"), uDark = gl.getUniformLocation(prog, "u_dark");

        let raf = 0, running = true;
        const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };  // 指针（lerp 平滑）
        let dark = document.documentElement.classList.contains("dark") ? 1 : 0, darkT = dark;

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            const w = wrap.clientWidth, h = wrap.clientHeight;
            canvas.width = Math.max(1, Math.round(w * dpr));
            canvas.height = Math.max(1, Math.round(h * dpr));
            gl.viewport(0, 0, canvas.width, canvas.height);
        };
        resize();
        const ro = new ResizeObserver(resize); ro.observe(wrap);

        const onMove = (e: PointerEvent) => {
            const r = wrap.getBoundingClientRect();
            mouse.tx = (e.clientX - r.left) / Math.max(1, r.width);
            mouse.ty = 1 - (e.clientY - r.top) / Math.max(1, r.height);
        };
        wrap.addEventListener("pointermove", onMove, { passive: true });

        // 主题切换 → u_dark 目标翻转，帧循环里 lerp（丝绸颜色跟着日夜渐变）
        const mo = new MutationObserver(() => { darkT = document.documentElement.classList.contains("dark") ? 1 : 0; });
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

        const t0 = performance.now();
        const frame = () => {
            if (!running) return;
            mouse.x += (mouse.tx - mouse.x) * 0.05;
            mouse.y += (mouse.ty - mouse.y) * 0.05;
            dark += (darkT - dark) * 0.06;
            gl.uniform2f(uRes, canvas.width, canvas.height);
            gl.uniform1f(uT, (performance.now() - t0) / 1000);
            gl.uniform2f(uM, mouse.x, mouse.y);
            gl.uniform1f(uDark, dark);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            if (!reduced) raf = requestAnimationFrame(frame); // reduced-motion：只画首帧静态
        };
        frame();

        const onVis = () => {
            if (document.hidden) { running = false; cancelAnimationFrame(raf); }
            else if (!reduced) { running = true; frame(); }
        };
        document.addEventListener("visibilitychange", onVis);

        return () => {
            running = false; cancelAnimationFrame(raf);
            document.removeEventListener("visibilitychange", onVis);
            wrap.removeEventListener("pointermove", onMove);
            ro.disconnect(); mo.disconnect();
            gl.getExtension("WEBGL_lose_context")?.loseContext();
        };
    }, []);

    return (
        <div
            ref={wrapRef}
            className={className ?? "relative mb-8 overflow-hidden rounded-3xl border border-line"}
            // 无 WebGL 时 canvas 隐藏，露出这层静态品牌渐变兜底
            style={className ? undefined : { background: "linear-gradient(120deg, var(--color-bg-card) 40%, var(--color-accent-glow) 100%)" }}
        >
            <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full ${canvasClassName ?? ""}`} aria-hidden />
            {children != null && <div className="relative">{children}</div>}
        </div>
    );
}
