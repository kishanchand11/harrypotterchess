import React, { useMemo } from 'react';
import * as THREE from 'three';
import type { PieceColor, PieceKind } from '../types/chess';

export interface PieceProps {
  color: PieceColor;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

/**
 * A deliberately asset-free stone material. The noise is evaluated in world space so compound
 * Lewis-style primitives read as one carved object instead of a collection of clean primitives.
 */
export function createStoneMaterial(colorType: PieceColor): THREE.MeshStandardMaterial {
  const isWhite = colorType === 'white';
  const baseColor = isWhite ? new THREE.Color('#d6d0c4') : new THREE.Color('#202329');
  const crackColor = isWhite ? new THREE.Color('#625d56') : new THREE.Color('#050608');

  const material = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: isWhite ? 0.86 : 0.74,
    metalness: isWhite ? 0.05 : 0.12,
    flatShading: true,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCrackColor = { value: crackColor };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWizardWorldPosition;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vWizardWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader.replace(
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
    );

    shader.fragmentShader = shader.fragmentShader.replace(
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

function PieceShell({ children, color, position = [0, 0, 0], rotation = [0, 0, 0] }: PieceProps & { children: React.ReactNode }) {
  const material = useMemo(() => createStoneMaterial(color), [color]);
  return (
    <group position={position} rotation={rotation}>
      {React.Children.map(children, (child) => React.isValidElement(child)
        ? React.cloneElement(child as React.ReactElement<{ material?: THREE.Material }>, { material })
        : child)}
    </group>
  );
}

const mesh = (geometry: React.ReactNode, props: Record<string, unknown> = {}) => (
  <mesh castShadow receiveShadow {...props}>{geometry}</mesh>
);

export const ProceduralPawn: React.FC<PieceProps> = (props) => (
  <PieceShell {...props}>
    {mesh(<cylinderGeometry args={[0.34, 0.43, 0.16, 8]} />, { position: [0, 0.08, 0] })}
    {mesh(<torusGeometry args={[0.34, 0.055, 5, 8]} />, { position: [0, 0.17, 0], rotation: [Math.PI / 2, 0, 0] })}
    {mesh(<cylinderGeometry args={[0.21, 0.31, 0.68, 8]} />, { position: [0, 0.52, 0] })}
    {mesh(<coneGeometry args={[0.24, 0.20, 8]} />, { position: [0, 0.89, 0] })}
    {mesh(<sphereGeometry args={[0.235, 10, 7]} />, { position: [0, 1.08, 0] })}
    {mesh(<torusGeometry args={[0.18, 0.035, 5, 8]} />, { position: [0, 1.12, 0], rotation: [Math.PI / 2, 0, 0] })}
  </PieceShell>
);

export const ProceduralRook: React.FC<PieceProps> = (props) => (
  <PieceShell {...props}>
    {mesh(<cylinderGeometry args={[0.37, 0.48, 0.17, 8]} />, { position: [0, 0.085, 0] })}
    {mesh(<torusGeometry args={[0.39, 0.045, 5, 8]} />, { position: [0, 0.18, 0], rotation: [Math.PI / 2, 0, 0] })}
    {mesh(<cylinderGeometry args={[0.33, 0.40, 0.78, 8]} />, { position: [0, 0.56, 0] })}
    {mesh(<boxGeometry args={[0.72, 0.66, 0.22]} />, { position: [0, 0.68, 0.29] })}
    {mesh(<boxGeometry args={[0.30, 0.60, 0.12]} />, { position: [0, 0.68, 0.43] })}
    {mesh(<cylinderGeometry args={[0.43, 0.37, 0.18, 8]} />, { position: [0, 1.02, 0] })}
    {mesh(<boxGeometry args={[0.76, 0.22, 0.23]} />, { position: [0, 1.17, 0] })}
    {mesh(<boxGeometry args={[0.16, 0.25, 0.28]} />, { position: [-0.29, 1.28, 0] })}
    {mesh(<boxGeometry args={[0.16, 0.25, 0.28]} />, { position: [-0.10, 1.28, 0] })}
    {mesh(<boxGeometry args={[0.16, 0.25, 0.28]} />, { position: [0.10, 1.28, 0] })}
    {mesh(<boxGeometry args={[0.16, 0.25, 0.28]} />, { position: [0.29, 1.28, 0] })}
  </PieceShell>
);

export const ProceduralKnight: React.FC<PieceProps> = (props) => (
  <PieceShell {...props}>
    {mesh(<cylinderGeometry args={[0.36, 0.47, 0.17, 8]} />, { position: [0, 0.085, 0] })}
    {mesh(<torusGeometry args={[0.37, 0.045, 5, 8]} />, { position: [0, 0.18, 0], rotation: [Math.PI / 2, 0, 0] })}
    {mesh(<boxGeometry args={[0.52, 0.70, 0.43]} />, { position: [0, 0.54, 0], rotation: [0.22, 0, 0] })}
    {mesh(<boxGeometry args={[0.40, 0.62, 0.42]} />, { position: [0, 0.91, -0.02], rotation: [-0.40, 0, 0] })}
    {mesh(<coneGeometry args={[0.30, 0.58, 6]} />, { position: [0, 1.16, 0.20], rotation: [Math.PI / 2, 0, 0] })}
    {mesh(<boxGeometry args={[0.34, 0.27, 0.48]} />, { position: [0, 1.32, 0.43], rotation: [0.1, 0, 0] })}
    {mesh(<coneGeometry args={[0.075, 0.26, 4]} />, { position: [-0.14, 1.58, 0.18], rotation: [-0.25, 0, -0.12] })}
    {mesh(<coneGeometry args={[0.075, 0.26, 4]} />, { position: [0.14, 1.58, 0.18], rotation: [-0.25, 0, 0.12] })}
    {mesh(<coneGeometry args={[0.07, 0.12, 6]} />, { position: [-0.13, 1.34, 0.69], rotation: [Math.PI / 2, 0, 0] })}
    {mesh(<coneGeometry args={[0.07, 0.12, 6]} />, { position: [0.13, 1.34, 0.69], rotation: [Math.PI / 2, 0, 0] })}
  </PieceShell>
);

export const ProceduralBishop: React.FC<PieceProps> = (props) => (
  <PieceShell {...props}>
    {mesh(<cylinderGeometry args={[0.36, 0.47, 0.17, 8]} />, { position: [0, 0.085, 0] })}
    {mesh(<torusGeometry args={[0.37, 0.045, 5, 8]} />, { position: [0, 0.18, 0], rotation: [Math.PI / 2, 0, 0] })}
    {mesh(<coneGeometry args={[0.39, 0.95, 8]} />, { position: [0, 0.67, 0] })}
    {mesh(<cylinderGeometry args={[0.25, 0.30, 0.34, 8]} />, { position: [0, 1.08, 0] })}
    {mesh(<coneGeometry args={[0.33, 0.43, 6]} />, { position: [0, 1.38, 0] })}
    {mesh(<coneGeometry args={[0.16, 0.38, 6]} />, { position: [0, 1.67, 0] })}
    {mesh(<boxGeometry args={[0.07, 0.43, 0.07]} />, { position: [0, 1.67, 0.18], rotation: [0, 0, -0.62] })}
    {mesh(<cylinderGeometry args={[0.032, 0.032, 1.35, 6]} />, { position: [0.30, 0.84, 0.12] })}
    {mesh(<torusGeometry args={[0.10, 0.027, 5, 8]} />, { position: [0.30, 1.49, 0.12], rotation: [Math.PI / 2, 0, 0] })}
    {mesh(<sphereGeometry args={[0.055, 7, 5]} />, { position: [0.30, 1.59, 0.12] })}
  </PieceShell>
);

export const ProceduralQueen: React.FC<PieceProps> = (props) => (
  <PieceShell {...props}>
    {mesh(<cylinderGeometry args={[0.42, 0.53, 0.18, 8]} />, { position: [0, 0.09, 0] })}
    {mesh(<boxGeometry args={[0.86, 0.22, 0.74]} />, { position: [0, 0.24, 0] })}
    {mesh(<boxGeometry args={[0.76, 1.42, 0.19]} />, { position: [0, 0.96, -0.27] })}
    {mesh(<boxGeometry args={[0.15, 1.38, 0.34]} />, { position: [-0.39, 0.95, -0.12] })}
    {mesh(<boxGeometry args={[0.15, 1.38, 0.34]} />, { position: [0.39, 0.95, -0.12] })}
    {mesh(<boxGeometry args={[0.52, 0.58, 0.50]} />, { position: [0, 0.72, 0.06] })}
    {mesh(<boxGeometry args={[0.60, 0.13, 0.72]} />, { position: [0, 0.48, 0.20] })}
    {mesh(<sphereGeometry args={[0.24, 10, 7]} />, { position: [0, 1.30, 0.04] })}
    {mesh(<cylinderGeometry args={[0.27, 0.20, 0.16, 8]} />, { position: [0, 1.53, 0.04] })}
    {mesh(<coneGeometry args={[0.06, 0.20, 5]} />, { position: [-0.17, 1.70, 0.04] })}
    {mesh(<coneGeometry args={[0.06, 0.26, 5]} />, { position: [0, 1.73, 0.04] })}
    {mesh(<coneGeometry args={[0.06, 0.20, 5]} />, { position: [0.17, 1.70, 0.04] })}
    {mesh(<boxGeometry args={[0.06, 0.48, 0.06]} />, { position: [-0.23, 0.82, 0.35], rotation: [0, 0, -0.38] })}
    {mesh(<boxGeometry args={[0.06, 0.48, 0.06]} />, { position: [0.23, 0.82, 0.35], rotation: [0, 0, 0.38] })}
  </PieceShell>
);

export const ProceduralKing: React.FC<PieceProps> = (props) => (
  <PieceShell {...props}>
    {mesh(<cylinderGeometry args={[0.45, 0.55, 0.18, 8]} />, { position: [0, 0.09, 0] })}
    {mesh(<boxGeometry args={[0.96, 0.25, 0.78]} />, { position: [0, 0.26, 0] })}
    {mesh(<boxGeometry args={[0.91, 1.58, 0.23]} />, { position: [0, 1.04, -0.27] })}
    {mesh(<boxGeometry args={[0.18, 1.50, 0.38]} />, { position: [-0.45, 1.02, -0.10] })}
    {mesh(<boxGeometry args={[0.18, 1.50, 0.38]} />, { position: [0.45, 1.02, -0.10] })}
    {mesh(<boxGeometry args={[0.61, 0.68, 0.54]} />, { position: [0, 0.76, 0.05] })}
    {mesh(<boxGeometry args={[0.70, 0.14, 0.82]} />, { position: [0, 0.51, 0.20] })}
    {mesh(<sphereGeometry args={[0.25, 10, 7]} />, { position: [0, 1.42, 0.04] })}
    {mesh(<cylinderGeometry args={[0.31, 0.23, 0.18, 8]} />, { position: [0, 1.66, 0.04] })}
    {mesh(<boxGeometry args={[0.08, 0.29, 0.08]} />, { position: [0, 1.91, 0.04] })}
    {mesh(<boxGeometry args={[0.28, 0.08, 0.08]} />, { position: [0, 1.91, 0.04] })}
    {mesh(<cylinderGeometry args={[0.045, 0.045, 1.18, 6]} />, { position: [0, 0.77, 0.52], rotation: [Math.PI / 2, 0, 0] })}
    {mesh(<coneGeometry args={[0.12, 0.26, 6]} />, { position: [0.62, 0.77, 0.52], rotation: [Math.PI / 2, 0, 0] })}
  </PieceShell>
);

export const PieceModel: React.FC<{ kind: PieceKind; color: PieceColor }> = ({ kind, color }) => {
  switch (kind) {
    case 'pawn': return <ProceduralPawn color={color} />;
    case 'rook': return <ProceduralRook color={color} />;
    case 'knight': return <ProceduralKnight color={color} />;
    case 'bishop': return <ProceduralBishop color={color} />;
    case 'queen': return <ProceduralQueen color={color} />;
    case 'king': return <ProceduralKing color={color} />;
  }
};
