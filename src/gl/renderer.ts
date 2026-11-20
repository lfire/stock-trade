// WebGL2 单 context + scissor 多 pane 渲染器。
// 整个 <stock-chart> 只有一个 canvas / 一个 context，避免浏览器 context 数量上限。
import { rgba } from './geometry';
import { PALETTE } from '../types';
import { emitEvent, CHART_EVENTS } from '../events';

const VS = `#version 300 es
in vec2 a_position;
in vec4 a_color;
uniform vec2 u_resolution;
out vec4 v_color;
void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}`;

const FS = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() { outColor = v_color; }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${msg}`);
  }
  return sh;
}

export class WebGL2Renderer {
  declare canvas: HTMLCanvasElement;
  declare gl: WebGL2RenderingContext | null;
  declare width: number;
  declare height: number;
  declare dpr: number;
  declare lost: boolean;
  declare program: WebGLProgram | null;
  declare vbo: WebGLBuffer | null;
  declare onContextLost: (e: Event) => void;
  declare onContextRestored: () => void;
  declare aPos: number;
  declare aColor: number;
  declare uRes: WebGLUniformLocation | null;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!this.gl) throw new Error('WebGL2 不可用');
    this.width = 1; this.height = 1; this.dpr = 1;
    this.lost = false;
    this.program = null; this.vbo = null;
    this.initGL();

    // 具名监听，destroy() 可配平移除；否则卸载后 canvas 仍被闭包引用
    this.onContextLost = (e) => {
      e.preventDefault();
      this.lost = true;
      emitEvent(canvas, CHART_EVENTS.WEBGL_CONTEXT_LOST, {});
    };
    this.onContextRestored = () => {
      // context lost 后 program / VBO / attrib / uniform 句柄全部失效，必须重建；
      // 只置 lost=false 会导致恢复后永久黑屏（旧句柄 drawArrays 无效）。
      try {
        this.initGL();
        this.lost = false;
        emitEvent(canvas, CHART_EVENTS.WEBGL_CONTEXT_RESTORED, {});
      } catch (e: unknown) {
        emitEvent(canvas, CHART_EVENTS.CHART_ERROR, { message: `WebGL 上下文恢复失败：${(e as Error).message}` });
      }
    };
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  /** 建立（或在 restored 后重建）着色器程序、VBO 与 location */
  initGL() {
    const gl = this.gl;
    if (!gl) return;
    // lost 状态下删除旧句柄是安全的 no-op；正常重建时也能避免泄漏
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.program) gl.deleteProgram(this.program);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link failed: ${gl.getProgramInfoLog(prog)}`);
    this.program = prog;
    this.vbo = gl.createBuffer();
    this.aPos = gl.getAttribLocation(prog, 'a_position');
    this.aColor = gl.getAttribLocation(prog, 'a_color');
    this.uRes = gl.getUniformLocation(prog, 'u_resolution');
  }

  resize(width: number, height: number, dpr: number = window.devicePixelRatio || 1) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  /** @param {{rect:{x:number,y:number,w:number,h:number}, vertices:number[]}[]} panes */
  render(panes: Array<{ rect: { x: number; y: number; w: number; h: number }; vertices: number[] }>) {
    if (this.lost) return;
    const gl = this.gl!;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    // 清屏色随当前主题动态取，避免换肤后未绘制区域残留白块
    const clear = rgba(PALETTE.background);
    gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    let total = 0;
    for (const p of panes) total += p.vertices.length;
    if (total === 0) return;

    const data = new Float32Array(total);
    const batches = [];
    let off = 0;
    for (const p of panes) {
      const v = p.vertices;
      for (let i = 0; i < v.length; i += 1) data[off + i] = v[i];
      batches.push({ first: off / 6, count: v.length / 6, rect: p.rect });
      off += v.length;
    }

    gl.useProgram(this.program);
    gl.uniform2f(this.uRes, this.width, this.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.aColor);
    gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, stride, 2 * 4);

    gl.enable(gl.SCISSOR_TEST);
    for (const b of batches) {
      const { x, y, w, h } = b.rect;
      const sx = Math.round(x * this.dpr);
      const sy = Math.round((this.height - y - h) * this.dpr);
      gl.scissor(sx, sy, Math.max(0, Math.round(w * this.dpr)), Math.max(0, Math.round(h * this.dpr)));
      gl.drawArrays(gl.TRIANGLES, b.first, b.count);
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  destroy() {
    // 先摘监听，避免 loseContext() 触发的 lost 事件被误派发到页面错误框
    this.canvas?.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas?.removeEventListener('webglcontextrestored', this.onContextRestored);
    const gl = this.gl;
    if (!gl) return;
    gl.deleteBuffer(this.vbo);
    gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// 已移除废弃的 CLEAR 常量：清屏色在 render() 中按 PALETTE.background 动态取，全仓无引用。
