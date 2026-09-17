import React, { useMemo } from 'react';
import { RigidBody } from '@react-three/rapier';
import { createStoneMaterial } from './ProceduralChessPieces';
import type { PieceColor, PieceKind } from '../types/chess';

interface FractureProps {
  id: number;
  position: [number, number, number];
  color: PieceColor;
  kind: PieceKind;
}

interface Shard {
  offset: [number, number, number];
  size: [number, number, number];
  impulse: [number, number, number];
  torque: [number, number, number];
  rotation: [number, number, number];
}

const seeded = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const FracturedPiece: React.FC<FractureProps> = ({ id, position, color, kind }) => {
  const material = useMemo(() => createStoneMaterial(color), [color]);
  const shards = useMemo<Shard[]>(() => {
    const random = seeded(id * 97 + kind.length * 13);
    const count = kind === 'king' || kind === 'queen' ? 22 : 16;
    return Array.from({ length: count }, (_, index) => {
      const angle = random() * Math.PI * 2;
      const radius = 0.12 + random() * 0.44;
      const height = random() * (kind === 'pawn' ? 0.80 : 1.58);
      return {
        offset: [Math.cos(angle) * radius, 0.12 + height, Math.sin(angle) * radius] as [number, number, number],
        size: [0.08 + random() * 0.18, 0.08 + random() * 0.22, 0.08 + random() * 0.18] as [number, number, number],
        impulse: [
          Math.cos(angle) * (1.8 + random() * 4.2),
          2.5 + random() * 5.5,
          Math.sin(angle) * (1.8 + random() * 4.2),
        ] as [number, number, number],
        torque: [
          (random() - 0.5) * 14,
          (random() - 0.5) * 14,
          (random() - 0.5) * 14,
        ] as [number, number, number],
        rotation: [random() * Math.PI, random() * Math.PI, random() * Math.PI] as [number, number, number],
      };
    });
  }, [id, kind]);

  return (
    <group position={position}>
      {shards.map((shard, index) => (
        <RigidBody
          key={`${id}-${index}`}
          position={shard.offset}
          rotation={shard.rotation}
          colliders="cuboid"
          restitution={0.18}
          friction={0.94}
          linearVelocity={shard.impulse}
          angularVelocity={shard.torque}
          canSleep
        >
          <mesh material={material} castShadow receiveShadow>
            <boxGeometry args={shard.size} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
};
