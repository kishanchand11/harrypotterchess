import { useEffect } from 'react';
import type { CombatSequence } from '../types/chess';

interface CombatDirectorProps {
  sequence: CombatSequence | null;
  onImpact: (sequence: CombatSequence) => void;
  onComplete: (sequence: CombatSequence) => void;
}

/**
 * The director keeps choreography timing out of the board and piece components. The actual
 * collision frame is intentionally explicit: the visual victim is swapped for Rapier shards
 * after the strike has landed, not when the move is merely validated by chess.js.
 */
export const CombatDirector: React.FC<CombatDirectorProps> = ({ sequence, onImpact, onComplete }) => {
  useEffect(() => {
    if (!sequence) return undefined;
    const impactDelay = Math.max(220, sequence.impactAt - sequence.startedAt);
    const impactTimer = window.setTimeout(() => onImpact(sequence), impactDelay);
    const completeTimer = window.setTimeout(() => onComplete(sequence), 2900);
    return () => {
      window.clearTimeout(impactTimer);
      window.clearTimeout(completeTimer);
    };
  }, [onComplete, onImpact, sequence]);

  return null;
};
