import React, { createContext, useContext, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PieceColor, PieceKind } from '../types/chess';

export interface PieceAnimation {
  moveStartedAt?: number;
  moveDuration?: number;
  attacker?: boolean;
  combatStartedAt?: number;
  impactAt?: number;
}

export interface PieceProps {
  color: PieceColor;
  position?: [number, number, number];
  rotation?: [number, number, number];
  animation?: PieceAnimation;
}

type Vec3 = [number, number, number];

/**
 * Asset-free, character-first stone material. Coordinates are evaluated in world space so a
 * soldier's helmet, armor, and blade share one carved, weathered surface.
 */
export function createStoneMaterial(colorType: PieceColor): THREE.MeshStandardMaterial {
  const isWhite = colorType === 'white';
  const baseColor = isWhite ? new THREE.Color('#d8d1c2') : new THREE.Color('#20252c');
  const crackColor = isWhite ? new THREE.Color('#625e56') : new THREE.Color('#05070a');
  const material = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: isWhite ? 0.86 : 0.74,
    metalness: isWhite ? 0.05 : 0.12,
    flatShading: true,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCrackColor = { value: crackColor };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n varying vec3 vWizardWorldPosition;`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>\n vWizardWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWizardWorldPosition;
         uniform vec3 uCrackColor;
         float wizardHash(vec3 p) {
           p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
           p *= 17.0;
           return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
         }
         float wizardNoise(vec3 x) {
           vec3 i = floor(x);
           vec3 f = fract(x);
           f = f * f * (3.0 - 2.0 * f);
           return mix(
             mix(mix(wizardHash(i), wizardHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(wizardHash(i + vec3(0.0, 1.0, 0.0)), wizardHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(wizardHash(i + vec3(0.0, 0.0, 1.0)), wizardHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(wizardHash(i + vec3(0.0, 1.0, 1.0)), wizardHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
         }
         float wizardFractal(vec3 p) {
           float value = 0.0;
           float amplitude = 0.55;
           for (int i = 0; i < 4; i++) {
             value += wizardNoise(p) * amplitude;
             p = p * 2.03 + vec3(7.1, 2.3, 4.7);
             amplitude *= 0.5;
           }
           return value;
         }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float stoneLarge = wizardFractal(vWizardWorldPosition * 2.15);
         float stonePits = wizardFractal(vWizardWorldPosition * 18.0);
         float chiselCrevice = smoothstep(0.64, 0.86, stoneLarge) * 0.58;
         float microDust = smoothstep(0.72, 0.98, stonePits) * 0.18;
         vec3 chiselledStone = mix(diffuseColor.rgb, uCrackColor, chiselCrevice);
         chiselledStone *= 0.90 + stonePits * 0.18;
         diffuseColor = vec4(mix(chiselledStone, uCrackColor, microDust), diffuseColor.a);`,
      );
  };
  material.customProgramCacheKey = () => `wizard-stone-${colorType}`;
  return material;
}

function createWeaponMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#303944', roughness: 0.38, metalness: 0.78, flatShading: true });
}

function createGoldMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#b1854b', roughness: 0.32, metalness: 0.72, flatShading: true });
}

function createClothMaterial(colorType: PieceColor): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: colorType === 'white' ? '#718b5c' : '#7e403d',
    roughness: 0.96,
    metalness: 0.02,
    flatShading: true,
  });
}

function createGlowMaterial(colorType: PieceColor): THREE.MeshStandardMaterial {
  const glow = colorType === 'white' ? '#f4cf77' : '#c8e38e';
  return new THREE.MeshStandardMaterial({
    color: glow,
    emissive: glow,
    emissiveIntensity: 1.2,
    roughness: 0.28,
    metalness: 0.22,
  });
}

const StoneContext = createContext<THREE.MeshStandardMaterial | null>(null);
const WeaponContext = createContext<THREE.MeshStandardMaterial | null>(null);
const GoldContext = createContext<THREE.MeshStandardMaterial | null>(null);
const ClothContext = createContext<THREE.MeshStandardMaterial | null>(null);
const GlowContext = createContext<THREE.MeshStandardMaterial | null>(null);

interface PartProps {
  geometry: React.ReactNode;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
}

const StonePart: React.FC<PartProps> = ({ geometry, ...props }) => {
  const material = useContext(StoneContext);
  return <mesh material={material ?? undefined} castShadow receiveShadow {...props}>{geometry}</mesh>;
};

const WeaponPart: React.FC<PartProps> = ({ geometry, ...props }) => {
  const material = useContext(WeaponContext);
  return <mesh material={material ?? undefined} castShadow receiveShadow {...props}>{geometry}</mesh>;
};

const GoldPart: React.FC<PartProps> = ({ geometry, ...props }) => {
  const material = useContext(GoldContext);
  return <mesh material={material ?? undefined} castShadow receiveShadow {...props}>{geometry}</mesh>;
};

const ClothPart: React.FC<PartProps> = ({ geometry, ...props }) => {
  const material = useContext(ClothContext);
  return <mesh material={material ?? undefined} castShadow receiveShadow {...props}>{geometry}</mesh>;
};

const GlowPart: React.FC<PartProps> = ({ geometry, ...props }) => {
  const material = useContext(GlowContext);
  return <mesh material={material ?? undefined} castShadow receiveShadow {...props}>{geometry}</mesh>;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const WeaponRig: React.FC<{ animation?: PieceAnimation; children: React.ReactNode }> = ({ animation, children }) => {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const age = animation?.combatStartedAt ? Date.now() - animation.combatStartedAt : -1;
    const strike = age >= 0 ? Math.sin(clamp01(age / 1050) * Math.PI) : 0;
    ref.current.rotation.x = animation?.attacker ? -0.56 * strike : 0;
    ref.current.rotation.z = animation?.attacker ? 0.08 * strike : 0;
  });
  return <group ref={ref}>{children}</group>;
};

const PieceShell: React.FC<PieceProps & { children: React.ReactNode }> = ({
  children,
  color,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  animation,
}) => {
  const stone = useMemo(() => createStoneMaterial(color), [color]);
  const weapon = useMemo(() => createWeaponMaterial(), []);
  const gold = useMemo(() => createGoldMaterial(), []);
  const cloth = useMemo(() => createClothMaterial(color), [color]);
  const glow = useMemo(() => createGlowMaterial(color), [color]);
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const breath = Math.sin(clock.getElapsedTime() * 1.22 + position[0] * 0.4) * 0.008;
    const combatAge = animation?.combatStartedAt ? Date.now() - animation.combatStartedAt : -1;
    const strike = combatAge >= 0 ? Math.sin(clamp01(combatAge / 1050) * Math.PI) : 0;
    ref.current.rotation.x = rotation[0] + (animation?.attacker ? -0.10 * strike : 0);
    ref.current.rotation.y = rotation[1] + breath;
    ref.current.rotation.z = rotation[2] + breath * 0.65;
  });
  return (
    <StoneContext.Provider value={stone}>
      <WeaponContext.Provider value={weapon}>
        <GoldContext.Provider value={gold}>
          <ClothContext.Provider value={cloth}>
            <GlowContext.Provider value={glow}>
              <group ref={ref} position={position}>
                {children}
              </group>
            </GlowContext.Provider>
          </ClothContext.Provider>
        </GoldContext.Provider>
      </WeaponContext.Provider>
    </StoneContext.Provider>
  );
};

/** Helmeted foot soldier with plated shoulders, a spear, and a hand-and-a-half sword. */
export const ProceduralPawn: React.FC<PieceProps> = ({ animation, ...props }) => (
  <PieceShell {...props} animation={animation}>
    <StonePart geometry={<cylinderGeometry args={[0.34, 0.45, 0.16, 8]} />} position={[0, 0.08, 0]} />
    <StonePart geometry={<torusGeometry args={[0.35, 0.045, 6, 8]} />} position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]} />
    <ClothPart geometry={<cylinderGeometry args={[0.24, 0.33, 0.63, 8]} />} position={[0, 0.52, 0]} />
    <StonePart geometry={<torusGeometry args={[0.28, 0.045, 5, 8]} />} position={[0, 0.78, 0]} rotation={[Math.PI / 2, 0, 0]} />
    <StonePart geometry={<sphereGeometry args={[0.23, 10, 7]} />} position={[0, 1.07, 0]} />
    <GlowPart geometry={<sphereGeometry args={[0.026, 7, 5]} />} position={[-0.085, 1.10, 0.215]} />
    <GlowPart geometry={<sphereGeometry args={[0.026, 7, 5]} />} position={[0.085, 1.10, 0.215]} />
    <StonePart geometry={<cylinderGeometry args={[0.29, 0.24, 0.14, 8]} />} position={[0, 1.26, 0]} />
    <StonePart geometry={<sphereGeometry args={[0.29, 10, 6]} />} position={[0, 1.30, 0]} scale={[1, 0.42, 1]} />
    <StonePart geometry={<boxGeometry args={[0.40, 0.10, 0.15]} />} position={[0, 1.13, 0.22]} />
    <StonePart geometry={<sphereGeometry args={[0.15, 8, 5]} />} position={[-0.28, 0.79, 0]} scale={[1.4, 0.72, 1]} />
    <StonePart geometry={<sphereGeometry args={[0.15, 8, 5]} />} position={[0.28, 0.79, 0]} scale={[1.4, 0.72, 1]} />
    <StonePart geometry={<cylinderGeometry args={[0.055, 0.075, 0.47, 6]} />} position={[-0.29, 0.59, 0.02]} rotation={[0, 0, -0.36]} />
    <StonePart geometry={<cylinderGeometry args={[0.055, 0.075, 0.47, 6]} />} position={[0.29, 0.59, 0.02]} rotation={[0, 0, 0.36]} />
    <WeaponRig animation={animation}>
      <WeaponPart geometry={<cylinderGeometry args={[0.035, 0.045, 0.50, 6]} />} position={[0.39, 0.75, 0.19]} rotation={[0, 0, -0.18]} />
      <WeaponPart geometry={<boxGeometry args={[0.07, 0.58, 0.035]} />} position={[0.44, 1.12, 0.18]} rotation={[0, 0, -0.18]} />
      <GoldPart geometry={<boxGeometry args={[0.25, 0.045, 0.07]} />} position={[0.40, 0.92, 0.18]} rotation={[0, 0, -0.18]} />
      <WeaponPart geometry={<cylinderGeometry args={[0.025, 0.025, 1.15, 6]} />} position={[-0.39, 1.03, -0.03]} />
      <WeaponPart geometry={<coneGeometry args={[0.09, 0.24, 5]} />} position={[-0.39, 1.70, -0.03]} />
    </WeaponRig>
  </PieceShell>
);

/** Broad shield-bearing warden with a castle helm and a brutal flanged mace. */
export const ProceduralRook: React.FC<PieceProps> = ({ animation, ...props }) => (
  <PieceShell {...props} animation={animation}>
    <StonePart geometry={<cylinderGeometry args={[0.38, 0.50, 0.18, 8]} />} position={[0, 0.09, 0]} />
    <StonePart geometry={<torusGeometry args={[0.41, 0.045, 5, 8]} />} position={[0, 0.20, 0]} rotation={[Math.PI / 2, 0, 0]} />
    <ClothPart geometry={<boxGeometry args={[0.66, 0.72, 0.50]} />} position={[0, 0.57, 0]} />
    <StonePart geometry={<boxGeometry args={[0.82, 0.16, 0.60]} />} position={[0, 0.88, 0]} />
    <StonePart geometry={<sphereGeometry args={[0.17, 8, 5]} />} position={[-0.38, 0.78, 0]} scale={[1.1, 0.85, 1]} />
    <StonePart geometry={<sphereGeometry args={[0.17, 8, 5]} />} position={[0.38, 0.78, 0]} scale={[1.1, 0.85, 1]} />
    <StonePart geometry={<cylinderGeometry args={[0.36, 0.43, 0.30, 8]} />} position={[0, 1.10, 0]} />
    <StonePart geometry={<sphereGeometry args={[0.37, 10, 6]} />} position={[0, 1.24, 0]} scale={[1, 0.55, 1]} />
    <GlowPart geometry={<sphereGeometry args={[0.026, 7, 5]} />} position={[-0.12, 1.20, 0.30]} />
    <GlowPart geometry={<sphereGeometry args={[0.026, 7, 5]} />} position={[0.12, 1.20, 0.30]} />
    <StonePart geometry={<boxGeometry args={[0.48, 0.13, 0.19]} />} position={[0, 1.15, 0.30]} />
    <StonePart geometry={<boxGeometry args={[0.17, 0.26, 0.29]} />} position={[-0.28, 1.47, 0]} />
    <StonePart geometry={<boxGeometry args={[0.17, 0.26, 0.29]} />} position={[-0.09, 1.47, 0]} />
    <StonePart geometry={<boxGeometry args={[0.17, 0.26, 0.29]} />} position={[0.10, 1.47, 0]} />
    <StonePart geometry={<boxGeometry args={[0.17, 0.26, 0.29]} />} position={[0.29, 1.47, 0]} />
    <StonePart geometry={<cylinderGeometry args={[0.055, 0.055, 0.90, 6]} />} position={[0.36, 0.65, 0.38]} rotation={[Math.PI / 2, 0, 0]} />
    <StonePart geometry={<boxGeometry args={[0.66, 0.68, 0.09]} />} position={[0, 0.69, 0.39]} />
    <GoldPart geometry={<torusGeometry args={[0.10, 0.025, 5, 12]} />} position={[0, 0.69, 0.45]} rotation={[Math.PI / 2, 0, 0]} />
    <WeaponRig animation={animation}>
      <WeaponPart geometry={<cylinderGeometry args={[0.045, 0.06, 0.78, 6]} />} position={[-0.46, 0.70, 0.18]} rotation={[0, 0, -0.48]} />
      <WeaponPart geometry={<boxGeometry args={[0.22, 0.10, 0.10]} />} position={[-0.63, 1.01, 0.18]} />
      <WeaponPart geometry={<coneGeometry args={[0.085, 0.20, 6]} />} position={[-0.63, 1.16, 0.18]} />
    </WeaponRig>
  </PieceShell>
);

/** A carved destrier: articulated legs, sloping neck, muzzle, ears, and a ridged mane. */
export const ProceduralKnight: React.FC<PieceProps> = ({ animation, ...props }) => (
  <PieceShell {...props} animation={animation}>
    <StonePart geometry={<cylinderGeometry args={[0.36, 0.48, 0.17, 8]} />} position={[0, 0.085, 0]} />
    <StonePart geometry={<torusGeometry args={[0.37, 0.045, 5, 8]} />} position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]} />
    <StonePart geometry={<boxGeometry args={[0.58, 0.42, 0.82]} />} position={[0, 0.47, 0.02]} rotation={[0.08, 0, 0]} />
    <ClothPart geometry={<boxGeometry args={[0.48, 0.55, 0.30]} />} position={[0, 0.66, -0.22]} />
    <StonePart geometry={<cylinderGeometry args={[0.13, 0.18, 0.76, 7]} />} position={[0, 1.00, -0.05]} rotation={[-0.48, 0, 0]} />
    <StonePart geometry={<boxGeometry args={[0.36, 0.31, 0.48]} />} position={[0, 1.35, 0.22]} rotation={[-0.13, 0, 0]} />
    <StonePart geometry={<boxGeometry args={[0.28, 0.24, 0.40]} />} position={[0, 1.34, 0.56]} rotation={[0.08, 0, 0]} />
    <GlowPart geometry={<sphereGeometry args={[0.028, 7, 5]} />} position={[-0.10, 1.39, 0.75]} />
    <GlowPart geometry={<sphereGeometry args={[0.028, 7, 5]} />} position={[0.10, 1.39, 0.75]} />
    <StonePart geometry={<coneGeometry args={[0.075, 0.23, 4]} />} position={[-0.14, 1.63, 0.22]} rotation={[0.18, 0, -0.18]} />
    <StonePart geometry={<coneGeometry args={[0.075, 0.23, 4]} />} position={[0.14, 1.63, 0.22]} rotation={[0.18, 0, 0.18]} />
    <StonePart geometry={<coneGeometry args={[0.06, 0.13, 5]} />} position={[-0.11, 1.35, 0.78]} rotation={[Math.PI / 2, 0, 0]} />
    <StonePart geometry={<coneGeometry args={[0.06, 0.13, 5]} />} position={[0.11, 1.35, 0.78]} rotation={[Math.PI / 2, 0, 0]} />
    {[-0.24, 0.24].flatMap((x) => [-0.23, 0.25].map((z) => (
      <StonePart key={`${x}-${z}`} geometry={<cylinderGeometry args={[0.075, 0.10, 0.56, 6]} />} position={[x, 0.22, z]} rotation={[z > 0 ? -0.10 : 0.10, x * 0.28, 0]} />
    )))}
    {[-0.27, -0.13, 0, 0.13, 0.27].map((x, index) => (
      <StonePart key={x} geometry={<coneGeometry args={[0.075, 0.24, 5]} />} position={[x, 1.05 + index * 0.09, -0.30]} rotation={[0, 0, Math.PI / 2]} />
    ))}
    <StonePart geometry={<torusGeometry args={[0.18, 0.025, 4, 8]} />} position={[0, 1.36, 0.42]} rotation={[Math.PI / 2, 0, 0]} />
    <WeaponRig animation={animation}>
      <WeaponPart geometry={<cylinderGeometry args={[0.032, 0.032, 0.75, 6]} />} position={[0.39, 0.82, 0.18]} rotation={[0, 0, -0.34]} />
      <GoldPart geometry={<boxGeometry args={[0.20, 0.035, 0.035]} />} position={[0.38, 1.08, 0.18]} rotation={[0, 0, -0.34]} />
    </WeaponRig>
  </PieceShell>
);

/** Hooded stone mage with a split mitre and a hooked ceremonial staff. */
export const ProceduralBishop: React.FC<PieceProps> = ({ animation, ...props }) => (
  <PieceShell {...props} animation={animation}>
    <StonePart geometry={<cylinderGeometry args={[0.36, 0.47, 0.17, 8]} />} position={[0, 0.085, 0]} />
    <StonePart geometry={<torusGeometry args={[0.38, 0.045, 5, 8]} />} position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]} />
    <ClothPart geometry={<coneGeometry args={[0.40, 1.00, 8]} />} position={[0, 0.67, 0]} />
    <StonePart geometry={<sphereGeometry args={[0.28, 9, 6]} />} position={[0, 1.13, 0.03]} />
    <GlowPart geometry={<sphereGeometry args={[0.026, 7, 5]} />} position={[-0.085, 1.15, 0.245]} />
    <GlowPart geometry={<sphereGeometry args={[0.026, 7, 5]} />} position={[0.085, 1.15, 0.245]} />
    <StonePart geometry={<torusGeometry args={[0.28, 0.06, 6, 10]} />} position={[0, 1.22, 0]} rotation={[Math.PI / 2, 0, 0]} />
    <StonePart geometry={<coneGeometry args={[0.32, 0.45, 6]} />} position={[-0.12, 1.47, 0]} rotation={[0, 0, -0.18]} />
    <StonePart geometry={<coneGeometry args={[0.32, 0.45, 6]} />} position={[0.12, 1.47, 0]} rotation={[0, 0, 0.18]} />
    <StonePart geometry={<boxGeometry args={[0.06, 0.42, 0.07]} />} position={[0, 1.48, 0.26]} rotation={[0, 0, -0.64]} />
    <StonePart geometry={<sphereGeometry args={[0.13, 8, 5]} />} position={[-0.25, 0.87, 0]} scale={[1.2, 0.8, 1]} />
    <StonePart geometry={<sphereGeometry args={[0.13, 8, 5]} />} position={[0.25, 0.87, 0]} scale={[1.2, 0.8, 1]} />
    <WeaponRig animation={animation}>
      <WeaponPart geometry={<cylinderGeometry args={[0.032, 0.032, 1.38, 6]} />} position={[0.34, 0.84, 0.12]} />
      <WeaponPart geometry={<torusGeometry args={[0.12, 0.027, 5, 10]} />} position={[0.34, 1.51, 0.12]} rotation={[Math.PI / 2, 0, 0]} />
      <GoldPart geometry={<sphereGeometry args={[0.06, 8, 5]} />} position={[0.34, 1.63, 0.12]} />
    </WeaponRig>
  </PieceShell>
);

/** Seated gothic witch-queen with throne wings, crown points, and a hidden dagger. */
export const ProceduralQueen: React.FC<PieceProps> = ({ animation, ...props }) => (
  <PieceShell {...props} animation={animation}>
    <StonePart geometry={<cylinderGeometry args={[0.42, 0.53, 0.18, 8]} />} position={[0, 0.09, 0]} />
    <StonePart geometry={<boxGeometry args={[0.88, 0.22, 0.76]} />} position={[0, 0.25, 0]} />
    <StonePart geometry={<boxGeometry args={[0.78, 1.46, 0.18]} />} position={[0, 0.97, -0.28]} />
    <StonePart geometry={<boxGeometry args={[0.16, 1.38, 0.36]} />} position={[-0.41, 0.95, -0.12]} />
    <StonePart geometry={<boxGeometry args={[0.16, 1.38, 0.36]} />} position={[0.41, 0.95, -0.12]} />
    <StonePart geometry={<coneGeometry args={[0.55, 0.32, 8]} />} position={[0, 1.67, -0.25]} rotation={[Math.PI, 0, 0]} />
    <ClothPart geometry={<coneGeometry args={[0.29, 0.78, 8]} />} position={[0, 0.70, 0.05]} />
    <StonePart geometry={<sphereGeometry args={[0.24, 10, 7]} />} position={[0, 1.27, 0.05]} />
    <GlowPart geometry={<sphereGeometry args={[0.026, 7, 5]} />} position={[-0.08, 1.29, 0.255]} />
    <GlowPart geometry={<sphereGeometry args={[0.026, 7, 5]} />} position={[0.08, 1.29, 0.255]} />
    <StonePart geometry={<cylinderGeometry args={[0.27, 0.21, 0.14, 8]} />} position={[0, 1.50, 0.05]} />
    <GoldPart geometry={<torusGeometry args={[0.27, 0.035, 5, 10]} />} position={[0, 1.57, 0.05]} rotation={[Math.PI / 2, 0, 0]} />
    {[-0.18, 0, 0.18].map((x, index) => (
      <GoldPart key={x} geometry={<coneGeometry args={[0.055, index === 1 ? 0.28 : 0.21, 5]} />} position={[x, 1.73 + (index === 1 ? 0.03 : 0), 0.05]} />
    ))}
    <StonePart geometry={<cylinderGeometry args={[0.055, 0.07, 0.48, 6]} />} position={[-0.28, 0.80, 0.28]} rotation={[0, 0, -0.42]} />
    <StonePart geometry={<cylinderGeometry args={[0.055, 0.07, 0.48, 6]} />} position={[0.28, 0.80, 0.28]} rotation={[0, 0, 0.42]} />
    <WeaponRig animation={animation}>
      <WeaponPart geometry={<cylinderGeometry args={[0.025, 0.035, 0.50, 6]} />} position={[0.33, 0.85, 0.38]} rotation={[0, 0, -0.50]} />
      <WeaponPart geometry={<boxGeometry args={[0.05, 0.32, 0.04]} />} position={[0.46, 1.10, 0.39]} rotation={[0, 0, -0.50]} />
      <GoldPart geometry={<boxGeometry args={[0.17, 0.035, 0.05]} />} position={[0.35, 0.98, 0.38]} rotation={[0, 0, -0.50]} />
    </WeaponRig>
  </PieceShell>
);

/** Crowned sovereign on a raised dais, carrying the signature horizontal broadsword. */
export const ProceduralKing: React.FC<PieceProps> = ({ animation, ...props }) => (
  <PieceShell {...props} animation={animation}>
    <StonePart geometry={<cylinderGeometry args={[0.45, 0.56, 0.18, 8]} />} position={[0, 0.09, 0]} />
    <StonePart geometry={<boxGeometry args={[0.96, 0.24, 0.80]} />} position={[0, 0.26, 0]} />
    <StonePart geometry={<boxGeometry args={[0.92, 1.58, 0.23]} />} position={[0, 1.02, -0.28]} />
    <StonePart geometry={<boxGeometry args={[0.18, 1.50, 0.38]} />} position={[-0.46, 1.00, -0.10]} />
    <StonePart geometry={<boxGeometry args={[0.18, 1.50, 0.38]} />} position={[0.46, 1.00, -0.10]} />
    <StonePart geometry={<coneGeometry args={[0.34, 0.24, 8]} />} position={[0, 1.72, -0.27]} rotation={[Math.PI, 0, 0]} />
    <ClothPart geometry={<coneGeometry args={[0.34, 0.78, 8]} />} position={[0, 0.72, 0.05]} />
    <StonePart geometry={<sphereGeometry args={[0.25, 10, 7]} />} position={[0, 1.39, 0.04]} />
    <GlowPart geometry={<sphereGeometry args={[0.026, 7, 5]} />} position={[-0.08, 1.41, 0.255]} />
    <GlowPart geometry={<sphereGeometry args={[0.026, 7, 5]} />} position={[0.08, 1.41, 0.255]} />
    <StonePart geometry={<coneGeometry args={[0.15, 0.24, 7]} />} position={[0, 1.25, 0.23]} rotation={[Math.PI, 0, 0]} />
    <StonePart geometry={<cylinderGeometry args={[0.31, 0.23, 0.16, 8]} />} position={[0, 1.63, 0.04]} />
    <GoldPart geometry={<boxGeometry args={[0.08, 0.29, 0.08]} />} position={[0, 1.88, 0.04]} />
    <GoldPart geometry={<boxGeometry args={[0.30, 0.08, 0.08]} />} position={[0, 1.88, 0.04]} />
    <StonePart geometry={<sphereGeometry args={[0.17, 8, 5]} />} position={[-0.31, 0.84, 0.04]} scale={[1.15, 0.78, 1]} />
    <StonePart geometry={<sphereGeometry args={[0.17, 8, 5]} />} position={[0.31, 0.84, 0.04]} scale={[1.15, 0.78, 1]} />
    <WeaponRig animation={animation}>
      <WeaponPart geometry={<cylinderGeometry args={[0.045, 0.045, 1.24, 7]} />} position={[0, 0.72, 0.51]} rotation={[Math.PI / 2, 0, 0]} />
      <WeaponPart geometry={<boxGeometry args={[0.66, 0.13, 0.07]} />} position={[0.0, 0.72, 0.51]} />
      <GoldPart geometry={<boxGeometry args={[0.06, 0.28, 0.06]} />} position={[0, 0.72, 0.51]} />
      <WeaponPart geometry={<coneGeometry args={[0.13, 0.26, 6]} />} position={[0.69, 0.72, 0.51]} rotation={[0, 0, -Math.PI / 2]} />
    </WeaponRig>
  </PieceShell>
);

export const PieceModel: React.FC<{ kind: PieceKind; color: PieceColor; animation?: PieceAnimation }> = ({ kind, color, animation }) => {
  switch (kind) {
    case 'pawn': return <ProceduralPawn color={color} animation={animation} />;
    case 'rook': return <ProceduralRook color={color} animation={animation} />;
    case 'knight': return <ProceduralKnight color={color} animation={animation} />;
    case 'bishop': return <ProceduralBishop color={color} animation={animation} />;
    case 'queen': return <ProceduralQueen color={color} animation={animation} />;
    case 'king': return <ProceduralKing color={color} animation={animation} />;
  }
};
