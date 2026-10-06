"use client";

// Silk backdrop. The shader is react-bits "Silk" (MIT), ported from
// @react-three/fiber to ogl so it reuses the renderer already installed here
// instead of pulling in three (~600kb) for one full-screen plane.
// Local additions: reduced-motion still frame, WebGL context disposal.
import { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle, Vec3, type OGLRenderingContext } from "ogl";

const vertex = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `
#ifdef GL_ES
precision highp float;
#endif

varying vec2 vUv;

uniform float uTime;
uniform vec3  uColor;
uniform float uSpeed;
uniform float uScale;
uniform float uRotation;
uniform float uNoiseIntensity;

const float e = 2.71828182845904523536;

float noise(vec2 texCoord) {
  float G = e;
  vec2  r = (G * sin(G * texCoord));
  return fract(r.x * r.y * (1.0 + texCoord.x));
}

vec2 rotateUvs(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2  rot = mat2(c, -s, s, c);
  return rot * uv;
}

void main() {
  float rnd     = noise(gl_FragCoord.xy);
  vec2  uv      = rotateUvs(vUv * uScale, uRotation);
  vec2  tex     = uv * uScale;
  float tOffset = uSpeed * uTime;

  tex.y += 0.03 * sin(8.0 * tex.x - tOffset);

  float pattern = 0.6 +
                  0.4 * sin(5.0 * (tex.x + tex.y +
                                   cos(3.0 * tex.x + 5.0 * tex.y) +
                                   0.02 * tOffset) +
                           sin(20.0 * (tex.x + tex.y - 0.1 * tOffset)));

  vec4 col = vec4(uColor, 1.0) * vec4(pattern) - rnd / 15.0 * uNoiseIntensity;
  gl_FragColor = vec4(col.rgb, 1.0);
}
`;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

type Props = {
  color?: string;
  speed?: number;
  scale?: number;
  rotation?: number;
  noiseIntensity?: number;
};

export function Silk({
  color = "#2f3a34",
  speed = 5,
  scale = 1,
  rotation = 0,
  noiseIntensity = 1.5,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    let renderer: Renderer | null = null;
    let gl: OGLRenderingContext | null = null;
    let frame = 0;
    let observer: ResizeObserver | null = null;

    try {
      renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio, 2), canvas });
      gl = renderer.gl;
      if (!gl) return;

      const program = new Program(gl, {
        vertex,
        fragment,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new Vec3(...hexToRgb(color)) },
          uSpeed: { value: speed },
          uScale: { value: scale },
          uRotation: { value: rotation },
          uNoiseIntensity: { value: noiseIntensity },
        },
      });
      const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

      // ogl's setSize writes an inline pixel width/height that outranks the
      // stylesheet, so the canvas would stay frozen at whatever the panel
      // measured first. Keep the drawing buffer from ogl, hand the displayed
      // size back to CSS.
      const resize = (width: number, height: number) => {
        if (!renderer) return;
        renderer.setSize(Math.max(1, width), Math.max(1, height));
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        renderer.render({ scene: mesh });
      };

      // The panel resizes with the layout, not only with the window.
      observer = new ResizeObserver(([entry]) => {
        resize(entry.contentRect.width, entry.contentRect.height);
      });
      observer.observe(parent);
      resize(parent.clientWidth, parent.clientHeight);

      const start = performance.now();

      // Reduced motion keeps the artwork and freezes it on a single frame.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        renderer.render({ scene: mesh });
      } else {
        const loop = () => {
          program.uniforms.uTime.value = ((performance.now() - start) / 1000) * 0.1;
          renderer?.render({ scene: mesh });
          frame = requestAnimationFrame(loop);
        };
        loop();
      }
    } catch {
      // Fallback gracefully on environments without WebGL support
      return;
    }

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      // Browsers cap concurrent WebGL contexts; release ours on navigation.
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [color, speed, scale, rotation, noiseIntensity]);

  return <canvas aria-hidden className="veil-canvas" ref={ref} />;
}
