import type { Move } from 'chess.js';

export type PieceColor = 'white' | 'black';
export type PieceKind = 'pawn' | 'rook' | 'knight' | 'bishop' | 'queen' | 'king';
export type PieceStatus = 'idle' | 'hovered' | 'selected' | 'moving' | 'attacking' | 'being_destroyed' | 'dead';

export interface VisualPiece {
  id: string;
  color: PieceColor;
  kind: PieceKind;
  square: string;
  status: PieceStatus;
  moveToken?: number;
  moveFrom?: string;
}

export interface CombatSequence {
  id: number;
  from: string;
  to: string;
  attackerId: string;
  attackerColor: PieceColor;
  attackerKind: PieceKind;
  victimId?: string;
  victimColor?: PieceColor;
  victimKind?: PieceKind;
  startedAt: number;
  impactAt: number;
  move: Move;
}

export interface RubbleBurst {
  id: number;
  position: [number, number, number];
  color: PieceColor;
  kind: PieceKind;
}

export interface ImpactBurst {
  id: number;
  position: [number, number, number];
  startedAt: number;
}

export const pieceKindFromNotation = (notation: string): PieceKind => {
  switch (notation) {
    case 'p': return 'pawn';
    case 'r': return 'rook';
    case 'n': return 'knight';
    case 'b': return 'bishop';
    case 'q': return 'queen';
    case 'k': return 'king';
    default: return 'pawn';
  }
};

export const pieceLabel: Record<PieceKind, string> = {
  pawn: 'Pawn',
  rook: 'Rook',
  knight: 'Knight',
  bishop: 'Bishop',
  queen: 'Queen',
  king: 'King',
};

export const pieceRole: Record<PieceKind, string> = {
  pawn: 'Foot Soldier',
  rook: 'Castle Warden',
  knight: 'Stone Destrier',
  bishop: 'Hooded Mage',
  queen: 'Witch Queen',
  king: 'Crowned Sovereign',
};

export const pieceGlyph: Record<PieceKind, string> = {
  pawn: 'P',
  rook: 'R',
  knight: 'N',
  bishop: 'B',
  queen: 'Q',
  king: 'K',
};

export const colorLabel: Record<PieceColor, string> = {
  white: 'Ivory',
  black: 'Obsidian',
};

export const otherColor = (color: PieceColor): PieceColor => color === 'white' ? 'black' : 'white';

export const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export const squareToPosition = (square: string, y = 0): [number, number, number] => {
  const file = files.indexOf(square[0] as typeof files[number]);
  const rank = Number(square[1]);
  return [file - 3.5, y, (8 - rank) - 3.5];
};

export const positionToSquare = (x: number, z: number): string => {
  const fileIndex = Math.max(0, Math.min(7, Math.floor(x + 4)));
  const rank = 8 - Math.max(0, Math.min(7, Math.floor(z + 4)));
  return `${files[fileIndex]}${rank}`;
};

export const isLightSquare = (square: string): boolean => {
  const file = files.indexOf(square[0] as typeof files[number]);
  const rank = Number(square[1]);
  return (file + rank) % 2 === 0;
};
