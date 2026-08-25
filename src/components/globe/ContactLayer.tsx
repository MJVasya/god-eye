import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { deadReckon, GLOBE_RADIUS, headingOffset, latLngToVec3 } from "@/lib/geo/math";
import type { Contact, SensorMode } from "@/lib/geo/types";

const dummy = new THREE.Object3D();
const pos = new THREE.Vector3();
const look = new THREE.Vector3();

function colorFor(kind: Contact["kind"], sensor: SensorMode) {
  if (sensor === "nvg") return kind === "iss" ? "#f4ffe8" : "#8fde9c";
  if (sensor === "flir") return kind === "quake" ? "#fff3c4" : "#ff7a3c";
  if (kind === "iss") return "#f2f5ef";
  if (kind === "flight") return "#8fde9c";
  if (kind === "sat") return "#9eb4ff";
  if (kind === "quake") return "#e25a45";
  return "#d7a35a";
}

export function ContactLayer({
  items,
  kind,
  scale,
  sensor,
  liveMotion,
  capacity,
  onPick,
}: {
  items: Contact[];
  kind: Contact["kind"] | "sat";
  scale: number;
  sensor: SensorMode;
  liveMotion: boolean;
  capacity: number;
  onPick: (c: Contact) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const color = useMemo(() => new THREE.Color(colorFor(kind, sensor)), [kind, sensor]);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
  }, [items.length]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const d = Math.min(dt, 0.1);
    const n = Math.min(items.length, capacity);
    for (let i = 0; i < n; i++) {
      const c = items[i]!;
      if (liveMotion && c.speedMs > 30 && c.kind === "flight") {
        const next = deadReckon(c.lat, c.lng, c.heading, c.speedMs, d);
        c.lat = next.lat;
        c.lng = next.lng;
      }
      latLngToVec3(c.lat, c.lng, Math.max(c.altKm, 0.02), GLOBE_RADIUS, pos);
      dummy.position.copy(pos);
      if (c.kind === "flight") {
        const fwd = headingOffset(c.lat, c.lng, c.heading, 40);
        latLngToVec3(fwd.lat, fwd.lng, c.altKm, GLOBE_RADIUS, look);
        dummy.up.copy(pos).normalize();
        dummy.lookAt(look);
        dummy.rotateX(Math.PI / 2);
      } else {
        dummy.lookAt(0, 0, 0);
        dummy.rotateX(Math.PI);
      }
      const s =
        c.kind === "iss"
          ? scale * 1.8
          : c.kind === "quake"
            ? scale * (0.7 + (c.mag ?? 3) * 0.18)
            : scale;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });

  const handle = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const id = e.instanceId;
    if (id == null) return;
    const c = items[id];
    if (c) onPick(c);
  };

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, capacity]}
      onClick={handle}
      frustumCulled={false}
    >
      {kind === "flight" ? (
        <coneGeometry args={[0.007, 0.026, 5]} />
      ) : kind === "quake" ? (
        <octahedronGeometry args={[0.012, 0]} />
      ) : (
        <icosahedronGeometry args={[0.01, 0]} />
      )}
      <meshBasicMaterial color={color} toneMapped={false} />
    </instancedMesh>
  );
}

export function TargetRing({ contact }: { contact: Contact }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!ref.current) return;
    latLngToVec3(contact.lat, contact.lng, Math.max(contact.altKm, 0.04), GLOBE_RADIUS, pos);
    ref.current.position.copy(pos);
    ref.current.lookAt(0, 0, 0);
  });
  return (
    <mesh ref={ref}>
      <ringGeometry args={[0.028, 0.034, 32]} />
      <meshBasicMaterial color="#e7eee8" side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

export function OrbitRing({ contact }: { contact: Contact }) {
  const geom = useMemo(() => {
    const r = GLOBE_RADIUS * (1 + Math.max(contact.altKm, 400) / 6371);
    return new THREE.RingGeometry(r - 0.004, r + 0.004, 128);
  }, [contact.altKm]);
  return (
    <mesh geometry={geom} rotation={[Math.PI / 2, 0, 0]}>
      <meshBasicMaterial color="#9eb4ff" transparent opacity={0.22} side={THREE.DoubleSide} />
    </mesh>
  );
}
