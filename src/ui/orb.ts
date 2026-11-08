// 声の玉: 録っている声の大きさと明るさ（ゼロ交差の多さ）に合わせて、形と色が動く玉（WebGL）。録った長さは玉のまわりの輪で出す。
// 持つのは、いまの大きさと明るさの 2 つの数だけで、音そのものは持たない。測定・照合には使わない（見た目だけ）。
// WebGL が使えない時は CSS の玉（.orb.css）にして、大きさだけ CSS 変数 --level で動かす。
// WebGL の文脈を失った間は描くのをやめて CSS の玉を見せ、戻ったらプログラムなどを作り直して WebGL に戻る。
// 動きを減らす設定では、模様を止めて、声の大きさに合わせた大きさだけを変える。画面に見えない時・ページが隠れた時は描かない。
// 色は CSS 変数 --orb-1〜3（濃い色・薄い色の両方を base.css で決める）。

export type OrbMode = 'idle' | 'listening' | 'analysing' | 'done';

export interface Orb {
  push(x: Float32Array, rate: number): void;
  mode(m: OrbMode): void;
  progress(p: number): void;
}

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

const FRAG = `precision highp float;
uniform vec2 uRes;uniform float uTime,uLevel,uBright,uProg,uListen,uBusy,uPulse;uniform vec3 uC1,uC2,uC3,uRing;
float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;mat2 r=mat2(.8,.6,-.6,.8);for(int i=0;i<4;i++){s+=a*n(p);p=r*p*2.03+3.1;a*=.5;}return s;}
void main(){
  vec2 p=(gl_FragCoord.xy*2.-uRes)/min(uRes.x,uRes.y);
  float t=uTime;
  float d=length(p),ang=atan(p.y,p.x);
  vec2 dir=vec2(cos(ang),sin(ang));
  float breath=sin(t*1.3)*.012;
  float r0=.56+breath+uLevel*.07+uPulse*.05;
  float wob=(fbm(dir*1.6+vec2(t*.35,-t*.27))-.5)*(.07+uLevel*.22+uBusy*.05);
  float r=r0+wob;
  float inside=smoothstep(r+.006,r-.006,d);
  vec2 q=p/r;
  float z=sqrt(max(0.,1.-dot(q,q)));
  vec2 w=q*1.5+vec2(t*.06,-t*.05)*(1.+uBusy*3.);
  float a1=fbm(w+uLevel*.6);
  float a2=fbm(w*1.4+a1*2.2+vec2(-t*.08,t*.11)*(1.+uBusy*2.));
  vec3 col=mix(uC1,uC2,smoothstep(.36,.64,a2));
  col=mix(col,uC2,smoothstep(.1,-.95,q.y+q.x*.3)*.65);
  col=mix(col,uC3,smoothstep(.36,.82,a1*a2*1.9+uBright*.35-.05)*.9);
  vec3 nrm=normalize(vec3(q,z+.001));
  float lit=.55+.45*dot(nrm,normalize(vec3(-.45,.55,.7)));
  float spec=pow(max(0.,dot(reflect(-normalize(vec3(-.35,.5,.8)),nrm),vec3(0,0,1))),28.);
  float rim=pow(max(0.,1.-z),2.6);
  col=col*lit+spec*.55+rim*mix(uC3,vec3(1),.35)*.8;
  float glow=exp(-max(0.,d-r)*(5.5-uLevel*2.))*(.32+uLevel*.45+uPulse*.4)*(1.-inside)*smoothstep(1.,.66,d);
  vec3 gcol=mix(uC2,uC1,.5+.5*sin(ang*2.+t*.4));
  float rr=.86;
  float ring=smoothstep(.0045,0.,abs(d-rr)-.003);
  float fa=fract((atan(p.x,p.y)/6.2831853)+1.);
  float arc=ring*step(fa,uProg)*uListen;
  float base=ring*.16*uListen;
  vec3 c=col*inside+gcol*glow;
  float al=inside+glow;
  c+=uRing*(arc+base);
  al+=arc+base;
  al=clamp(al,0.,1.);
  gl_FragColor=vec4(min(c,vec3(al)),al);
}`;

/** CSS の色（oklch など）を 0〜1 の RGB に（canvas に塗らせて読む） */
function cssColor(probe: CanvasRenderingContext2D, value: string, fallback: [number, number, number]): [number, number, number] {
  try {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000';
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return [r! / 255, g! / 255, b! / 255];
  } catch {
    return fallback;
  }
}

/** 二乗平均から大きさ（0〜1）: -56 dBFS 以下で 0、-12 dBFS で 1 */
const levelOf = (ms: number) => Math.min(1, Math.max(0, (10 * Math.log10(ms + 1e-12) + 56) / 44));

export function createOrb(box: HTMLElement): Orb {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let target = 0,
    level = 0,
    brightT = 0,
    bright = 0,
    prog = 0,
    listen = 0,
    busy = 0,
    pulse = 0,
    mode: OrbMode = 'idle';

  const sound = {
    push(x: Float32Array, rate: number) {
      let s = 0,
        z = 0;
      for (let i = 0; i < x.length; i++) {
        s += x[i]! * x[i]!;
        if (i && x[i]! >= 0 !== x[i - 1]! >= 0) z++;
      }
      target = levelOf(s / Math.max(1, x.length));
      // 1 秒あたりのゼロ交差の数（300〜6000）を 0〜1 に
      const zr = (z * rate) / Math.max(1, x.length);
      brightT = Math.min(1, Math.max(0, Math.log(Math.max(zr, 1) / 300) / Math.log(20)));
    },
  };

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
  let program = gl && build(gl);
  if (!gl || !program) {
    // WebGL が無い時: CSS の玉。大きさは音の大きさで決める
    box.classList.add('css');
    let raf = 0;
    const loop = () => {
      level += (target - level) * 0.25;
      target *= 0.9;
      box.style.setProperty('--level', level.toFixed(3));
      raf = level > 0.002 || mode === 'listening' ? requestAnimationFrame(loop) : 0;
    };
    return {
      push(x, rate) {
        sound.push(x, rate);
        if (!raf) raf = requestAnimationFrame(loop);
      },
      mode(m) {
        mode = m;
        box.dataset.mode = m;
      },
      progress(p) {
        box.style.setProperty('--progress', String(Math.max(0, Math.min(1, p))));
      },
    };
  }
  box.append(canvas);
  box.classList.add('gl');

  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const u = (name: string) => gl!.getUniformLocation(program!, name);
  const locate = () => ({ res: u('uRes'), time: u('uTime'), level: u('uLevel'), bright: u('uBright'), prog: u('uProg'), listen: u('uListen'), busy: u('uBusy'), pulse: u('uPulse'), c1: u('uC1'), c2: u('uC2'), c3: u('uC3'), ring: u('uRing') });
  let U = locate();
  function colors() {
    const cs = getComputedStyle(box);
    gl!.uniform3fv(U.c1, cssColor(probe, cs.getPropertyValue('--orb-1').trim(), [0.95, 0.3, 0.6]));
    gl!.uniform3fv(U.c2, cssColor(probe, cs.getPropertyValue('--orb-2').trim(), [0.45, 0.3, 0.95]));
    gl!.uniform3fv(U.c3, cssColor(probe, cs.getPropertyValue('--orb-3').trim(), [0.4, 0.9, 0.95]));
    gl!.uniform3fv(U.ring, cssColor(probe, cs.getPropertyValue('--orb-ring').trim(), [1, 1, 1]));
  }
  gl.useProgram(program);
  colors();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    colors();
    wake();
  });

  let visible = true,
    raf = 0,
    last = performance.now(),
    clock = 0,
    lost = false;
  function fit() {
    const d = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(box.clientWidth * d)),
      h = Math.max(1, Math.round(box.clientHeight * d));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl!.viewport(0, 0, w, h);
    }
    gl!.uniform2f(U.res, w, h);
  }
  function frame(now: number) {
    raf = 0;
    if (lost) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const still = reduce.matches;
    if (!still) clock += dt * (1 + busy * 1.5);
    level += (target - level) * Math.min(1, dt * (target > level ? 18 : 6));
    target *= Math.pow(0.04, dt);
    bright += (brightT - bright) * Math.min(1, dt * 4);
    listen += ((mode === 'listening' ? 1 : 0) - listen) * Math.min(1, dt * 6);
    busy += ((mode === 'analysing' ? 1 : 0) - busy) * Math.min(1, dt * 3);
    pulse *= Math.pow(0.15, dt);
    fit();
    gl!.uniform1f(U.time, clock);
    gl!.uniform1f(U.level, level);
    gl!.uniform1f(U.bright, bright);
    gl!.uniform1f(U.prog, prog);
    gl!.uniform1f(U.listen, listen);
    gl!.uniform1f(U.busy, busy);
    gl!.uniform1f(U.pulse, pulse);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    // 動きを減らす設定では、まだ落ち着いていない物がある間だけ描く
    const settling = level > 0.003 || Math.abs(listen - (mode === 'listening' ? 1 : 0)) > 0.01 || pulse > 0.01 || busy > 0.01;
    if (visible && !document.hidden && (!still || settling)) raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (!raf && visible && !document.hidden && !lost) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting);
    wake();
  }).observe(box);
  document.addEventListener('visibilitychange', wake);
  new ResizeObserver(wake).observe(box);
  // 文脈を失ったら: 描くのをやめ、CSS の玉にする。止めておくと戻ってくるので、その時に作り直して WebGL に戻す
  const css = (on: boolean) => {
    box.classList.toggle('css', on);
    box.classList.toggle('gl', !on);
    canvas.style.visibility = on ? 'hidden' : '';
  };
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    css(true);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    const p = build(gl);
    if (!p) return;
    program = p;
    gl.useProgram(p);
    U = locate();
    colors();
    gl.viewport(0, 0, canvas.width, canvas.height);
    lost = false;
    css(false);
    wake();
  });
  wake();

  return {
    push(x, rate) {
      sound.push(x, rate);
      // CSS の玉の間は、大きさだけ動かす
      if (lost) box.style.setProperty('--level', target.toFixed(3));
      wake();
    },
    mode(m) {
      if (m === 'done' && mode !== 'done') pulse = 1;
      mode = m;
      box.dataset.mode = m;
      if (lost && m !== 'listening') box.style.setProperty('--level', '0');
      wake();
    },
    progress(p) {
      prog = Math.max(0, Math.min(1, p));
      box.style.setProperty('--progress', String(prog));
    },
  };
}

function build(gl: WebGLRenderingContext): WebGLProgram | null {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const v = sh(gl.VERTEX_SHADER, VERT),
    f = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // 画面を覆う三角形 1 つ
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(p, 'a');
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  return p;
}
