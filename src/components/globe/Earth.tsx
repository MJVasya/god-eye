import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { GLOBE_RADIUS, sunDirection } from "@/lib/geo/math";
import type { SensorMode } from "@/lib/geo/types";

const vert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDir;
  uniform float mode;
  varying vec2 vUv;
  varying vec3 vN;
  void main() {
    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 lights = texture2D(nightMap, vUv).rgb;
    vec3 night = day * vec3(0.055, 0.07, 0.11) + lights * 2.15;
    float ndl = dot(normalize(vN), normalize(sunDir));
    float f = smoothstep(-0.02, 0.10, ndl);
    vec3 color = mix(night, day, f);

    float lat = vUv.y * 180.0;
    float lon = vUv.x * 360.0;
    float latCell = abs(fract(lat / 15.0 + 0.5) - 0.5) * 15.0;
    float lonCell = abs(fract(lon / 15.0 + 0.5) - 0.5) * 15.0;
    float latW = max(fwidth(lat), 1.0e-4);
    float lonW = max(fwidth(lon), 1.0e-4);
    float grid = max(
      1.0 - smoothstep(0.0, latW * 1.35, latCell),
      1.0 - smoothstep(0.0, lonW * 1.35, lonCell)
    );
    color += vec3(0.16, 0.26, 0.20) * grid * 0.28;

    float grain = fract(sin(dot(vUv * vec2(1800.0, 900.0), vec2(12.9898, 78.233))) * 43758.5453);
    color += (grain - 0.5) * 0.018;

    if (mode < 0.5) {
      color *= vec3(0.96, 0.98, 1.0);
    } else if (mode < 1.5) {
      float g = dot(color, vec3(0.15, 0.75, 0.10));
      color = vec3(g * 0.12, g * 1.18, g * 0.28);
    } else if (mode < 2.5) {
      float l = dot(color, vec3(0.25, 0.55, 0.20));
      vec3 cold = vec3(0.02, 0.0, 0.18);
      vec3 hot = vec3(0.95, 0.18, 0.04);
      vec3 white = vec3(1.0, 0.94, 0.72);
      color = mix(mix(cold, hot, smoothstep(0.0, 0.45, l)), white, smoothstep(0.45, 1.0, l));
    } else if (mode < 3.5) {
      float g = dot(color, vec3(0.3, 0.5, 0.2));
      color = vec3(g * 0.95, g * 0.97, g * 1.02);
    } else {
      color = pow(color, vec3(0.85)) * vec3(0.85, 1.05, 0.8);
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function Earth({ sensor }: { sensor: SensorMode }) {
  const dayMap = useTexture("/textures/earth-day.jpg");
  const nightMap = useTexture("/textures/earth-night.jpg");
  const { gl } = useThree();
  const sun = useRef(new THREE.Vector3(1, 0.2, 0.4));
  const mat = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: dayMap },
        nightMap: { value: nightMap },
        sunDir: { value: sun.current },
        mode: { value: 0 },
      },
      vertexShader: vert,
      fragmentShader: frag,
    });
  }, [dayMap, nightMap]);

  useEffect(() => {
    gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    const aniso = gl.capabilities.getMaxAnisotropy();
    for (const tex of [dayMap, nightMap]) {
      tex.colorSpace = THREE.NoColorSpace;
      tex.anisotropy = aniso;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
    }
  }, [gl, dayMap, nightMap]);

  useEffect(() => {
    const mode =
      sensor === "nvg" ? 1 : sensor === "flir" ? 2 : sensor === "noir" ? 3 : sensor === "crt" ? 4 : 0;
    mat.uniforms.mode.value = mode;
  }, [sensor, mat]);

  useFrame(() => {
    sunDirection(new Date(), sun.current);
    mat.uniforms.sunDir.value.copy(sun.current);
  });

  const atmoColor =
    sensor === "nvg" ? "#3dff7a" : sensor === "flir" ? "#ff6a2a" : "#79a7ff";

  return (
    <group>
      <mesh material={mat}>
        <sphereGeometry args={[GLOBE_RADIUS, 128, 128]} />
      </mesh>
      <mesh scale={1.018}>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
        <meshBasicMaterial
          color={atmoColor}
          transparent
          opacity={sensor === "noir" ? 0.04 : 0.11}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
