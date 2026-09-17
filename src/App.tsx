import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, Noise, SSAO, Vignette } from '@react-three/postprocessing';
import { Physics, RigidBody } from '@react-three/rapier';
import { Chess } from 'chess.js';
import type { Move } from 'chess.js';
import * as THREE from 'three';
import { ChessBoard } from './components/ChessBoard';
import { ChessPieceActor } from './components/ChessPieceActor';
import { CombatDirector } from './components/CombatDirector';
import { AudioController } from './components/AudioController';
import { CameraDirector } from './components/CameraDirector';
import { FracturedPiece } from './components/FracturedPiece';
import { AmbientMotes, ImpactVisual } from './components/Particles';
import { useWizardChess } from './hooks/useWizardChess';
import {
  colorLabel,
  files,
  otherColor,
  pieceGlyph,
  pieceKindFromNotation,
  pieceLabel,
  pieceRole,
  squareToPosition,
  type CombatSequence,
  type ImpactBurst,
  type PieceColor,
  type PieceKind,
  type RubbleBurst,
  type VisualPiece,
} from './types/chess';
import { createAdaptiveRenderer } from './engine/renderer';
import styles from './styles/hud.module.css';

const colorFromNotation = (color: 'w' | 'b'): PieceColor => color === 'w' ? 'white' : 'black';

const initialPieces = (): VisualPiece[] => {
  const board = new Chess().board();
  const pieces: VisualPiece[] = [];
  board.forEach((row, rowIndex) => {
    row.forEach((piece, fileIndex) => {
      if (!piece) return;
      const square = `${files[fileIndex]}${8 - rowIndex}`;
      const color = colorFromNotation(piece.color);
      const kind = pieceKindFromNotation(piece.type);
      pieces.push({
        id: `${color}-${kind}-${square}`,
        color,
        kind,
        square,
        status: 'idle',
      });
    });
  });
  return pieces;
};

const Torch: React.FC<{ position: [number, number, number]; flip?: boolean }> = ({ position, flip = false }) => {
  const lightRef = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (lightRef.current) {
      lightRef.current.intensity = 9.5 + Math.sin(clock.getElapsedTime() * 9.7 + position[0]) * 1.4 + Math.sin(clock.getElapsedTime() * 21.1) * 0.7;
    }
  });
  return (
    <group position={position}>
      <pointLight ref={lightRef} color="#f58b35" intensity={11} distance={8.5} decay={2} castShadow />
      <mesh position={[0, flip ? -0.18 : 0.18, 0]} rotation={[flip ? Math.PI : 0, 0, 0]}>
        <coneGeometry args={[0.16, 0.42, 7]} />
        <meshBasicMaterial color="#f3ad51" transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, flip ? -0.38 : 0.38, 0]}>
        <sphereGeometry args={[0.07, 7, 5]} />
        <meshBasicMaterial color="#fff0a9" />
      </mesh>
    </group>
  );
};

const ChamberBackdrop: React.FC = () => (
  <group>
    <mesh position={[0, 4.4, -6.8]} receiveShadow>
      <planeGeometry args={[26, 12]} />
      <meshStandardMaterial color="#142218" roughness={1} />
    </mesh>
    <mesh position={[-7.2, 4.1, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
      <planeGeometry args={[14, 11]} />
      <meshStandardMaterial color="#17271b" roughness={1} />
    </mesh>
    <mesh position={[7.2, 4.1, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
      <planeGeometry args={[14, 11]} />
      <meshStandardMaterial color="#101b14" roughness={1} />
    </mesh>
    <mesh position={[0, 4.60, -6.42]} rotation={[0, 0, Math.PI]}>
      <torusGeometry args={[3.05, 0.09, 7, 64, Math.PI]} />
      <meshBasicMaterial color="#c99848" transparent opacity={0.48} />
    </mesh>
    <mesh position={[0, 4.56, -6.38]}>
      <planeGeometry args={[2.2, 2.8]} />
      <meshStandardMaterial color="#203a26" roughness={0.9} transparent opacity={0.68} />
    </mesh>
    {[-6.1, 6.1].map((x) => (
      <group key={x} position={[x, 2.65, -5.3]}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.62, 0.92, 5.3, 8]} />
          <meshStandardMaterial color="#293a29" roughness={0.96} flatShading />
        </mesh>
        <mesh position={[0, 2.82, 0]} castShadow>
          <coneGeometry args={[0.92, 1.15, 8]} />
          <meshStandardMaterial color="#213223" roughness={1} flatShading />
        </mesh>
      </group>
    ))}
    <Torch position={[-4.95, 3.8, -4.85]} />
    <Torch position={[4.95, 3.3, -4.85]} flip />
    <pointLight color="#b7d27e" intensity={18} distance={16} position={[0, 8.5, 1.5]} />
  </group>
);

interface SceneProps {
  pieces: VisualPiece[];
  hoveredPiece: VisualPiece | null;
  combat: CombatSequence | null;
  rubble: RubbleBurst[];
  impact: ImpactBurst | null;
  selectedSquare: string | null;
  legalTargets: string[];
  lastMove: Move | null;
  checkSquare: string | null;
  onSquareClick: (square: string) => void;
  onSquarePointerUp: (square: string) => void;
  onPieceClick: (piece: VisualPiece) => void;
  onDragStart: (piece: VisualPiece) => void;
  onDragEnd: (piece: VisualPiece) => void;
  onHoverSquare: (square: string | null) => void;
  onHoverPiece: (piece: VisualPiece | null) => void;
}

const Scene: React.FC<SceneProps> = ({
  pieces,
  hoveredPiece,
  combat,
  rubble,
  impact,
  selectedSquare,
  legalTargets,
  lastMove,
  checkSquare,
  onSquareClick,
  onSquarePointerUp,
  onPieceClick,
  onDragStart,
  onDragEnd,
  onHoverSquare,
  onHoverPiece,
}) => (
  <>
    <color attach="background" args={['#0d1710']} />
    <fog attach="fog" args={['#0d1710', 10, 26]} />
    <ambientLight color="#31462e" intensity={0.27} />
    <hemisphereLight args={['#d6bc77', '#0a120d', 0.42]} />
    <spotLight
      position={[3.5, 11, 4.5]}
      color="#e8c579"
      intensity={118}
      angle={0.52}
      penumbra={0.7}
      distance={25}
      castShadow
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-bias={-0.0002}
    />
    <ChamberBackdrop />
    <ChessBoard
      selectedSquare={selectedSquare}
      legalTargets={legalTargets}
      lastMove={lastMove}
      checkSquare={checkSquare}
      onSquareClick={onSquareClick}
      onSquarePointerUp={onSquarePointerUp}
      onHoverSquare={onHoverSquare}
    />
    <Physics gravity={[0, -8.8, 0]} colliders={false}>
      <RigidBody type="fixed" colliders="cuboid" position={[0, -0.02, 0]}>
        <mesh visible={false}>
          <boxGeometry args={[9.3, 0.12, 9.3]} />
        </mesh>
      </RigidBody>
      {rubble.map((burst) => (
        <FracturedPiece
          key={burst.id}
          id={burst.id}
          position={burst.position}
          color={burst.color}
          kind={burst.kind}
        />
      ))}
    </Physics>
    {pieces.map((piece) => (
      <ChessPieceActor
        key={piece.id}
        piece={piece}
        selected={selectedSquare === piece.square}
        hovered={hoveredPiece?.id === piece.id}
        combat={combat}
        onClick={onPieceClick}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onHover={onHoverPiece}
      />
    ))}
    <AmbientMotes />
    {impact && <ImpactVisual key={impact.id} burst={impact} />}
    <CameraDirector combat={combat} />
    <EffectComposer multisampling={0} enableNormalPass>
      <SSAO samples={16} radius={0.18} intensity={14} luminanceInfluence={0.55} />
      <DepthOfField focusDistance={combat ? 0.018 : 0.035} focalLength={0.045} bokehScale={combat ? 4.6 : 1.15} height={420} />
      <Bloom luminanceThreshold={1.12} intensity={0.42} mipmapBlur />
      <ChromaticAberration offset={new THREE.Vector2(combat ? 0.0015 : 0.00025, combat ? 0.0011 : 0.0002)} radialModulation={false} modulationOffset={0.2} />
      <Noise opacity={0.035} />
      <Vignette eskil={false} offset={0.18} darkness={0.86} />
    </EffectComposer>
  </>
);

const Crest: React.FC = () => (
  <div className={styles.crest} aria-hidden="true">
    <span className={styles.crestDiamond} />
    <span className={styles.crestCut} />
  </div>
);

const ColorDot: React.FC<{ color: PieceColor }> = ({ color }) => <span className={`${styles.colorDot} ${styles[color]}`} />;

const MiniStoneGlyph: React.FC<{ kind: PieceKind }> = ({ kind }) => (
  <span className={`${styles.miniStoneGlyph} ${styles[`mini${kind[0].toUpperCase()}${kind.slice(1)}`]}`} aria-hidden="true">
    <i />
    <b />
    <em>{pieceGlyph[kind]}</em>
  </span>
);

const CapturedRow: React.FC<{ pieces: { color: PieceColor; kind: PieceKind }[]; color: PieceColor }> = ({ pieces, color }) => (
  <div className={styles.capturedRow}>
    <span className={styles.capturedLabel}><ColorDot color={color} />{colorLabel[color]}</span>
    <div className={styles.capturedIcons}>
      {pieces.filter((piece) => piece.color === color).map((piece, index) => (
        <span className={`${styles.capturedPiece} ${styles[piece.color]}`} key={`${piece.kind}-${index}`} title={pieceLabel[piece.kind]}>{pieceGlyph[piece.kind]}</span>
      ))}
      {pieces.filter((piece) => piece.color === color).length === 0 && <span className={styles.emptyCaptured}>—</span>}
    </div>
  </div>
);

export default function App() {
  const game = useWizardChess();
  const [pieces, setPieces] = useState<VisualPiece[]>(initialPieces);
  const [hoveredPiece, setHoveredPiece] = useState<VisualPiece | null>(null);
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);
  const [combat, setCombat] = useState<CombatSequence | null>(null);
  const [rubble, setRubble] = useState<RubbleBurst[]>([]);
  const [impact, setImpact] = useState<ImpactBurst | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [showCodex, setShowCodex] = useState(false);
  const audio = useRef(new AudioController());
  const sequenceId = useRef(0);
  const dragRef = useRef<{ id: string; origin: string } | null>(null);
  const suppressNextClick = useRef(false);

  useEffect(() => () => audio.current.dispose(), []);

  const resetGame = useCallback(() => {
    game.resetGame();
    setPieces(initialPieces());
    setCombat(null);
    setRubble([]);
    setImpact(null);
    setHoveredPiece(null);
    setHoveredSquare(null);
    dragRef.current = null;
    suppressNextClick.current = false;
  }, [game]);

  const toggleSound = useCallback(async () => {
    const enabled = !soundEnabled;
    setSoundEnabled(enabled);
    await audio.current.setEnabled(enabled);
  }, [soundEnabled]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key.toLowerCase() === 'r') resetGame();
      if (event.key.toLowerCase() === 's') void toggleSound();
      if (event.key === 'Escape') setShowCodex(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resetGame, toggleSound]);

  const launchMove = useCallback((move: Move) => {
    const moverColor = colorFromNotation(move.color);
    const captureSquare = move.flags.includes('e') ? `${move.to[0]}${move.from[1]}` : move.to;
    const attacker = pieces.find((piece) => piece.square === move.from && piece.color === moverColor && piece.status !== 'dead');
    const victim = move.captured
      ? pieces.find((piece) => piece.square === captureSquare && piece.color !== moverColor && piece.status !== 'dead')
      : undefined;
    if (!attacker) return;

    const moveToken = Date.now();
    const promotedKind = move.promotion ? pieceKindFromNotation(move.promotion) : attacker.kind;
    const rookMove = move.flags.includes('k')
      ? (moverColor === 'white' ? { from: 'h1', to: 'f1' } : { from: 'h8', to: 'f8' })
      : move.flags.includes('q')
        ? (moverColor === 'white' ? { from: 'a1', to: 'd1' } : { from: 'a8', to: 'd8' })
        : null;

    setPieces((current) => current.map((piece) => {
      if (piece.id === attacker.id) {
        return {
          ...piece,
          kind: promotedKind,
          square: move.to,
          moveFrom: move.from,
          moveToken,
          status: victim ? 'attacking' : 'moving',
        };
      }
      if (rookMove && piece.square === rookMove.from && piece.color === moverColor) {
        return {
          ...piece,
          square: rookMove.to,
          moveFrom: rookMove.from,
          moveToken: moveToken + 1,
          status: 'moving',
        };
      }
      return piece;
    }));

    setRubble((current) => current.slice(1));
    audio.current.playMove(attacker.kind);

    if (victim) {
      const id = sequenceId.current + 1;
      sequenceId.current = id;
      const startedAt = Date.now();
      const impactDelay = attacker.kind === 'knight' ? 930 : attacker.kind === 'queen' || attacker.kind === 'king' ? 850 : 760;
      setCombat({
        id,
        from: move.from,
        to: move.to,
        attackerId: attacker.id,
        attackerColor: moverColor,
        attackerKind: attacker.kind,
        victimId: victim.id,
        victimColor: victim.color,
        victimKind: victim.kind,
        startedAt,
        impactAt: startedAt + impactDelay,
        move,
      });
    }
  }, [pieces]);

  const onSquareClick = useCallback((square: string) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }
    if (combat) return;
    const hadSelection = Boolean(game.selectedSquare);
    const move = game.selectSquare(square);
    if (move) {
      launchMove(move);
    } else if (!hadSelection && soundEnabled) {
      audio.current.playSelect();
    }
  }, [combat, game.selectSquare, game.selectedSquare, launchMove, soundEnabled]);

  const onPieceClick = useCallback((piece: VisualPiece) => {
    onSquareClick(piece.square);
  }, [onSquareClick]);

  const onDragStart = useCallback((piece: VisualPiece) => {
    if (combat) return;
    dragRef.current = { id: piece.id, origin: piece.square };
    onSquareClick(piece.square);
  }, [combat, onSquareClick]);

  const onDragEnd = useCallback((piece: VisualPiece) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.id !== piece.id && drag.origin !== piece.square) {
      onSquareClick(piece.square);
      suppressNextClick.current = true;
    }
  }, [onSquareClick]);

  const onDragCancel = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onSquarePointerUp = useCallback((square: string) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.origin !== square) {
      onSquareClick(square);
      suppressNextClick.current = true;
    }
  }, [onSquareClick]);

  const onImpact = useCallback((sequence: CombatSequence) => {
    if (!sequence.victimId || !sequence.victimColor || !sequence.victimKind) return;
    const [x, , z] = squareToPosition(sequence.to, 0.12);
    setPieces((current) => current.map((piece) => piece.id === sequence.victimId
      ? { ...piece, status: 'being_destroyed' }
      : piece));
    setRubble((current) => [...current, {
      id: sequence.id,
      position: [x, 0.06, z],
      color: sequence.victimColor!,
      kind: sequence.victimKind!,
    }]);
    setImpact({ id: sequence.id, position: [x, 0.16, z], startedAt: Date.now() });
    audio.current.playImpact(sequence.attackerKind);
  }, []);

  const onCombatComplete = useCallback((sequence: CombatSequence) => {
    setPieces((current) => current.filter((piece) => piece.id !== sequence.victimId));
    setCombat(null);
    setImpact(null);
  }, []);

  const activePiece = useMemo(() => {
    if (game.selectedSquare) return pieces.find((piece) => piece.square === game.selectedSquare) ?? null;
    return hoveredPiece;
  }, [game.selectedSquare, hoveredPiece, pieces]);

  const turnLabel = colorLabel[game.turn];
  const winner = otherColor(game.turn);
  const phaseLabel = combat
    ? 'THE CHAMBER STRIKES'
    : game.phase === 'checkmate'
      ? 'KINGFALL'
      : game.phase === 'check'
        ? `${turnLabel.toUpperCase()} KING IN CHECK`
        : `${turnLabel.toUpperCase()} TO MOVE`;
  const capturedIvory = game.captured.filter((piece) => piece.color === 'white');
  const capturedObsidian = game.captured.filter((piece) => piece.color === 'black');

  return (
    <main className={styles.appShell}>
      <div className={styles.grain} aria-hidden="true" />
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Crest />
          <div>
            <div className={styles.brandKicker}>A FABLE IN STONE</div>
            <div className={styles.brandTitle}>THE CHAMBER</div>
          </div>
        </div>
          <div className={styles.matchState}>
          <span className={styles.liveDot} />
          <span>TWO PLAYERS</span>
          <span className={styles.matchDivider}>/</span>
          <span className={styles.mutedText}>THE OLD KINGDOM</span>
        </div>
        <div className={styles.topActions}>
          <button className={`${styles.iconButton} ${soundEnabled ? styles.buttonActive : ''}`} onClick={toggleSound} aria-label="Toggle sound">
            <span className={styles.soundBars}><i /><i /><i /></span>
            {soundEnabled ? 'SOUND ON' : 'SOUND OFF'}
          </button>
          <button className={styles.textButton} onClick={() => setShowCodex(true)}>FABLE BOOK</button>
          <button className={styles.resetButton} onClick={resetGame}>RESET CHAMBER <span>↻</span></button>
        </div>
      </header>

      <section className={styles.mainGrid}>
        <aside className={`${styles.rail} ${styles.leftRail}`}>
          <div className={styles.eyebrow}>THE OLD KINGDOM <span>·</span> 01</div>
          <h1>THE<br /><em>ENCHANTED</em><br />BOARD</h1>
          <p className={styles.intro}>A living fairytale in stone. Choose a champion, make your move, and let the old magic answer.</p>
          <div className={styles.divider} />
          <div className={styles.turnCard}>
            <span className={styles.cardLabel}>CURRENT TURN</span>
            <div className={styles.turnName}><ColorDot color={game.turn} /><strong>{turnLabel}</strong></div>
            <span className={styles.turnHint}>{combat ? 'Awaiting the impact...' : 'Choose a piece to command'}</span>
          </div>
          <div className={styles.statusBlock}>
            <div className={styles.statusHeading}><span className={styles.statusPulse} />CHAMBER STATUS</div>
            <div className={styles.statusLine}><span>PHASE</span><strong>{phaseLabel}</strong></div>
            <div className={styles.statusLine}><span>ROUND</span><strong>{String(Math.floor(game.moveCount / 2) + 1).padStart(2, '0')}</strong></div>
          </div>
          <div className={styles.quote}>
            <span className={styles.quoteMark}>“</span>
            <p>Every kingdom needs a little mischief. The board remembers who dares to play.</p>
            <small>— THE STORYTELLER</small>
          </div>
        </aside>

        <div className={styles.stageWrap}>
          <div className={styles.stageFrame}>
            <div className={styles.stageCornerTop} />
            <Canvas
              shadows
              dpr={[1, 1.65]}
              camera={{ position: [9.35, 8.9, 10.45], fov: 36, near: 0.1, far: 50 }}
              gl={createAdaptiveRenderer}
              onPointerMissed={() => onDragCancel()}
              onCreated={({ gl }) => {
                gl.toneMapping = THREE.ACESFilmicToneMapping;
                gl.toneMappingExposure = 1.05;
                gl.shadowMap.enabled = true;
              }}
            >
              <Suspense fallback={null}>
                <Scene
                  pieces={pieces}
                  hoveredPiece={hoveredPiece}
                  combat={combat}
                  rubble={rubble}
                  impact={impact}
                  selectedSquare={game.selectedSquare}
                  legalTargets={game.legalTargets}
                  lastMove={game.lastMove}
                  checkSquare={game.checkSquare}
                  onSquareClick={onSquareClick}
                  onSquarePointerUp={onSquarePointerUp}
                  onPieceClick={onPieceClick}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onHoverSquare={setHoveredSquare}
                  onHoverPiece={setHoveredPiece}
                />
              </Suspense>
            </Canvas>
            <div className={styles.boardCoordinates} aria-hidden="true">
              <span className={styles.rankLabels}>{[8, 7, 6, 5, 4, 3, 2, 1].map((rank) => <i key={rank}>{rank}</i>)}</span>
              <span className={styles.fileLabels}>{files.map((file) => <i key={file}>{file}</i>)}</span>
            </div>
            {hoveredSquare && !combat && <div className={styles.hoverReadout}>{hoveredSquare.toUpperCase()} <span>·</span> {game.legalTargets.includes(hoveredSquare) ? 'LEGAL DESTINATION' : 'FLAGSTONE'}</div>}
            {combat && (
              <div className={styles.combatOverlay}>
                <span className={styles.combatKicker}>EXECUTION IN PROGRESS</span>
                <strong>{pieceRole[combat.attackerKind]} <i>vs</i> {combat.victimKind ? pieceRole[combat.victimKind] : 'STONE'}</strong>
                <div className={styles.combatRule}><span /></div>
              </div>
            )}
            {!combat && game.phase === 'checkmate' && (
              <div className={styles.victoryOverlay}>
                <span>CHECKMATE</span>
                <strong>{colorLabel[winner].toUpperCase()} WINS</strong>
                <small>THE KINGDOM FALLS TO THE STONE</small>
              </div>
            )}
          </div>
          <div className={styles.stageCaption}>
            <span><b>✦</b> A FABLE IN STONE / NO ASSETS</span>
            <span>CHOOSE A CHAMPION <i>·</i> GOLD RUNES SHOW THE WAY</span>
            <span>THE WILDS / THE OLD KINGDOM</span>
          </div>
        </div>

        <aside className={`${styles.rail} ${styles.rightRail}`}>
          <div className={styles.inspectorHeader}><span className={styles.eyebrow}>THE GAME MASTER</span><span className={styles.squareCount}>8 × 8</span></div>
          <div className={styles.divider} />
          <div className={styles.selectionPanel}>
            <div className={styles.cardLabel}>ACTIVE PIECE</div>
            {activePiece ? (
              <div className={styles.activePieceInfo}>
                <div className={`${styles.miniBust} ${styles[activePiece.color]}`}>
                  <MiniStoneGlyph kind={activePiece.kind} />
                </div>
                <div>
                  <div className={styles.activePieceName}>{pieceRole[activePiece.kind]}</div>
                  <div className={styles.activePieceMeta}><ColorDot color={activePiece.color} /> {colorLabel[activePiece.color]} <span>·</span> {pieceLabel[activePiece.kind]} <span>·</span> {activePiece.square.toUpperCase()}</div>
                </div>
              </div>
            ) : (
              <div className={styles.emptyInspector}><span>♞</span><p>Choose a champion<br />to hear its legend.</p></div>
            )}
            {game.selectedSquare && (
              <div className={styles.targetLine}>
                <span>LEGAL TARGETS <i>·</i> PVP CONTROL</span>
                {game.legalTargets.length > 0 ? (
                  <div className={styles.targetButtons}>
                    {game.legalTargets.map((target) => (
                      <button key={target} className={styles.targetButton} onClick={() => onSquareClick(target)}>{target.toUpperCase()}</button>
                    ))}
                  </div>
                ) : <strong className={styles.noTargets}>NO LEGAL DESTINATIONS</strong>}
              </div>
            )}
            <div className={styles.rosterBlock}>
              <div className={styles.rosterHeader}><span className={styles.cardLabel}>COMMAND ROSTER</span><span>{turnLabel.toUpperCase()}</span></div>
              <div className={styles.rosterButtons}>
                {pieces.filter((piece) => piece.color === game.turn && piece.status !== 'dead').sort((a, b) => a.square.localeCompare(b.square)).map((piece) => (
                  <button key={piece.id} className={`${styles.rosterButton} ${game.selectedSquare === piece.square ? styles.rosterButtonActive : ''}`} onClick={() => onSquareClick(piece.square)} title={`${pieceRole[piece.kind]} at ${piece.square}`}>
                    <b>{pieceGlyph[piece.kind]}</b><span>{piece.square}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.divider} />
          <div className={styles.logHeader}><span className={styles.cardLabel}>ALGEBRAIC LOG</span><span>{game.history.length} PLY</span></div>
          <div className={styles.moveLog}>
            {game.history.length === 0 && <div className={styles.logEmpty}>The chamber is waiting.<br />White moves first.</div>}
            {game.history.slice(-8).map((move, index) => {
              const absoluteIndex = Math.max(0, game.history.length - 8) + index;
              return (
                <div className={`${styles.logMove} ${move === game.lastMove ? styles.logMoveActive : ''}`} key={`${move.lan}-${absoluteIndex}`}>
                  <span>{String(Math.floor(absoluteIndex / 2) + 1).padStart(2, '0')}{absoluteIndex % 2 === 0 ? '.' : '…'}</span>
                  <strong>{move.san}</strong>
                  <small>{move.from}{move.to}</small>
                </div>
              );
            })}
          </div>

          <div className={styles.capturedPanel}>
            <div className={styles.cardLabel}>FALLEN CHAMPIONS</div>
            <CapturedRow pieces={capturedIvory} color="white" />
            <CapturedRow pieces={capturedObsidian} color="black" />
          </div>
          <div className={styles.tip}><span>✧</span><p>Captures wake the old magic. Broken stone rests for one turn before it sinks back into the earth.</p></div>
        </aside>
      </section>

      <footer className={styles.footer}>
        <div><span className={styles.footerMark}>◆</span> THE CHAMBER <span className={styles.footerSep}>/</span> A PROCEDURAL FABLE</div>
        <div className={styles.footerCenter}><span className={styles.keyHint}>CLICK</span> SELECT <span className={styles.keyHint}>R</span> RESET <span className={styles.keyHint}>S</span> SOUND</div>
        <div className={styles.footerRight}>RULES <b>CHESS.JS</b> <span className={styles.footerSep}>·</span> MAGIC <b>RAPIER</b></div>
      </footer>

      <CombatDirector sequence={combat} onImpact={onImpact} onComplete={onCombatComplete} />

      {showCodex && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="The Codex">
          <div className={styles.codexModal}>
            <button className={styles.modalClose} onClick={() => setShowCodex(false)} aria-label="Close codex">×</button>
            <div className={styles.eyebrow}>THE STORYTELLER'S BOOK</div>
            <h2>How the board<br /><em>comes alive</em></h2>
            <div className={styles.codexGrid}>
              <div><span>01</span><h3>CHOOSE A HERO</h3><p>Select one of your living champions. Gold runes mark every path the rules allow.</p></div>
              <div><span>02</span><h3>MAKE MISCHIEF</h3><p>Move the champion by click, drag, or the little command buttons beside the board.</p></div>
              <div><span>03</span><h3>WAKE THE MAGIC</h3><p>A capture starts a theatrical clash, with dust, sparks, and enchanted stone fragments.</p></div>
              <div><span>04</span><h3>TELL THE ENDING</h3><p>Corner the opposing king and the surviving kingdom claims the story.</p></div>
            </div>
            <button className={styles.enterButton} onClick={() => setShowCodex(false)}>RETURN TO THE BOARD <span>↗</span></button>
          </div>
        </div>
      )}
    </main>
  );
}
