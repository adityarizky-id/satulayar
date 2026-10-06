"use client";

import { useEffect, useRef, useState } from "react";

interface VideoStageBackdropProps {
  videoSrc?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  maxAlpha: number;
  decay: number;
  sizeDecay: number;
  color: string;
}

interface TrailPoint {
  x: number;
  y: number;
  age: number;
  maxAge: number;
  radius: number;
}

const DEFAULT_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260324_151826_c7218672-6e92-402c-9e45-f1e0f454bdc4.mp4";

export function VideoStageBackdrop({ videoSrc = DEFAULT_VIDEO }: VideoStageBackdropProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.play().catch(() => {
      // Autoplay with muted might still need explicit resume on user interaction
    });
  }, [videoSrc]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const stage = container.closest<HTMLElement>(".auth-stage") || container;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animFrame: number;
    let width = 0;
    let height = 0;
    let dpr = 1;

    // Smooth cursor follower physics
    const mouse = { x: -1000, y: -1000, targetX: -1000, targetY: -1000, active: false, speed: 0 };
    const lastMouse = { x: -1000, y: -1000 };

    const particles: Particle[] = [];
    const trailPoints: TrailPoint[] = [];

    const PALETTE = [
      "rgba(52, 211, 153, ", // Emerald / Mint #34d399
      "rgba(16, 185, 129, ", // Green #10b981
      "rgba(110, 231, 183, ", // Light Emerald #6ee7b7
      "rgba(167, 243, 208, ", // Pale Mint #a7f3d0
      "rgba(255, 255, 255, ", // Bright Specular
    ];

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.scale(dpr, dpr);
    };

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(stage);
    resize();

    const handlePointerMove = (e: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (x < 0 || y < 0 || x > width || y > height) {
        mouse.active = false;
        return;
      }

      if (!mouse.active) {
        mouse.x = x;
        mouse.y = y;
        mouse.targetX = x;
        mouse.targetY = y;
      } else {
        mouse.targetX = x;
        mouse.targetY = y;
      }

      mouse.active = true;

      // Calculate movement delta & velocity
      const dx = x - (lastMouse.x === -1000 ? x : lastMouse.x);
      const dy = y - (lastMouse.y === -1000 ? y : lastMouse.y);
      const dist = Math.hypot(dx, dy);
      mouse.speed = dist;

      // Add fluid trail point
      trailPoints.unshift({
        x,
        y,
        age: 0,
        maxAge: Math.min(40 + dist * 0.6, 70),
        radius: Math.min(32 + dist * 0.45, 80),
      });

      // Cap trail points
      if (trailPoints.length > 60) {
        trailPoints.pop();
      }

      // Spawn luminous motes/particles based on cursor speed
      const spawnCount = Math.min(Math.floor(dist / 3) + 1, 6);
      for (let i = 0; i < spawnCount; i++) {
        if (particles.length < 150) {
          const angle = Math.random() * Math.PI * 2;
          const speed = (Math.random() * 1.8 + 0.6) * (dist * 0.04 + 0.6);
          const colorBase = PALETTE[Math.floor(Math.random() * PALETTE.length)];
          const maxAlpha = Math.random() * 0.65 + 0.35;

          particles.push({
            x: x + (Math.random() - 0.5) * 14,
            y: y + (Math.random() - 0.5) * 14,
            vx: Math.cos(angle) * speed + (dx * 0.08),
            vy: Math.sin(angle) * speed + (dy * 0.08) - 0.35, // Slight upward drift
            radius: Math.random() * 2.8 + 1.2,
            alpha: maxAlpha,
            maxAlpha,
            decay: Math.random() * 0.016 + 0.01,
            sizeDecay: Math.random() * 0.012 + 0.005,
            color: colorBase,
          });
        }
      }

      lastMouse.x = x;
      lastMouse.y = y;
    };

    const handlePointerLeave = () => {
      mouse.active = false;
    };

    const handlePointerDown = (e: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Ripple burst on click
      for (let i = 0; i < 28; i++) {
        const angle = (i / 28) * Math.PI * 2 + (Math.random() * 0.2);
        const speed = Math.random() * 3.5 + 2;
        const colorBase = PALETTE[Math.floor(Math.random() * PALETTE.length)];

        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: Math.random() * 3.5 + 1.5,
          alpha: 0.9,
          maxAlpha: 0.9,
          decay: Math.random() * 0.02 + 0.012,
          sizeDecay: 0.018,
          color: colorBase,
        });
      }
    };

    stage.addEventListener("pointermove", handlePointerMove, { passive: true });
    stage.addEventListener("pointerleave", handlePointerLeave, { passive: true });
    stage.addEventListener("pointerdown", handlePointerDown, { passive: true });

    // Main animation loop
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Smooth cursor follower physics
      if (mouse.active) {
        mouse.x += (mouse.targetX - mouse.x) * 0.2;
        mouse.y += (mouse.targetY - mouse.y) * 0.2;
      }

      // Use screen blend mode for glowing, luminous sheen over dark video
      ctx.globalCompositeOperation = "screen";

      // 1. Draw smooth fluid luminous ribbon & trail glows
      for (let i = trailPoints.length - 1; i >= 0; i--) {
        const pt = trailPoints[i];
        pt.age++;

        if (pt.age >= pt.maxAge) {
          trailPoints.splice(i, 1);
          continue;
        }

        const progress = pt.age / pt.maxAge;
        const lifeAlpha = (1 - progress) * 0.32;
        const currentRadius = pt.radius * (1 + progress * 0.5);

        // Soft emerald radial glow
        const glow = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, currentRadius);
        glow.addColorStop(0, `rgba(52, 211, 153, ${lifeAlpha * 0.95})`);
        glow.addColorStop(0.35, `rgba(16, 185, 129, ${lifeAlpha * 0.5})`);
        glow.addColorStop(0.7, `rgba(6, 78, 59, ${lifeAlpha * 0.18})`);
        glow.addColorStop(1, "rgba(6, 78, 59, 0)");

        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, currentRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Draw connecting spline for luminous trail ribbon
      if (trailPoints.length > 2) {
        ctx.beginPath();
        ctx.moveTo(trailPoints[0].x, trailPoints[0].y);

        for (let i = 1; i < trailPoints.length - 1; i++) {
          const xc = (trailPoints[i].x + trailPoints[i + 1].x) / 2;
          const yc = (trailPoints[i].y + trailPoints[i + 1].y) / 2;
          ctx.quadraticCurveTo(trailPoints[i].x, trailPoints[i].y, xc, yc);
        }

        ctx.strokeStyle = "rgba(110, 231, 183, 0.22)";
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.stroke();
      }

      // 3. Draw active cursor spotlight aura
      if (mouse.active && mouse.x > 0 && mouse.y > 0) {
        const haloRadius = 160;
        const halo = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, haloRadius);
        halo.addColorStop(0, "rgba(52, 211, 153, 0.25)");
        halo.addColorStop(0.25, "rgba(16, 185, 129, 0.14)");
        halo.addColorStop(0.6, "rgba(5, 150, 105, 0.05)");
        halo.addColorStop(1, "rgba(5, 150, 105, 0)");

        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, haloRadius, 0, Math.PI * 2);
        ctx.fill();

        // Core bright cursor dot
        const core = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 18);
        core.addColorStop(0, "rgba(255, 255, 255, 0.75)");
        core.addColorStop(0.3, "rgba(167, 243, 208, 0.5)");
        core.addColorStop(1, "rgba(52, 211, 153, 0)");

        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, 18, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. Update and draw floating particles / motes
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.alpha -= p.decay;
        p.radius = Math.max(0.2, p.radius - p.sizeDecay);

        if (p.alpha <= 0 || p.radius <= 0.2) {
          particles.splice(i, 1);
          continue;
        }

        const particleGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 2);
        particleGrad.addColorStop(0, `${p.color}${p.alpha})`);
        particleGrad.addColorStop(0.6, `${p.color}${p.alpha * 0.4})`);
        particleGrad.addColorStop(1, `${p.color}0)`);

        ctx.fillStyle = particleGrad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "source-over";
      animFrame = requestAnimationFrame(render);
    };

    animFrame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animFrame);
      resizeObserver.disconnect();
      stage.removeEventListener("pointermove", handlePointerMove);
      stage.removeEventListener("pointerleave", handlePointerLeave);
      stage.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  return (
    <div className="auth-stage-backdrop" ref={containerRef}>
      {/* 1. Fluid Silk Video Background */}
      <video
        ref={videoRef}
        className={`auth-stage-backdrop__video ${videoLoaded ? "auth-stage-backdrop__video--ready" : ""}`}
        src={videoSrc}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        onLoadedData={() => setVideoLoaded(true)}
      />

      {/* 2. Interactive Mouse Trail & Glow Canvas */}
      <canvas ref={canvasRef} className="auth-stage-backdrop__canvas" aria-hidden="true" />

      {/* 3. High-Fidelity Cinematic Film Grain Overlay */}
      <div className="auth-stage-backdrop__grain" aria-hidden="true" />

      {/* 4. Ambient Vignette & Deep Contrast Tint */}
      <div className="auth-stage-backdrop__vignette" aria-hidden="true" />
    </div>
  );
}
