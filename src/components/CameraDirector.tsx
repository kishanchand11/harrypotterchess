import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { gsap } from 'gsap';
import * as THREE from 'three';
import { squareToPosition, type CombatSequence } from '../types/chess';

interface CameraDirectorProps {
  combat: CombatSequence | null;
}

interface CameraCut {
  from: THREE.Vector3;
  to: THREE.Vector3;
  focus: THREE.Vector3;
  progress: { value: number };
}

const overview = new THREE.Vector3(9.35, 8.9, 10.45);
const overviewLook = new THREE.Vector3(0, 0.25, 0);

export const CameraDirector: React.FC<CameraDirectorProps> = ({ combat }) => {
  const { camera } = useThree();
  const cutRef = useRef<CameraCut | null>(null);
  const lastCombatId = useRef<number | null>(null);

  useEffect(() => {
    if (combat && combat.id !== lastCombatId.current) {
      lastCombatId.current = combat.id;
      const [x, , z] = squareToPosition(combat.to, 1.15);
      const focus = new THREE.Vector3(x, 0.95, z);
      const from = camera.position.clone();
      const approach = new THREE.Vector3(x + (x > 0 ? 4.3 : -4.3), 3.35, z + (z > 0 ? 4.8 : -4.8));
      const progress = { value: 0 };
      cutRef.current = { from, to: approach, focus, progress };
      const tween = gsap.to(progress, {
        value: 1,
        duration: 0.78,
        ease: 'power3.inOut',
      });
      return () => {
        tween.kill();
      };
    }
    if (!combat) {
      lastCombatId.current = null;
      cutRef.current = null;
    }
    return undefined;
  }, [camera, combat]);

  useFrame(() => {
    const cut = cutRef.current;
    if (cut) {
      camera.position.lerpVectors(cut.from, cut.to, cut.progress.value);
      const impactAge = Math.max(0, Date.now() - combat!.impactAt);
      const shake = Math.max(0, 1 - impactAge / 560) * 0.10;
      camera.position.x += Math.sin(impactAge * 0.13) * shake;
      camera.position.y += Math.cos(impactAge * 0.17) * shake * 0.65;
      camera.lookAt(cut.focus);
    } else {
      camera.position.lerp(overview, 0.035);
      camera.lookAt(overviewLook);
    }
  });

  return null;
};
