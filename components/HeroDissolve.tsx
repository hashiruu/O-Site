"use client";

// 轮播的 GLSL 置换溶解层：切换时两张图沿 fbm 噪声流场相互撕开、重组。
// 铁律：溶解只是增强层，绝不承担正确性——canvas 只在 1.6s 过渡期内可见，
// 过渡一结束立刻清成全透明，常态永远是底下的 <img> 在显示
// （曾经过渡后定格在 canvas 上，Chrome 一旦绘制异常整个 banner 就黑/无图，Safari 却正常）。
// 任何 GL 绘制异常 → 整层自杀隐藏；帧循环只在过渡期跑，静止时零 GPU 占用。
import { useEffect, useRef } from "react";

const FRAG = `
precision highp float;
uniform sampler2D u_t1; uniform sampler2D u_t2;
uniform vec2 u_res; uniform vec2 u_img1; uniform vec2 u_img2;
uniform float u_p;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<3;i++){ v+=a*noise(p); p*=2.11; a*=0.5; } return v; }
// object-cover 等价的 UV：画布纵横比 vs 图片纵横比，居中裁切
vec2 coverUV(vec2 uv, vec2 img){
  float ca = u_res.x/u_res.y, ia = img.x/img.y;
  vec2 s = ca > ia ? vec2(1.0, ia/ca) : vec2(ca/ia, 1.0);
  return (uv - 0.5) * s / 1.05 + 0.5;   // /1.05 对齐 img 的 scale-105
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_res; uv.y = 1.0 - uv.y;
  float p = smoothstep(0.0, 1.0, u_p);
  // 噪声流场：每个像素有自己的撕裂方向与迟滞，边缘先碎、中心后合
  float n  = fbm(uv * 4.0);
  vec2 dir = vec2(fbm(uv*3.0 + 7.3) - 0.5, fbm(uv*3.0 + 2.9) - 0.5) * 2.0;
  float local = clamp((p * 1.35 - n * 0.35), 0.0, 1.0);  // 逐像素错峰进度
  vec4 c1 = texture2D(u_t1, coverUV(uv + dir * 0.18 * local, u_img1));
  vec4 c2 = texture2D(u_t2, coverUV(uv - dir * 0.18 * (1.0 - local), u_img2));
  gl_FragColor = mix(c1, c2, local);
}`;

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

interface Tex { tex: WebGLTexture; w: number; h: number }

export function HeroDissolve({ srcs, active, className }: { srcs: string[]; active: number; className?: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const stateRef = useRef<{ draw?: (fromIdx: number, toIdx: number, p: number) => void; clear?: () => void; load?: (i: number) => void; texes: (Tex | null | "loading" | "failed")[] }>({ texes: [] });
    const prevRef = useRef(active);
    const rafRef = useRef(0);

    // 初始化 GL（一次）
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const gl = canvas.getContext("webgl", { antialias: false, alpha: true, powerPreference: "low-power" });
        if (!gl) return; // 无 WebGL：canvas 恒透明，img 轮播兜底

        const mk = (type: number, src: string) => {
            const s = gl.createShader(type)!;
            gl.shaderSource(s, src); gl.compileShader(s);
            return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
        };
        const vs = mk(gl.VERTEX_SHADER, VERT), fs = mk(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) return;
        const prog = gl.createProgram()!;
        gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const aLoc = gl.getAttribLocation(prog, "a");
        gl.enableVertexAttribArray(aLoc); gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
        const u = (n: string) => gl.getUniformLocation(prog, n);
        const uT1 = u("u_t1"), uT2 = u("u_t2"), uRes = u("u_res"), uImg1 = u("u_img1"), uImg2 = u("u_img2"), uP = u("u_p");

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            const w = canvas.clientWidth, h = canvas.clientHeight;
            canvas.width = Math.max(1, Math.round(w * dpr));
            canvas.height = Math.max(1, Math.round(h * dpr));
            gl.viewport(0, 0, canvas.width, canvas.height);
            // 重设 width/height 会重新分配绘制缓冲区。规范说新缓冲区透明，但部分
            // GPU/合成器在"重分配后没提交过帧"时把它合成为不透明黑——canvas 盖满
            // banner，一 resize 图就"消失"。必须立刻显式清一帧透明提交出去。
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        };
        resize();
        const ro = new ResizeObserver(resize); ro.observe(canvas);

        // GPU 上下文丢失（resize 重分配、显卡切换、休眠恢复都可能触发）：
        // 丢失后 gl 调用全部无效化，canvas 内容未定义——整层退场，img 完整兜底
        const onCtxLost = (e: Event) => { e.preventDefault(); canvas.style.display = "none"; };
        canvas.addEventListener("webglcontextlost", onCtxLost);

        const st = stateRef.current;
        st.load = (i: number) => {
            if (i < 0 || i >= srcs.length || st.texes[i]) return;
            st.texes[i] = "loading";
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                try {
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                    st.texes[i] = { tex, w: img.naturalWidth, h: img.naturalHeight };
                } catch { st.texes[i] = "failed"; }
            };
            img.onerror = () => { st.texes[i] = "failed"; };
            // 纹理源一律走自家代理转同源：TMDB CDN 部分节点不回 CORS 头，
            // crossOrigin 直连会 ERR_FAILED（Chrome 严格、Safari 侥幸）——同源永不遇上 CORS。
            const raw = srcs[i];
            img.src = /^https?:\/\//.test(raw) ? `/api/discover/img?u=${encodeURIComponent(raw)}` : raw;
        };
        st.clear = () => { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); };
        st.draw = (fromIdx: number, toIdx: number, p: number) => {
            const a = st.texes[fromIdx], b = st.texes[toIdx];
            if (typeof a !== "object" || typeof b !== "object" || !a || !b) { st.clear!(); return; }
            try {
                gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.tex); gl.uniform1i(uT1, 0);
                gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b.tex); gl.uniform1i(uT2, 1);
                gl.uniform2f(uRes, canvas.width, canvas.height);
                gl.uniform2f(uImg1, a.w, a.h); gl.uniform2f(uImg2, b.w, b.h);
                gl.uniform1f(uP, p);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            } catch { canvas.style.display = "none"; } // 绘制异常：整层退场，img 完整兜底
        };

        // 预载首图与次图（不画静帧——常态由 img 显示）
        st.load(0); st.load(1 % Math.max(1, srcs.length));

        return () => {
            ro.disconnect();
            canvas.removeEventListener("webglcontextlost", onCtxLost);
            cancelAnimationFrame(rafRef.current);
            st.texes.forEach((t) => { if (typeof t === "object" && t) gl.deleteTexture(t.tex); });
            st.texes = []; st.draw = undefined; st.clear = undefined; st.load = undefined;
            gl.getExtension("WEBGL_lose_context")?.loseContext();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [srcs.length]);

    // active 变化 → 跑一段 1.6s 溶解（纹理未就绪则跳过，img 淡化兜底）
    useEffect(() => {
        const st = stateRef.current;
        const from = prevRef.current, to = active;
        prevRef.current = active;
        if (!st.draw || from === to) return;
        st.load?.(to);
        st.load?.((to + 1) % srcs.length); // 顺手预载下一张
        cancelAnimationFrame(rafRef.current);
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduced) { st.clear?.(); if (canvasRef.current) canvasRef.current.style.opacity = "0"; return; }
        const t0 = performance.now(), DUR = 1600;
        const cv = canvasRef.current;
        // CSS 级隐藏铁律：canvas 只在过渡的 1.6s 内可见。resize 重分配缓冲区的
        // 黑帧、GPU 合成异常……不管 canvas 内容烂成什么样，平时 opacity:0 都看不见
        // （探针证明 img 层全程正常——能盖住它的只有这层 canvas）
        if (cv) cv.style.opacity = "1";
        const tick = () => {
            const p = Math.min(1, (performance.now() - t0) / DUR);
            st.draw!(from, to, p);
            if (p < 1) rafRef.current = requestAnimationFrame(tick);
            else {
                st.clear?.(); // 过渡完清透明
                if (cv) cv.style.opacity = "0"; // CSS 双保险：内容之外整层隐身
            }
        };
        rafRef.current = requestAnimationFrame(tick);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    // 初始 opacity:0——canvas 生命周期里默认隐身，只在过渡期被 tick 点亮
    return <canvas ref={canvasRef} className={className ?? "pointer-events-none absolute inset-0 h-full w-full"} style={{ opacity: 0 }} aria-hidden />;
}
