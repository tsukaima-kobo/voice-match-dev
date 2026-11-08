// 声紋: 測った数字から描く、その声だけの指紋のような図（WebGL2）。乱数なし: 同じ数字なら、いつも同じ模様。
// 図の 18 の項目（voice-shape.ts の SHAPE_LAYERS）が、それぞれ図のどこかを動かす:
//   形      声の高さ → 色と縦の伸び／抑揚 → ふちと隆線のうねり／高さの偏り → 上下のふくらみ／高さの動きの速さ → 隆線が流れる速さ
//   芯と模様 F1 → 芯の上下／F2 → 芯の左右／響きの間隔 → 隆線の数（間隔）／明るさ → うねりの細かさと星／
//            音色 → 指紋の模様と、まわりの光のリボン（MFCC 1〜13 から戻した、低い音から高い音までの響きの山と谷。上が低い音、下が高い音、左右対称）
//   霞と線  声の澄み → 霞と、漂う霞の粒と、隆線のくっきりさ／声の柔らかさ → 隆線のぼけ／
//            高さのゆらぎ → 隆線の切れ目と、星の粒のまたたきの速さ／大きさのゆらぎ → ふちに散る星の粒の数と、隆線のまだら
//   外の輪  速さ → 粒の数と回る速さ／間の多さ → 輪のすき間／リズムのムラ → 粒の大きさと並びのムラ
//   大きさ  声の力 → 全体の大きさと隆線の太さ／強弱の幅 → 脈打つ幅
// 図の読み方で項目を選ぶと、その場所に印と引き出し線を描き、数字を出す（上に重ねた 2D の canvas）。
// 最初に出る時は、芯から外へ広がる走査の光で描き出す。動きを減らす設定では止まった絵（走査もしない）。
import { FEATURE_BY_KEY, formatFeature, type FeatureKey, type Features } from '../voice/features.ts';
import { createShapeView, drawShape, levelWord, renderGuide, SHAPE_LAYERS, shapeParams, type ShapeLayer, type ShapeParams, type ShapeView } from './voice-shape.ts';
import { t } from '../i18n.ts';

const VERT = `#version 300 es
in vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes;
uniform float uT,uReveal,uS,uA,uSkewK,uPitch,uMotion,uSpacing,uBright,uHnr,uSoft,uJit,uShim,uRate,uPause,uRhythm,uPower,uLight;
uniform vec2 uSt,uCore;
uniform float uW[10];uniform float uPh[10];uniform float uTim[13];
uniform vec3 uStar[12];
uniform vec3 uLow,uMid,uHigh,uGlint;
uniform int uFocus;
const float TAU=6.2831853;
float h1(float n){return fract(sin(n*127.1+311.7)*43758.5453);}
float h2(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+1.),f.x),f.y);}
vec3 pal(float x){x=clamp(x,0.,1.);return x<.5?mix(uLow,uMid,x*2.):mix(uMid,uHigh,(x-.5)*2.);}
float rOf(float th){float s=0.;for(int i=0;i<10;i++)s+=uW[i]*cos(float(i+2)*th+uPh[i]);return uS*(1.+uA*s+uSkewK*sin(th));}
float lay(int l){return (uFocus==0||uFocus==l)?1.:.16;}
// 音色のリボンの形: MFCC 1〜13 を戻した、低い音（s=0、上）から高い音（s=1、下）までの響きの山と谷
float envAt(float s){float mm=s*25.,e=0.;for(int k=1;k<=13;k++){float w=1./(1.+.3*float(k));e+=(uTim[k-1]-.5)*2.*w*cos(3.14159265*float(k)*(mm+.5)/26.);}return e;}
void main(){
  vec2 p=(gl_FragCoord.xy*2.-uRes)/min(uRes.x,uRes.y);
  vec2 q=p/uSt;
  float dq=length(q),thq=atan(q.y,q.x);
  vec2 dc2=q-uCore;float dc=length(dc2),thc=atan(dc2.y,dc2.x);
  float R=rOf(thq);
  float bl=smoothstep(0.,1.,dq/R);
  float r=mix(dc,dq,bl*bl);
  float u=r/R;
  float lShape=lay(1),lCore=lay(2),lMist=lay(3),lOrbit=lay(4),lSize=lay(5);
  vec3 C=vec3(0.);float A=0.;
  // 背の光
  vec3 base=pal(uPitch);
  float bg=exp(-dq/(uS*1.1))*.10;C+=base*bg;A+=bg;
  // 霞（声の澄み）
  float fogAmt=(1.-uHnr);
  float fog=fogAmt*exp(-max(0.,dq-R)/(uS*(.22+.25*fogAmt)))*(.35+.65*vn(q*3.2+vec2(uT*.05,-uT*.03)))*.55*smoothstep(.98,.75,length(p));
  fog*=lMist*smoothstep(0.,.6,uReveal);
  C+=pal(uPitch+.1)*fog;A+=fog;
  // 隆線（指紋の線）
  float nR=11.+22.*(1.-uSpacing);
  float warp=0.;
  for(int k=0;k<6;k++)warp+=(uTim[k]-.5)*.9*sin(float(k+2)*thc+uTim[k+6]*TAU+u*float(k+1)*2.1);
  warp+=.3*(uTim[12]-.5)*sin(u*9.+thc);
  float v=u*nR+.65*warp*smoothstep(0.,.35,u)+thc/TAU-uT*(.1+.6*uMotion);
  float ri=floor(v),fr=fract(v);
  float dv=abs(fr-.5);
  // v は左の継ぎ目（−π と π）で 1 跳ぶ。ぼかしの幅は、継ぎ目を右へ移した v でも測って小さい方を使う（継ぎ目に光る線が出ないように）
  float aa=min(fwidth(v),fwidth(v+step(thc,0.)))*1.2+.2*uSoft;
  float hw=.07+.1*uPower;
  float line=1.-smoothstep(hw,hw+aa,dv);
  // 切れ目と粒の模様は、角度を cos・sin で持って、左の継ぎ目（−π と π）でずれないように
  vec2 dirc=vec2(cos(thc),sin(thc));
  float brk=smoothstep(uJit*.6-.06,uJit*.6+.06,vn(dirc*3.5+vec2(u*nR*1.1,u*nR*.7)));
  float bead=1.-uShim*.8*smoothstep(.35,.85,vn(dirc*14.+vec2(u*nR*2.3,3.1)));
  float inside=smoothstep(1.,.95,u);
  float coreFade=smoothstep(.03,.16,u);
  float rv=uReveal>=1.?1.:smoothstep(uReveal*1.2,uReveal*1.2-.04,u);
  float ridge=line*brk*bead*inside*coreFade*rv*(.5+.5*uHnr)*(.75+.25*uPower);
  float rl=max(max(lCore,lMist),lSize);
  vec3 rc=pal(uPitch+(u-.5)*.38+.06*sin(thc*2.+uT*.15));
  C+=rc*ridge*rl;A+=ridge*rl;
  float soft=exp(-dv*(13.-9.*uSoft))*.22*inside*coreFade*rv*brk;
  C+=rc*soft*rl;A+=soft*rl;
  // ふち
  float e=r-R;
  float rim=exp(-abs(e)/(.004+.012*uSoft+.004*uPower))*(.75+.25*uPower)*smoothstep(0.,.4,uReveal);
  float rimL=max(lShape,lSize);
  vec3 rimC=mix(pal(uPitch+.15),uGlint,.25);
  C+=rimC*rim*rimL;A+=rim*rimL;
  // 走査の光（最初だけ）
  if(uReveal<1.){float sc=exp(-abs(u-uReveal*1.2)*45.)*(1.-uReveal)*inside;C+=uGlint*sc;A+=sc;}
  // 芯
  float cg=(exp(-dc/(uS*.07))*.9+exp(-dc/(uS*.22))*.28)*lCore*smoothstep(0.,.25,uReveal);
  vec3 cc=uLight>.5?pal(uPitch+.2):mix(pal(uPitch),uGlint,.65);
  C+=cc*cg;A+=cg;
  // 星（明るさ）
  for(int i=0;i<12;i++){
    vec3 s=uStar[i];if(s.z<=0.)continue;
    vec2 d=p-s.xy;float tw=.75+.25*sin(uT*2.3+float(i)*1.7);
    float sz=s.z*tw;
    float st=exp(-abs(d.x)/(sz*.08))*exp(-abs(d.y)/sz)+exp(-abs(d.y)/(sz*.08))*exp(-abs(d.x)/sz)+exp(-length(d)/(sz*.25))*.6;
    st*=lCore*smoothstep(.5,1.,uReveal)*(.4+.6*uBright);
    C+=(uLight>.5?pal(uPitch+.25):uGlint)*st;A+=st;
  }
  // 音色のリボン（左右対称。上が低い音、下が高い音。外へふくらむ所ほど、その高さの音が強い）
  float dp=length(p),thp=atan(p.y,p.x);
  float rc0=uS*(1.15+uA)+.015;
  float sR=abs(atan(p.x,p.y))/3.14159265;
  float off=.5+.5*tanh(envAt(sR)*1.6);
  float grow=smoothstep(.72,1.,uReveal);
  float H=(.03+.2*off)*uS/.42*grow;
  float rb=rc0+H;
  vec3 rcol=pal(.08+.84*sR);
  float tIn=clamp((dp-rc0)/max(H,.001),0.,1.);
  float body=smoothstep(rc0-.006,rc0+.004,dp)*(1.-smoothstep(rb-.002,rb+.006,dp));
  float curtain=body*pow(tIn,1.3)*(.22+.34*off)*(.7+.3*sin(sR*30.-uT*.8+tIn*3.));
  float strands=0.;
  for(int j=0;j<4;j++){float fj=float(j);float rj=rc0+H*(.3+.22*fj)+.004*sin(sR*18.+uT*(.6+.25*fj)+fj*1.7);strands+=exp(-abs(dp-rj)/.0018)*(.16+.08*fj);}
  float edge=exp(-abs(dp-rb)/.0028)*.95;
  float shine=pow(.5+.5*sin(sR*26.-uT*1.4),10.)*exp(-abs(dp-rb)/.007)*.7;
  float base0=exp(-abs(dp-rc0)/.0018)*.22;
  float rib=(curtain+(strands+edge+shine+base0)*grow)*lCore;
  C+=mix(rcol,uGlint,.2*edge)*rib;A+=rib;
  // かすれの星の粒（大きさのゆらぎで数、高さのゆらぎでまたたきの速さ）。ふちのまわりに散る。きれいな声でも少しだけ
  float rasp=clamp(.65*uShim+.35*uJit,0.,1.);
  float grain=0.;
  {
    float cs=.016;vec2 cell=floor(p/cs);
    float ha=h2(cell),hb=h2(cell+17.3),hc=h2(cell+41.7),hd=h2(cell+5.1);
    vec2 cen=(cell+.3+.4*vec2(ha,hb))*cs;
    float uc=length(cen/uSt)/R;
    float band=exp(-pow((uc-1.04)/(.07+.16*rasp),2.));
    if(hc<(.06+.75*rasp)*band){
      vec2 d=p-cen;float sz=cs*(.05+.1*hd);
      float tw=.5+.5*sin(uT*(1.2+5.*uJit)*(.6+hd)+hc*40.);
      float st=exp(-length(d)/(sz*.55))+.7*(exp(-abs(d.x)/(sz*.12))*exp(-abs(d.y)/(sz*1.1))+exp(-abs(d.y)/(sz*.12))*exp(-abs(d.x)/(sz*1.1)));
      grain=st*(.25+.75*tw)*smoothstep(.55,.9,uReveal);
    }
  }
  grain*=lMist;
  C+=mix(pal(uPitch+.12),uGlint,.55)*grain;A+=grain;
  // 霞の粒（息）。霞の中を、ふわっと出ては消える
  float puff=0.;
  {
    float cs=.03;vec2 cell=floor(p/cs);
    float ha=h2(cell+3.3),hb=h2(cell+9.1),hc=h2(cell+27.7);
    vec2 cen=(cell+.3+.4*vec2(ha,hb))*cs;
    float uc=length(cen/uSt)/R;
    float band=smoothstep(.95,1.08,uc)*(1.-smoothstep(1.25,1.25+.45*fogAmt,uc));
    if(hc<fogAmt*.7*band){
      float life=fract(uT*.12+hc*7.);
      float sz=cs*(.12+.12*ha);
      puff=exp(-pow(length(p-cen)/sz,2.))*sin(3.14159265*life)*.55*smoothstep(.6,1.,uReveal);
    }
  }
  puff*=lMist;
  C+=pal(uPitch+.08)*puff;A+=puff;
  // 外の輪（速さ・間・リズム）
  float ro=.885;
  float ringBase=exp(-abs(dp-ro)/.0025)*.16*lOrbit*smoothstep(.6,1.,uReveal);
  if(uRate<0.){
    float dots=step(.55,fract(thp*48./TAU));
    ringBase=exp(-abs(dp-ro)/.003)*.3*dots*lOrbit*smoothstep(.6,1.,uReveal);
    C+=base*ringBase;A+=ringBase;
  }else{
    C+=base*ringBase;A+=ringBase;
    float nb=floor(14.+46.*uRate);
    float rot=uT*(.04+.28*uRate);
    float sb=TAU/nb;
    float ab=mod(thp-rot+TAU*4.,TAU);
    float ib=floor(ab/sb);
    float beadOut=0.;
    for(int j=-1;j<=1;j++){
      float idx=mod(ib+float(j)+nb,nb);
      float cen=(idx+.5)*sb+(h1(idx*7.1)-.5)*uRhythm*.7*sb;
      float ph=fract(cen/(TAU/3.));
      if(ph>1.-(.05+.5*uPause))continue;
      float sz=(.009+.006*uPower)*(1.+(h1(idx*3.7)-.5)*1.5*uRhythm);
      vec2 bc=ro*vec2(cos(cen+rot),sin(cen+rot));
      beadOut=max(beadOut,smoothstep(sz,sz*.45,length(p-bc)));
    }
    beadOut*=lOrbit*smoothstep(.7,1.,uReveal);
    C+=mix(base,uGlint,.35)*beadOut;A+=beadOut;
  }
  A=clamp(A,0.,1.);
  o=vec4(min(C,vec3(A)),A);
}`;

type RGB = [number, number, number];
const TAU = Math.PI * 2;
const h1 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};
const or = (v: number | null | undefined, d = 0.5) => (v === null || v === undefined ? d : v);

function cssColor(probe: CanvasRenderingContext2D, value: string, fallback: RGB): RGB {
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

/** 図の形（JS とシェーダーで同じ式。印の場所を計算するため） */
interface Geo {
  S: number;
  /** 脈を除いた大きさ */
  S0: number;
  st: [number, number];
  A: number;
  skewK: number;
  w: number[];
  ph: number[];
  core: [number, number];
  stars: [number, number, number][];
  pulse: number;
}
function geometry(p: ShapeParams, t: number): Geo {
  const pitch = or(p.pitch),
    power = or(p.tilt);
  const pulse = 0.01 + 0.035 * or(p.levelRange);
  const S0 = 0.36 + 0.09 * power;
  const S = S0 * (1 + pulse * Math.sin(t * 1.3));
  const st: [number, number] = [1.08 - 0.16 * pitch, 0.92 + 0.16 * pitch];
  const A = 0.02 + 0.13 * or(p.pitchRange);
  const skewK = 0.16 * (or(p.pitchSkew) - 0.5);
  const centre = 2.2 + 7.5 * or(p.centroid);
  const raw = Array.from({ length: 10 }, (_, i) => Math.exp(-((i + 2 - centre) ** 2) / 3));
  const sum = raw.reduce((a, b) => a + b, 0);
  const w = raw.map((x) => x / sum);
  const tim = ['mfcc1', 'mfcc2', 'mfcc3', 'mfcc4', 'mfcc5', 'mfcc6'].map((k) => or(p[k]));
  const speed = 0.12 + 0.8 * or(p.pitchMotion);
  const ph = w.map((_, i) => TAU * (h1(i * 7.7 + 1.3) + 0.6 * tim[i % 6]! + 0.25 * tim[(i + 2) % 6]!) + t * speed * (i % 2 ? 1 : -1) * (0.3 + h1(i * 3.3) * 0.5));
  const core: [number, number] = [(or(p.f2) - 0.5) * 0.6 * S, -(or(p.f1) - 0.5) * 0.6 * S];
  // 星: 明るい声ほど多く、明るく。縁の近くの決まった場所に
  const n = Math.round(2 + 10 * or(p.centroid));
  const stars: [number, number, number][] = [];
  for (let i = 0; i < 12; i++) {
    if (i >= n) {
      stars.push([0, 0, 0]);
      continue;
    }
    const a = Math.PI * 0.62 + (i ? (h1(i * 4.1) - 0.5) * 3.6 : 0);
    const rr = S * (i ? 0.55 + 0.75 * h1(i * 2.9) : 0.86);
    stars.push([rr * Math.cos(a) * st[0], rr * Math.sin(a) * st[1], (i ? 0.012 + 0.018 * h1(i * 8.3) : 0.04) * (0.6 + 0.6 * or(p.centroid))]);
  }
  return { S, S0, st, A, skewK, w, ph, core, stars, pulse };
}
const rOf = (g: Geo, th: number) => g.S * (1 + g.A * g.w.reduce((s, w, i) => s + w * Math.cos((i + 2) * th + g.ph[i]!), 0) + g.skewK * Math.sin(th));

export interface Voiceprint {
  set(f: Features): void;
  focus(layer: ShapeLayer | null, item: FeatureKey | null): void;
  /** 使い終えた時: WebGL の文脈を手放し、見張りと聞き耳を外す */
  dispose(): void;
}

const LAYER_INDEX: Record<ShapeLayer, number> = { shape: 1, core: 2, mist: 3, orbit: 4, size: 5 };

/** 声紋の色（0〜1 の RGB）。light は明るい画面の時 */
export interface VpPalette {
  low: RGB;
  mid: RGB;
  high: RGB;
  glint: RGB;
  light: boolean;
}
/** 共有カードなどに使う、いつも夜の色（濃い画面の --a3・--a2・--a1） */
export const NIGHT: VpPalette = { low: [0.4, 0.86, 0.92], mid: [0.66, 0.5, 1], high: [1, 0.42, 0.66], glint: [1, 0.97, 0.99], light: false };

interface Renderer {
  /** 描く。WebGL の文脈を失っている間は描かずに null */
  draw(p: ShapeParams, t: number, reveal: number, focus: number, W: number, pal: VpPalette): Geo | null;
  /** 文脈を失っている間は true */
  readonly lost: boolean;
  /** 文脈を手放す（もう描かない） */
  dispose(): void;
}
const NAMES = ['uRes', 'uT', 'uReveal', 'uS', 'uA', 'uSkewK', 'uPitch', 'uMotion', 'uSpacing', 'uBright', 'uHnr', 'uSoft', 'uJit', 'uShim', 'uRate', 'uPause', 'uRhythm', 'uPower', 'uLight', 'uSt', 'uCore', 'uW', 'uPh', 'uTim', 'uStar', 'uLow', 'uMid', 'uHigh', 'uGlint', 'uFocus'];

/**
 * canvas に声紋を描く物（WebGL2 が使えなければ null）。
 * 文脈を失ったら描くのをやめ、戻ったらプログラム・三角形・uniform の場所を作り直して onRestore を呼ぶ。
 */
function makeRenderer(canvas: HTMLCanvasElement, preserve = false, onRestore?: () => void): Renderer | null {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: preserve });
  if (!gl) return null;
  let L: Record<string, WebGLUniformLocation | null> = {},
    lost = false,
    gone = false;
  const setup = (): boolean => {
    const prog = build(gl);
    if (!prog) return false;
    gl.useProgram(prog);
    L = Object.fromEntries(NAMES.map((n) => [n, gl.getUniformLocation(prog, n)]));
    return true;
  };
  if (!setup()) return null;
  const onLost = (e: Event) => {
    // 止めておくと、戻ってくる（webglcontextrestored）
    e.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    if (gone) return;
    lost = !setup();
    if (!lost) onRestore?.();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  const isLost = () => lost || gl.isContextLost();
  return {
    get lost() {
      return isLost();
    },
    dispose() {
      gone = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    },
    draw(p, t, reveal, focus, W, pal) {
      if (isLost()) return null;
      if (canvas.width !== W || canvas.height !== W) canvas.width = canvas.height = W;
      gl.viewport(0, 0, W, W);
      const g = geometry(p, t);
      gl.uniform3fv(L.uLow!, pal.low);
      gl.uniform3fv(L.uMid!, pal.mid);
      gl.uniform3fv(L.uHigh!, pal.high);
      gl.uniform3fv(L.uGlint!, pal.glint);
      gl.uniform1f(L.uLight!, pal.light ? 1 : 0);
      gl.uniform2f(L.uRes!, W, W);
      gl.uniform1f(L.uT!, t);
      gl.uniform1f(L.uReveal!, reveal);
      gl.uniform1f(L.uS!, g.S);
      gl.uniform1f(L.uA!, g.A);
      gl.uniform1f(L.uSkewK!, g.skewK);
      gl.uniform2f(L.uSt!, g.st[0], g.st[1]);
      gl.uniform2f(L.uCore!, g.core[0], g.core[1]);
      gl.uniform1fv(L.uW!, g.w);
      gl.uniform1fv(L.uPh!, g.ph);
      gl.uniform1fv(L.uTim!, Array.from({ length: 13 }, (_, i) => or(p[`mfcc${i + 1}`] ?? null)));
      gl.uniform3fv(L.uStar!, g.stars.flat());
      const set1 = (n: string, v: number) => gl.uniform1f(L[n]!, v);
      set1('uPitch', or(p.pitch));
      set1('uMotion', or(p.pitchMotion));
      set1('uSpacing', or(p.formantSpacing));
      set1('uBright', or(p.centroid));
      set1('uHnr', or(p.hnr));
      set1('uSoft', or(p.h1h2));
      set1('uJit', or(p.jitter, 0));
      set1('uShim', or(p.shimmer, 0));
      set1('uRate', p.rate === null || p.pauseShare === null ? -1 : or(p.rate));
      set1('uPause', or(p.pauseShare));
      set1('uRhythm', or(p.rhythm));
      set1('uPower', or(p.tilt));
      gl.uniform1i(L.uFocus!, focus);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return g;
    },
  };
}

/**
 * 声紋を 1 枚の絵に（共有カード用。いつも同じ時刻・描き出しの後・夜の色）。WebGL2 が無い時・文脈を失っている時は 2D の図。
 * 描いたすぐ後に写すので、描いた物を残す設定は要らない。描き終えたら WebGL の文脈を手放す。
 */
export function renderSnapshot(f: Features, size: number, pal: VpPalette = NIGHT): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d')!;
  const gc = document.createElement('canvas');
  const r = makeRenderer(gc, true);
  const drawn = r?.draw(shapeParams(f), 2.4, 1, 0, size, pal);
  if (drawn) ctx.drawImage(gc, 0, 0);
  r?.dispose();
  if (!drawn) {
    const to255 = (c: RGB): [number, number, number] => [c[0] * 255, c[1] * 255, c[2] * 255];
    drawShape(ctx, size, shapeParams(f), { low: to255(pal.low), mid: to255(pal.mid), high: to255(pal.high), ink: [240, 236, 250], glint: to255(pal.glint), light: pal.light }, { t: 2.4, focus: null });
  }
  return out;
}

/** WebGL2 が使えなければ null（呼んだ側が 2D の図にする） */
export function createVoiceprint(box: HTMLElement): Voiceprint | null {
  const canvas = document.createElement('canvas');
  canvas.className = 'vp-gl';
  canvas.setAttribute('aria-hidden', 'true');
  // 文脈を失っている間は描かない。戻ったら描き直す
  const renderer = makeRenderer(canvas, false, () => wake());
  if (!renderer) return null;
  const over = document.createElement('canvas');
  over.className = 'vp-over';
  over.setAttribute('aria-hidden', 'true');
  box.append(canvas, over);
  const octx = over.getContext('2d')!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  let params: ShapeParams | null = null,
    feats: Features | null = null,
    focusLayer: ShapeLayer | null = null,
    focusItem: FeatureKey | null = null,
    visible = true,
    raf = 0,
    t0 = 0,
    revealStart = 0,
    pal: VpPalette | null = null;

  function colors(): VpPalette {
    const cs = getComputedStyle(box);
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const c = (n: string, fb: RGB) => cssColor(probe, cs.getPropertyValue(n).trim(), fb);
    return { low: c('--a3', [0.4, 0.85, 0.93]), mid: c('--a2', [0.48, 0.3, 1]), high: c('--a1', [0.94, 0.28, 0.56]), glint: dark.matches ? [1, 0.97, 0.99] : [1, 1, 1], light: !dark.matches };
  }
  const onScheme = () => {
    pal = null;
    wake();
  };
  dark.addEventListener('change', onScheme);

  function frame(now: number) {
    raf = 0;
    if (!params || !canvas.isConnected || renderer!.lost) return;
    pal ??= colors();
    if (!t0) t0 = now;
    const still = reduce.matches;
    const t = still ? 0 : (now - t0) / 1000;
    const reveal = still ? 1 : Math.min(1, (now - revealStart) / 2400);
    const d = Math.min(1.75, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(box.clientWidth * d));
    if (over.width !== W || over.height !== W) over.width = over.height = W;
    const g = renderer!.draw(params, t, reveal, focusLayer ? LAYER_INDEX[focusLayer] : 0, W, pal);
    if (!g) return;
    drawCallout(octx, W, d, g, params, reveal);
    if (visible && !document.hidden && (!still || reveal < 1)) raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (!raf && params && visible && !document.hidden && !renderer!.lost) raf = requestAnimationFrame(frame);
  }

  /** 選んだ項目の場所に、印と引き出し線と数字 */
  function drawCallout(ctx: CanvasRenderingContext2D, W: number, d: number, g: Geo, p: ShapeParams, reveal: number) {
    ctx.clearRect(0, 0, W, W);
    if (!focusItem || !feats || reveal < 1) return;
    const X = (qx: number, qy: number): [number, number] => [((qx * g.st[0] + 1) * W) / 2, ((1 - qy * g.st[1]) * W) / 2];
    const XP = (px: number, py: number): [number, number] => [((px + 1) * W) / 2, ((1 - py) * W) / 2];
    const polar = (th: number, r: number) => X(r * Math.cos(th), r * Math.sin(th));
    const cs = getComputedStyle(box);
    const ink = cs.getPropertyValue('--ink').trim() || '#fff';
    const accent = cs.getPropertyValue('--a1').trim() || '#f48';
    const k = focusItem;
    let at: [number, number];
    const extra: (() => void)[] = [];
    const dashCircle = (r: number) => () => {
      ctx.setLineDash([4 * d, 5 * d]);
      ctx.beginPath();
      ctx.ellipse(W / 2, W / 2, ((r * g.st[0]) * W) / 2, ((r * g.st[1]) * W) / 2, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    switch (k) {
      case 'pitch':
        at = polar(Math.PI / 2, rOf(g, Math.PI / 2));
        break;
      case 'pitchRange': {
        let best = 0,
          bt = 0;
        for (let i = 0; i < 72; i++) {
          const th = (i / 72) * TAU;
          const dv = Math.abs(rOf(g, th) / g.S - 1 - g.skewK * Math.sin(th));
          if (dv > best) {
            best = dv;
            bt = th;
          }
        }
        at = polar(bt, rOf(g, bt));
        break;
      }
      case 'pitchSkew':
        at = polar(g.skewK >= 0 ? Math.PI / 2 : -Math.PI / 2, rOf(g, g.skewK >= 0 ? Math.PI / 2 : -Math.PI / 2));
        break;
      case 'pitchMotion':
        at = polar(-Math.PI * 0.15, rOf(g, -Math.PI * 0.15) * 0.8);
        break;
      case 'f1':
      case 'f2': {
        at = X(g.core[0], g.core[1]);
        const [cx, cy] = at;
        extra.push(() => {
          ctx.setLineDash([3 * d, 4 * d]);
          ctx.beginPath();
          if (k === 'f1') {
            ctx.moveTo(cx, W / 2 - (g.S * g.st[1] * W) / 2);
            ctx.lineTo(cx, W / 2 + (g.S * g.st[1] * W) / 2);
          } else {
            ctx.moveTo(W / 2 - (g.S * g.st[0] * W) / 2, cy);
            ctx.lineTo(W / 2 + (g.S * g.st[0] * W) / 2, cy);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        });
        break;
      }
      case 'formantSpacing':
        at = polar(-Math.PI / 4, rOf(g, -Math.PI / 4) * 0.62);
        break;
      case 'centroid':
        at = XP(g.stars[0]![0], g.stars[0]![1]);
        break;
      case 'mfcc2': {
        // リボンの上の端: いちばん低い音
        let e = 0;
        for (let k = 1; k <= 13; k++) e += (or(p[`mfcc${k}`] ?? null) - 0.5) * 2 * (1 / (1 + 0.3 * k)) * Math.cos((Math.PI * k * 0.5) / 26);
        const off = 0.5 + 0.5 * Math.tanh(e * 1.6);
        at = XP(0, g.S * (1.15 + g.A) + 0.015 + ((0.03 + 0.2 * off) * g.S) / 0.42);
        break;
      }
      case 'hnr':
        at = polar(Math.PI * 0.82, rOf(g, Math.PI * 0.82) * 1.16);
        break;
      case 'h1h2':
        at = polar(Math.PI, rOf(g, Math.PI) * 0.5);
        break;
      case 'jitter':
        at = polar(-Math.PI * 0.62, rOf(g, -Math.PI * 0.62) * 0.72);
        break;
      case 'shimmer':
        at = polar(Math.PI * 0.22, rOf(g, Math.PI * 0.22) * 1.06);
        break;
      case 'rate':
      case 'pauseShare':
      case 'rhythm':
        at = XP(0, -0.885);
        break;
      case 'tilt':
        at = polar(0, rOf(g, 0));
        extra.push(dashCircle(g.S0));
        break;
      case 'levelRange':
        at = polar(0, g.S0 * (1 + g.pulse));
        extra.push(dashCircle(g.S0 * (1 + g.pulse)), dashCircle(g.S0 * (1 - g.pulse)));
        break;
      default:
        return;
    }
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.2 * d;
    for (const f of extra) f();
    // 印
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2 * d;
    ctx.beginPath();
    ctx.arc(at[0], at[1], 7 * d, 0, TAU);
    ctx.stroke();
    // ラベル: 印のある側に置く
    const name = k === 'mfcc2' ? t('音色', 'Timbre') : FEATURE_BY_KEY[k].name;
    const val = k === 'mfcc2' ? 'MFCC 1–13' : formatFeature(k, feats[k]);
    const word = k === 'mfcc2' ? '' : levelWord(k, feats[k]);
    const right = at[0] >= W / 2;
    const fs = Math.max(11, Math.min(15, W / d / 30)) * d;
    ctx.font = `700 ${fs}px ${getComputedStyle(document.body).fontFamily}`;
    const t1 = `${name}  ${val}`;
    const t2 = word;
    const tw = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + fs * 1.4;
    const th = fs * (t2 ? 3.1 : 1.9);
    const lx = right ? Math.min(W - tw - 6 * d, at[0] + 34 * d) : Math.max(6 * d, at[0] - 34 * d - tw);
    const ly = Math.max(6 * d, Math.min(W - th - 6 * d, at[1] - th - 18 * d));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4 * d;
    ctx.beginPath();
    ctx.moveTo(at[0] + (right ? 6 : -6) * d, at[1] - 4 * d);
    ctx.lineTo(right ? lx : lx + tw, ly + th / 2);
    ctx.stroke();
    ctx.fillStyle = cs.getPropertyValue('--surface-solid').trim() || '#111';
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    roundRectPath(ctx, lx, ly, tw, th, 8 * d);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.textBaseline = 'top';
    ctx.fillText(t1, lx + fs * 0.7, ly + fs * 0.45);
    if (t2) {
      ctx.globalAlpha = 0.75;
      ctx.font = `600 ${fs * 0.9}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.fillText(t2, lx + fs * 0.7, ly + fs * 1.75);
      ctx.globalAlpha = 1;
    }
  }

  const io = new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting);
    wake();
  });
  io.observe(box);
  document.addEventListener('visibilitychange', wake);
  const ro = new ResizeObserver(wake);
  ro.observe(box);

  return {
    set(f) {
      const first = !params;
      params = shapeParams(f);
      feats = f;
      if (first) {
        revealStart = performance.now();
        t0 = 0;
      }
      box.setAttribute('aria-label', `${t('声紋の図。', 'Voiceprint. ')}${SHAPE_LAYERS.flatMap((l) => l.items.filter((i) => !i.key.startsWith('mfcc')).map((i) => `${FEATURE_BY_KEY[i.key].name} ${formatFeature(i.key, f[i.key])}`)).join(t('、', ', '))}`);
      wake();
    },
    focus(layer, item) {
      focusLayer = layer;
      focusItem = item;
      wake();
    },
    dispose() {
      cancelAnimationFrame(raf);
      raf = 0;
      params = null;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', wake);
      dark.removeEventListener('change', onScheme);
      renderer.dispose();
    },
  };
}

/** 角の丸い四角の道。roundRect の無いブラウザー（Safari 16 より前）では arcTo で */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function build(gl: WebGL2RenderingContext): WebGLProgram | null {
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
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(p, 'a');
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  return p;
}

/** 箱に、声紋を並べる（あなた・1 位の声、お手本・あなた など）。同じ数なら使い回す。WebGL2 が無ければ 2D の図 */
const mounted = new WeakMap<HTMLElement, { views: ShapeView[]; caps: HTMLElement[] }>();
export function mountShapes(box: HTMLElement, guide: HTMLElement, entries: readonly { who: string; sub?: string; f: Features }[]): void {
  let m = mounted.get(box);
  if (!m || m.views.length !== entries.length) {
    // 数が変わった時は、前の図を手放す（WebGL の文脈・見張り・聞き耳）。残すと、文脈がたまっていく
    for (const v of m?.views ?? []) v.dispose();
    const views: ShapeView[] = [],
      caps: HTMLElement[] = [],
      figs: HTMLElement[] = [];
    box.replaceChildren();
    for (let i = 0; i < entries.length; i++) {
      const fig = document.createElement('figure');
      fig.className = 'shape-fig';
      const stage = document.createElement('div');
      stage.className = 'vp-stage';
      stage.setAttribute('role', 'img');
      const cap = document.createElement('figcaption');
      fig.append(stage, cap);
      box.append(fig);
      figs.push(fig);
      caps.push(cap);
      const vp = createVoiceprint(stage);
      if (vp) views.push(vp);
      else {
        const c = document.createElement('canvas');
        c.className = 'shape-canvas';
        stage.append(c);
        views.push(createShapeView(c));
      }
    }
    m = { views, caps };
    mounted.set(box, m);
  }
  entries.forEach((e, i) => {
    m!.views[i]!.set(e.f);
    const who = document.createElement('b');
    who.textContent = e.who;
    m!.caps[i]!.replaceChildren(who);
    if (e.sub) {
      const s = document.createElement('span');
      s.textContent = e.sub;
      m!.caps[i]!.append(s);
    }
  });
  renderGuide(guide, m.views, entries.map((e) => ({ who: e.who, f: e.f })));
}
