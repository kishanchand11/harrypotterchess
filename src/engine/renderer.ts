import * as THREE from 'three';

/**
 * R3F accepts an async renderer factory. Prefer the native renderer when the browser exposes
 * WebGPU, but keep the WebGL path as a dependable fallback for older browsers and embedded
 * previews. The scene itself is intentionally renderer-agnostic.
 */
export async function createAdaptiveRenderer(
  defaults: THREE.WebGLRendererParameters,
): Promise<THREE.WebGLRenderer> {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const { WebGPURenderer } = await import('three/webgpu');
      const renderer = new WebGPURenderer(defaults as never);
      await renderer.init();
      return renderer as unknown as THREE.WebGLRenderer;
    } catch {
      // WebGPU can be advertised while its adapter is unavailable; fall through to WebGL.
    }
  }
  return new THREE.WebGLRenderer(defaults);
}
