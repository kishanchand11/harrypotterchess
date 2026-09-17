import React, { useMemo } from 'react';
import * as THREE from 'three';
import type { Move } from 'chess.js';
import { files, isLightSquare, squareToPosition } from '../types/chess';

interface ChessBoardProps {
  selectedSquare: string | null;
  legalTargets: string[];
  lastMove: Move | null;
  checkSquare: string | null;
  onSquareClick: (square: string) => void;
  onSquarePointerUp: (square: string) => void;
  onHoverSquare: (square: string | null) => void;
}

const boardLight = new THREE.Color('#4c5054');
const boardDark = new THREE.Color('#292d31');

const Tile: React.FC<{
  square: string;
  selected: boolean;
  legal: boolean;
  last: boolean;
  check: boolean;
  onClick: (square: string) => void;
  onPointerUp: (square: string) => void;
  onHover: (square: string | null) => void;
}> = ({ square, selected, legal, last, check, onClick, onPointerUp, onHover }) => {
  const [x, , z] = squareToPosition(square, 0.04);
  const light = isLightSquare(square);

  return (
    <group position={[x, 0, z]}>
      <mesh
        position={[0, 0.02, 0]}
        castShadow
        receiveShadow
        onClick={(event) => {
          event.stopPropagation();
          onClick(square);
        }}
        onPointerEnter={(event) => {
          event.stopPropagation();
          onHover(square);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          onPointerUp(square);
        }}
        onPointerLeave={() => onHover(null)}
      >
        <boxGeometry args={[0.965, 0.18, 0.965]} />
        <meshStandardMaterial
          color={light ? boardLight : boardDark}
          roughness={0.92}
          metalness={0.06}
          flatShading
        />
      </mesh>
      <mesh position={[0, 0.115, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.78, 0.78]} />
        <meshBasicMaterial
          color={check ? '#7e2d35' : last ? '#786341' : light ? '#565b5f' : '#303438'}
          transparent
          opacity={check ? 0.56 : last ? 0.33 : 0.16}
          depthWrite={false}
        />
      </mesh>
      {selected && (
        <mesh position={[0, 0.14, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.30, 0.39, 32]} />
          <meshBasicMaterial color="#d4ac64" transparent opacity={0.92} depthWrite={false} />
        </mesh>
      )}
      {legal && !selected && (
        <mesh position={[0, 0.145, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.095, 0.13, 24]} />
          <meshBasicMaterial color="#d5b26e" transparent opacity={0.88} depthWrite={false} />
        </mesh>
      )}
      {check && (
        <mesh position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.39, 0.44, 32]} />
          <meshBasicMaterial color="#d04d4d" transparent opacity={0.84} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
};

export const ChessBoard: React.FC<ChessBoardProps> = ({
  selectedSquare,
  legalTargets,
  lastMove,
  checkSquare,
  onSquareClick,
  onSquarePointerUp,
  onHoverSquare,
}) => {
  const squares = useMemo(() => files.flatMap((file) =>
    Array.from({ length: 8 }, (_, index) => `${file}${8 - index}`)), []);

  return (
    <group>
      <mesh position={[0, -0.16, 0]} receiveShadow>
        <boxGeometry args={[8.72, 0.25, 8.72]} />
        <meshStandardMaterial color="#17191d" roughness={0.98} metalness={0.02} flatShading />
      </mesh>
      <mesh position={[0, -0.31, 0]} receiveShadow>
        <boxGeometry args={[9.12, 0.22, 9.12]} />
        <meshStandardMaterial color="#111216" roughness={1} flatShading />
      </mesh>
      <mesh position={[0, -0.41, 0]} receiveShadow>
        <boxGeometry args={[9.56, 0.12, 9.56]} />
        <meshStandardMaterial color="#08090b" roughness={1} flatShading />
      </mesh>
      {squares.map((square) => (
        <Tile
          key={square}
          square={square}
          selected={selectedSquare === square}
          legal={legalTargets.includes(square)}
          last={lastMove?.from === square || lastMove?.to === square}
          check={checkSquare === square}
          onClick={onSquareClick}
          onPointerUp={onSquarePointerUp}
          onHover={onHoverSquare}
        />
      ))}
      <group position={[0, -0.02, 0]}>
        {[-4.46, 4.46].map((x) => [-4.46, 4.46].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 0, z]} castShadow>
            <cylinderGeometry args={[0.18, 0.24, 0.52, 8]} />
            <meshStandardMaterial color="#27292b" roughness={0.88} flatShading />
          </mesh>
        )))}
      </group>
    </group>
  );
};
