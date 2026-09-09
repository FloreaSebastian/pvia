/**
 * Solar Studio — scène 3D (React Three Fiber).
 *
 * Ce module importe WebGL : il ne doit être chargé QUE derrière <ClientOnly>
 * et sur une route `ssr: false`. Il ne contient aucun accès réseau ni base :
 * il reçoit la géométrie déjà calculée par le serveur.
 */
import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import type { SolarSceneModel } from "./scene-model";

const ROOF_COLOR = "#8a5a44";
const ROOF_SELECTED = "#c2703f";
const WALL_COLOR = "#d8d2c8";
const PANEL_COLOR = "#12203a";
const PANEL_DISABLED = "#8b8f96";

function planeMatrix(frame: SolarSceneModel["planes"][number]["frame"]): THREE.Matrix4 {
  const u = new THREE.Vector3(...frame.u).normalize();
  const v = new THREE.Vector3(...frame.v).normalize();
  const n = new THREE.Vector3().crossVectors(u, v).normalize();
  const o = new THREE.Vector3(...frame.origin);
  // three utilise Y comme axe vertical : (x, z, y) depuis notre repère (Est, Nord, Haut)
  const conv = (p: THREE.Vector3) => new THREE.Vector3(p.x, p.z, -p.y);
  const cu = conv(u);
  const cv = conv(v);
  const cn = conv(n);
  const co = conv(o);
  return new THREE.Matrix4().makeBasis(cu, cv, cn).setPosition(co);
}

function RoofPlaneMesh({
  plane,
  selected,
  onSelect,
}: {
  plane: SolarSceneModel["planes"][number];
  selected: boolean;
  onSelect: () => void;
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape(plane.polygon.map((p) => new THREE.Vector2(p.x, p.y)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.applyMatrix4(planeMatrix(plane.frame));
    geo.computeVertexNormals();
    return geo;
  }, [plane]);

  return (
    <mesh
      geometry={geometry}
      castShadow
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <meshStandardMaterial
        color={selected ? ROOF_SELECTED : ROOF_COLOR}
        side={THREE.DoubleSide}
        roughness={0.85}
        metalness={0.05}
      />
    </mesh>
  );
}

function Walls({ model }: { model: SolarSceneModel }) {
  const geometry = useMemo(() => {
    if (model.footprint.length < 3) return null;
    const shape = new THREE.Shape(model.footprint.map((p) => new THREE.Vector2(p.x, -p.y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: model.wallHeight, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [model.footprint, model.wallHeight]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} position={[0, model.wallHeight, 0]} castShadow receiveShadow>
      <meshStandardMaterial color={WALL_COLOR} roughness={0.95} />
    </mesh>
  );
}

function Panels({
  model,
  onToggle,
}: {
  model: SolarSceneModel;
  onToggle: (moduleId: string) => void;
}) {
  const items = useMemo(() => {
    const out: { id: string; matrix: THREE.Matrix4; enabled: boolean; w: number; h: number }[] = [];
    for (const plane of model.planes) {
      const spec = model.specByPlaneKey[plane.key];
      if (!spec) continue;
      const base = planeMatrix(plane.frame);
      for (const m of model.modules) {
        if (m.roof_plane_key !== plane.key) continue;
        const w = m.orientation === "portrait" ? spec.width_mm / 1000 : spec.height_mm / 1000;
        const h = m.orientation === "portrait" ? spec.height_mm / 1000 : spec.width_mm / 1000;
        const local = new THREE.Matrix4().makeTranslation(m.local_u_m, m.local_v_m, 0.06);
        out.push({ id: m.id, matrix: base.clone().multiply(local), enabled: m.enabled, w, h });
      }
    }
    return out;
  }, [model]);

  return (
    <group>
      {items.map((it) => (
        <mesh
          key={it.id}
          matrixAutoUpdate={false}
          matrix={it.matrix}
          castShadow
          onClick={(e) => {
            e.stopPropagation();
            onToggle(it.id);
          }}
        >
          <boxGeometry args={[it.w * 0.98, it.h * 0.98, 0.035]} />
          <meshStandardMaterial
            color={it.enabled ? PANEL_COLOR : PANEL_DISABLED}
            roughness={it.enabled ? 0.25 : 0.9}
            metalness={it.enabled ? 0.5 : 0.1}
          />
        </mesh>
      ))}
    </group>
  );
}

function Obstacles({ model }: { model: SolarSceneModel }) {
  return (
    <group>
      {model.obstacles.map((o) => {
        const plane = o.planeKey ? model.planes.find((p) => p.key === o.planeKey) : null;
        let matrix: THREE.Matrix4;
        if (plane) {
          const base = planeMatrix(plane.frame);
          matrix = base
            .clone()
            .multiply(new THREE.Matrix4().makeTranslation(o.u, o.v, o.height / 2));
        } else {
          matrix = new THREE.Matrix4().makeTranslation(o.u, o.height / 2 + o.baseZ, -o.v);
        }
        return (
          <mesh key={o.id} matrixAutoUpdate={false} matrix={matrix} castShadow>
            <boxGeometry args={[o.width, plane ? o.length : o.height, plane ? o.height : o.length]} />
            <meshStandardMaterial color={o.color} roughness={0.8} transparent opacity={0.92} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function SolarScene({
  model,
  selectedPlaneKey,
  onSelectPlane,
  onToggleModule,
}: {
  model: SolarSceneModel;
  selectedPlaneKey: string | null;
  onSelectPlane: (key: string) => void;
  onToggleModule: (moduleId: string) => void;
}) {
  const span = Math.max(model.extent, 12);
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [span * 1.1, span * 0.85, span * 1.1], fov: 45 }}
      style={{ touchAction: "none" }}
    >
      <color attach="background" args={["#0b1220"]} />
      <fog attach="fog" args={["#0b1220", span * 3, span * 8]} />
      <hemisphereLight intensity={0.5} groundColor="#1c2433" />
      <directionalLight
        position={[span, span * 1.4, span * 0.6]}
        intensity={2.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <Suspense fallback={null}>
        <Environment>
          <Lightformer intensity={1.6} position={[0, 8, 0]} scale={[14, 14, 1]} />
          <Lightformer intensity={0.7} color="#9fb6d6" position={[-8, 2, -4]} rotation-y={Math.PI / 2} scale={[24, 2, 1]} />
        </Environment>
      </Suspense>

      <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, -0.01, 0]}>
        <planeGeometry args={[span * 8, span * 8]} />
        <meshStandardMaterial color="#243044" roughness={1} />
      </mesh>
      <Grid
        args={[span * 6, span * 6]}
        cellSize={1}
        sectionSize={5}
        cellColor="#33415c"
        sectionColor="#475569"
        infiniteGrid
        fadeDistance={span * 6}
        position={[0, 0.002, 0]}
      />

      <Walls model={model} />
      {model.planes.map((plane) => (
        <RoofPlaneMesh
          key={plane.key}
          plane={plane}
          selected={plane.key === selectedPlaneKey}
          onSelect={() => onSelectPlane(plane.key)}
        />
      ))}
      <Obstacles model={model} />
      <Panels model={model} onToggle={onToggleModule} />

      <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI / 2.05} minDistance={4} maxDistance={span * 6} />
    </Canvas>
  );
}
