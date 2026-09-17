import { useCallback, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Move, PieceSymbol, Square } from 'chess.js';
import { pieceKindFromNotation, type PieceColor, type PieceKind } from '../types/chess';

export interface CapturedRecord {
  color: PieceColor;
  kind: PieceKind;
}

export type GamePhase = 'playing' | 'check' | 'checkmate' | 'draw';

export interface WizardChessState {
  board: ReturnType<Chess['board']>;
  turn: PieceColor;
  selectedSquare: string | null;
  legalTargets: string[];
  lastMove: Move | null;
  history: Move[];
  captured: CapturedRecord[];
  phase: GamePhase;
  checkSquare: string | null;
  moveCount: number;
  selectSquare: (square: string) => Move | null;
  clearSelection: () => void;
  resetGame: () => void;
}

const toColor = (color: 'w' | 'b'): PieceColor => color === 'w' ? 'white' : 'black';

export function useWizardChess(): WizardChessState {
  const chessRef = useRef(new Chess());
  const [revision, setRevision] = useState(0);
  const [turn, setTurn] = useState<PieceColor>('white');
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [history, setHistory] = useState<Move[]>([]);
  const [captured, setCaptured] = useState<CapturedRecord[]>([]);

  const board = useMemo(() => chessRef.current.board(), [revision]);
  const engine = chessRef.current;

  const phase = useMemo<GamePhase>(() => {
    if (engine.isCheckmate()) return 'checkmate';
    if (engine.isDraw() || engine.isStalemate() || engine.isThreefoldRepetition()) return 'draw';
    if (engine.isCheck()) return 'check';
    return 'playing';
  }, [revision, engine]);

  const checkSquare = useMemo(() => {
    if (!engine.isCheck()) return null;
    const rows = engine.board();
    for (let row = 0; row < rows.length; row += 1) {
      for (let col = 0; col < rows[row].length; col += 1) {
        const piece = rows[row][col];
        if (piece?.type === 'k' && piece.color === engine.turn()) {
          return `${String.fromCharCode(97 + col)}${8 - row}`;
        }
      }
    }
    return null;
  }, [revision, engine]);

  const clearSelection = useCallback(() => {
    setSelectedSquare(null);
    setLegalTargets([]);
  }, []);

  const selectSquare = useCallback((square: string): Move | null => {
    if (phase === 'checkmate' || phase === 'draw') return null;

    const piece = engine.get(square as Square);
    const isLegalTarget = legalTargets.includes(square);

    if (selectedSquare && isLegalTarget) {
      try {
        const move = engine.move({
          from: selectedSquare as Square,
          to: square as Square,
          // Promotion is deliberately automatic so the cinematic flow is never interrupted by a modal.
          promotion: 'q',
        });
        setLastMove(move);
        setHistory(engine.history({ verbose: true }));
        if (move.captured) {
          setCaptured((current) => [...current, {
            color: toColor(move.color === 'w' ? 'b' : 'w'),
            kind: pieceKindFromNotation(move.captured as PieceSymbol),
          }]);
        }
        setTurn(toColor(engine.turn()));
        setSelectedSquare(null);
        setLegalTargets([]);
        setRevision((value) => value + 1);
        return move;
      } catch {
        // chess.js rejected an edge-case move; leave the board in a safe selectable state.
        setSelectedSquare(null);
        setLegalTargets([]);
        return null;
      }
    }

    if (piece && toColor(piece.color) === turn) {
      const moves = engine.moves({ square: square as Square, verbose: true });
      setSelectedSquare(square);
      setLegalTargets(moves.map((move) => move.to));
      return null;
    }

    setSelectedSquare(null);
    setLegalTargets([]);
    return null;
  }, [engine, legalTargets, phase, selectedSquare, turn]);

  const resetGame = useCallback(() => {
    chessRef.current = new Chess();
    setRevision((value) => value + 1);
    setTurn('white');
    setSelectedSquare(null);
    setLegalTargets([]);
    setLastMove(null);
    setHistory([]);
    setCaptured([]);
  }, []);

  return {
    board,
    turn,
    selectedSquare,
    legalTargets,
    lastMove,
    history,
    captured,
    phase,
    checkSquare,
    moveCount: history.length,
    selectSquare,
    clearSelection,
    resetGame,
  };
}
