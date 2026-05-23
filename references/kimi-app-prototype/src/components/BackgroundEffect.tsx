import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const NODE_COUNT = 50;
const MAX_CONNECTION_DISTANCE = 120;
const CONNECTION_OPACITY = 0.12;

interface ParticleData {
  velocity: THREE.Vector3;
  originalPos: THREE.Vector3;
}

export function BackgroundEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x050505, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(
      -window.innerWidth / 2,
      window.innerWidth / 2,
      window.innerHeight / 2,
      -window.innerHeight / 2,
      1,
      1000
    );
    camera.position.z = 500;

    // Create nodes
    const nodes: THREE.Mesh[] = [];
    const particlesData: ParticleData[] = [];
    const nodeGeom = new THREE.CircleGeometry(1.8, 8);
    const nodeMat = new THREE.MeshBasicMaterial({
      color: 0x008f7a,
      transparent: true,
      opacity: 0.6,
    });

    for (let i = 0; i < NODE_COUNT; i++) {
      const mesh = new THREE.Mesh(nodeGeom, nodeMat.clone());
      mesh.position.set(
        (Math.random() - 0.5) * window.innerWidth,
        (Math.random() - 0.5) * window.innerHeight,
        0
      );
      scene.add(mesh);
      nodes.push(mesh);
      particlesData.push({
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3,
          0
        ),
        originalPos: mesh.position.clone(),
      });
    }

    // Line geometry for connections
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x008f7a,
      transparent: true,
      opacity: CONNECTION_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const lineGeometry = new THREE.BufferGeometry();
    const linePositions = new Float32Array(NODE_COUNT * NODE_COUNT * 6);
    lineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(linePositions, 3)
    );
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lines);

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX - window.innerWidth / 2, y: -(e.clientY - window.innerHeight / 2) };
    };

    window.addEventListener('mousemove', handleMouseMove);

    const clock = new THREE.Clock();

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      clock.getDelta();
      const time = clock.getElapsedTime();

      // Update nodes
      for (let i = 0; i < NODE_COUNT; i++) {
        const node = nodes[i];
        const data = particlesData[i];

        // Brownian motion
        node.position.x += data.velocity.x + Math.sin(time * 0.5 + i) * 0.1;
        node.position.y += data.velocity.y + Math.cos(time * 0.3 + i) * 0.1;

        // Boundary wrap
        const halfW = window.innerWidth / 2;
        const halfH = window.innerHeight / 2;
        if (node.position.x > halfW) node.position.x = -halfW;
        if (node.position.x < -halfW) node.position.x = halfW;
        if (node.position.y > halfH) node.position.y = -halfH;
        if (node.position.y < -halfH) node.position.y = halfH;

        // Mouse repulsion
        const dx = node.position.x - mouseRef.current.x;
        const dy = node.position.y - mouseRef.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150 && dist > 0) {
          const force = (150 - dist) / 150;
          node.position.x += (dx / dist) * force * 2;
          node.position.y += (dy / dist) * force * 2;
        }

        // Pulse opacity
        const mat = node.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.3 + Math.sin(time * 2 + i * 0.5) * 0.2;
      }

      // Update connections
      let lineIdx = 0;
      const positions = lines.geometry.attributes.position.array as Float32Array;

      for (let i = 0; i < NODE_COUNT; i++) {
        for (let j = i + 1; j < NODE_COUNT; j++) {
          const dx = nodes[i].position.x - nodes[j].position.x;
          const dy = nodes[i].position.y - nodes[j].position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < MAX_CONNECTION_DISTANCE) {
            positions[lineIdx++] = nodes[i].position.x;
            positions[lineIdx++] = nodes[i].position.y;
            positions[lineIdx++] = 0;
            positions[lineIdx++] = nodes[j].position.x;
            positions[lineIdx++] = nodes[j].position.y;
            positions[lineIdx++] = 0;
          }
        }
      }

      // Zero out remaining positions
      for (let k = lineIdx; k < positions.length; k++) {
        positions[k] = 0;
      }

      lines.geometry.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.left = -window.innerWidth / 2;
      camera.right = window.innerWidth / 2;
      camera.top = window.innerHeight / 2;
      camera.bottom = -window.innerHeight / 2;
      camera.updateProjectionMatrix();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      scene.clear();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full"
      style={{ zIndex: 0 }}
    />
  );
}
