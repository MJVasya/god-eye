import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { GLOBE_RADIUS, headingOffset, latLngToVec3, MIN_CAMERA_DISTANCE } from "@/lib/geo/math";
import type { CameraMode, Contact } from "@/lib/geo/types";
import type { FlyTo } from "@/store/ops";

const desired = new THREE.Vector3();
const look = new THREE.Vector3();
const tmp = new THREE.Vector3();

type ControlsApi = {
  target: THREE.Vector3;
  update: () => void;
};

export function CameraRig({
  mode,
  target,
  flyTo,
}: {
  mode: CameraMode;
  target: Contact | null;
  flyTo: FlyTo | null;
}) {
  const controls = useRef<ControlsApi | null>(null);
  const { camera } = useThree();
  const guided = mode !== "free" && target != null;

  useEffect(() => {
    if (!flyTo) return;
    latLngToVec3(flyTo.lat, flyTo.lng, flyTo.altKm, GLOBE_RADIUS, desired);
    camera.position.copy(desired);
    camera.lookAt(0, 0, 0);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
  }, [flyTo, camera]);

  useFrame((_, dt) => {
    if (!target || mode === "free") return;
    const d = Math.min(dt, 0.1);
    const k = 1 - Math.exp(-(mode === "cockpit" ? 4.2 : 2.4) * d);
    if (mode === "cockpit") {
      const ahead = headingOffset(target.lat, target.lng, target.heading || 90, 90);
      latLngToVec3(target.lat, target.lng, Math.max(target.altKm, 0.4) + 0.8, GLOBE_RADIUS, desired);
      tmp.copy(desired).normalize().multiplyScalar(0.035);
      desired.add(tmp);
      latLngToVec3(ahead.lat, ahead.lng, Math.max(target.altKm - 4, 0.2), GLOBE_RADIUS, look);
    } else {
      latLngToVec3(target.lat, target.lng, target.altKm, GLOBE_RADIUS, look);
      desired.copy(look).normalize().multiplyScalar(look.length() + 0.55);
    }
    camera.position.lerp(desired, k);
    const cur = controls.current?.target ?? look;
    cur.lerp(look, k);
    camera.lookAt(cur);
    if (controls.current) {
      controls.current.target.copy(cur);
      controls.current.update();
    }
  });

  return (
    <OrbitControls
      ref={controls as never}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={MIN_CAMERA_DISTANCE}
      maxDistance={GLOBE_RADIUS * 5.4}
      enabled={!guided}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
    />
  );
}
