import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PieceModel, type PieceAnimation } from './ProceduralChessPieces';
import { squareToPosition, type CombatSequence, type VisualPiece } from '../types/chess';

interface ChessPieceActorProps {
  piece: VisualPiece;
  selected: boolean;
  hovered: boolean;
  combat: CombatSequence | null;
  onClick: (piece: VisualPiece) => void;
  onDragStart: (piece: VisualPiece) => void;
  onDragEnd: (piece: VisualPiece) => void;
  onHover: (piece: VisualPiece | null) => void;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export const ChessPieceActor: React.FC<ChessPieceActorProps> = ({
  piece,
  selected,
  hovered,
  combat,
  onClick,
  onDragStart,
  onDragEnd,
  onHover,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const start = useMemo(() => squareToPosition(piece.moveFrom ?? piece.square, 0.145), [piece.moveFrom, piece.square]);
  const end = useMemo(() => squareToPosition(piece.square, 0.145), [piece.square]);
  const duration = piece.kind === 'knight' ? 1160 : piece.kind === 'queen' || piece.kind === 'king' ? 1020 : 940;
  const baseYaw = piece.color === 'white' ? Math.PI : 0;
  const isAttacker = combat?.attackerId === piece.id;
  const animation = useMemo<PieceAnimation>(() => ({
    moveStartedAt: piece.moveToken,
    moveDuration: duration,
    attacker: isAttacker,
    combatStartedAt: isAttacker ? combat?.startedAt : undefined,
    impactAt: isAttacker ? combat?.impactAt : undefined,
  }), [combat?.impactAt, combat?.startedAt, duration, isAttacker, piece.moveToken]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const now = Date.now();
    const age = piece.moveToken ? now - piece.moveToken : 99999;
    const moving = Boolean(piece.moveToken && age < duration);
    let progress = piece.moveToken ? clamp01(age / duration) : 1;
    progress = progress * progress * (3 - 2 * progress);
    const idleTime = clock.getElapsedTime() + piece.id.length * 0.37;

    if (moving) {
      const lateral = Math.sin(progress * Math.PI) * (piece.kind === 'knight' ? 0.18 : 0.035);
      const dx = end[0] - start[0];
      const dz = end[2] - start[2];
      const length = Math.max(0.001, Math.hypot(dx, dz));
      group.position.x = THREE.MathUtils.lerp(start[0], end[0], progress) - (dz / length) * lateral;
      group.position.z = THREE.MathUtils.lerp(start[2], end[2], progress) + (dx / length) * lateral;
      const step = piece.kind === 'knight'
        ? Math.sin(progress * Math.PI) * 1.10
        : piece.kind === 'queen' || piece.kind === 'king'
          ? Math.sin(progress * Math.PI) * 0.04
          : Math.abs(Math.sin(progress * Math.PI * 2)) * 0.035;
      group.position.y = 0.145 + step;
    } else {
      group.position.set(end[0], 0.145 + Math.sin(idleTime * 1.25) * 0.012, end[2]);
    }

    const dx = end[0] - start[0];
    const dz = end[2] - start[2];
    const travelYaw = Math.atan2(dx, dz);
    let attackPitch = 0;
    let attackYaw = baseYaw;
    if (isAttacker && combat) {
      const combatAge = now - combat.startedAt;
      const strike = clamp01(combatAge / 1100);
      const strikeCurve = Math.sin(strike * Math.PI);
      attackPitch = piece.kind === 'knight' ? -0.62 * strikeCurve : -0.19 * strikeCurve;
      attackYaw = travelYaw;
      if (combatAge > 720) attackPitch -= Math.sin((combatAge - 720) / 150) * 0.16;
    } else if (piece.status === 'being_destroyed') {
      const destruction = clamp01((now - (combat?.impactAt ?? now)) / 440);
      group.scale.setScalar(1 - destruction * 0.7);
      group.rotation.z = destruction * 0.55;
      group.position.y -= destruction * 0.12;
    } else {
      group.scale.setScalar(selected ? 1.06 : hovered ? 1.025 : 1);
    }

    group.rotation.y = moving ? travelYaw : attackYaw + Math.sin(idleTime * 0.52) * 0.014;
    group.rotation.x = attackPitch + (moving && piece.kind !== 'knight' ? Math.sin(progress * Math.PI) * 0.035 : 0);
    if (piece.status !== 'being_destroyed') group.rotation.z = Math.sin(idleTime * 0.7) * 0.009;
  });

  if (piece.status === 'dead') return null;

  return (
    <group
      ref={groupRef}
      onPointerDown={(event) => {
        event.stopPropagation();
        onDragStart(piece);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        onDragEnd(piece);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick(piece);
      }}
      onPointerEnter={(event) => {
        event.stopPropagation();
        onHover(piece);
      }}
      onPointerLeave={() => onHover(null)}
    >
      <PieceModel kind={piece.kind} color={piece.color} animation={animation} />
      {(selected || hovered) && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.38, 0.43, 28]} />
          <meshBasicMaterial color={selected ? '#d5ad63' : '#a2a8ab'} transparent opacity={selected ? 0.76 : 0.26} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
};
