import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ImpactBurst } from '../types/chess';

export const AmbientMotes: React.FC = () => {
  const pointsRef = useRef<THREE.Points>(null);
  const { positions, drift } = useMemo(() => {
    const positions = new Float32Array(150 * 3);
    const drift = new Float32Array(150 * 3);
    for (let i = 0; i < 150; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 13;
      positions[i * 3 + 1] = 0.15 + Math.random() * 5.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 13;
      drift[i * 3] = 0.2 + Math.random() * 0.5;
      drift[i * 3 + 1] = 0.15 + Math.random() * 0.35;
      drift[i * 3 + 2] = 0.1 + Math.random() * 0.4;
    }
    return { positions, drift };
  }, []);

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) return;
    const position = points.geometry.attributes.position;
    const array = position.array as Float32Array;
    const elapsed = clock.getElapsedTime();
    for (let i = 0; i < 150; i += 1) {
      const phase = elapsed * drift[i * 3] + i * 0.41;
      array[i * 3] += Math.sin(phase * 0.71) * 0.0008;
      array[i * 3 + 1] += drift[i * 3 + 1] * 0.0018;
      array[i * 3 + 2] += Math.cos(phase * 0.49) * 0.0007;
      if (array[i * 3 + 1] > 5.9) array[i * 3 + 1] = 0.12;
    }
    position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#e0c274" size={0.03} transparent opacity={0.48} depthWrite={false} sizeAttenuation />
    </points>
  );
};

interface ImpactVisualProps {
  burst: ImpactBurst;
}

export const ImpactVisual: React.FC<ImpactVisualProps> = ({ burst }) => {
  const dustRef = useRef<THREE.Points>(null);
  const sparksRef = useRef<THREE.Points>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const dustMaterial = useRef<THREE.PointsMaterial>(null);
  const sparkMaterial = useRef<THREE.PointsMaterial>(null);
  const data = useMemo(() => {
    const dust = new Float32Array(62 * 3);
    const sparks = new Float32Array(28 * 3);
    const dustVelocity: [number, number, number][] = [];
    const sparkVelocity: [number, number, number][] = [];
    for (let i = 0; i < 62; i += 1) {
      dust[i * 3] = 0;
      dust[i * 3 + 1] = 0.08;
      dust[i * 3 + 2] = 0;
      const angle = Math.random() * Math.PI * 2;
      const velocity = 0.6 + Math.random() * 2.2;
      dustVelocity.push([Math.cos(angle) * velocity, 0.35 + Math.random() * 1.6, Math.sin(angle) * velocity]);
    }
    for (let i = 0; i < 28; i += 1) {
      sparks[i * 3] = 0;
      sparks[i * 3 + 1] = 0.16;
      sparks[i * 3 + 2] = 0;
      const angle = Math.random() * Math.PI * 2;
      const velocity = 1.2 + Math.random() * 3.6;
      sparkVelocity.push([Math.cos(angle) * velocity, 0.8 + Math.random() * 2.8, Math.sin(angle) * velocity]);
    }
    return { dust, sparks, dustVelocity, sparkVelocity };
  }, [burst.id]);

  useFrame(() => {
    const life = Math.min(1, Math.max(0, (Date.now() - burst.startedAt) / 1500));
    const dust = dustRef.current?.geometry.attributes.position;
    const sparks = sparksRef.current?.geometry.attributes.position;
    if (dust) {
      const array = dust.array as Float32Array;
      for (let i = 0; i < data.dustVelocity.length; i += 1) {
        const velocity = data.dustVelocity[i];
        array[i * 3] = velocity[0] * life * (0.75 + life);
        array[i * 3 + 1] = 0.08 + velocity[1] * life - 1.1 * life * life;
        array[i * 3 + 2] = velocity[2] * life * (0.75 + life);
      }
      dust.needsUpdate = true;
    }
    if (sparks) {
      const array = sparks.array as Float32Array;
      for (let i = 0; i < data.sparkVelocity.length; i += 1) {
        const velocity = data.sparkVelocity[i];
        array[i * 3] = velocity[0] * life;
        array[i * 3 + 1] = 0.16 + velocity[1] * life - 2.3 * life * life;
        array[i * 3 + 2] = velocity[2] * life;
      }
      sparks.needsUpdate = true;
    }
    if (ringRef.current) {
      ringRef.current.scale.setScalar(0.15 + life * 2.3);
      const material = ringRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = (1 - life) * 0.72;
    }
    if (dustMaterial.current) dustMaterial.current.opacity = (1 - life) * 0.34;
    if (sparkMaterial.current) sparkMaterial.current.opacity = (1 - life) * 0.92;
  });

  return (
    <group position={burst.position}>
      <points ref={dustRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.dust, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={dustMaterial} color="#9f9081" size={0.16} transparent opacity={0.34} depthWrite={false} sizeAttenuation />
      </points>
      <points ref={sparksRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.sparks, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={sparkMaterial} color="#e1b069" size={0.075} transparent opacity={0.92} depthWrite={false} sizeAttenuation />
      </points>
      <mesh ref={ringRef} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.85, 0.91, 48]} />
        <meshBasicMaterial color="#c9924e" transparent opacity={0.72} depthWrite={false} />
      </mesh>
    </group>
  );
};
