import * as THREE from "three";
import React, {
  Suspense,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Clone, OrbitControls, useGLTF, Environment } from "@react-three/drei";
import { Physics, RigidBody } from "@react-three/rapier";

// ===== 出目判定（あなたのスクショ前提） =====
const UP = new THREE.Vector3(0, 1, 0);
const faceMap = [
  { dir: new THREE.Vector3(0, 1, 0), value: 1 },  // +Y
  { dir: new THREE.Vector3(0, -1, 0), value: 6 }, // -Y
  { dir: new THREE.Vector3(1, 0, 0), value: 4 },  // +X
  { dir: new THREE.Vector3(-1, 0, 0), value: 3 }, // -X
  { dir: new THREE.Vector3(0, 0, 1), value: 5 },  // +Z
  { dir: new THREE.Vector3(0, 0, -1), value: 2 }, // -Z
];

function getDiceValue(worldQuat: THREE.Quaternion) {
  let bestValue = 1;
  let bestScore = -Infinity;

  for (const f of faceMap) {
    const worldDir = f.dir.clone().applyQuaternion(worldQuat);
    const score = worldDir.dot(UP);
    if (score > bestScore) {
      bestScore = score;
      bestValue = f.value;
    }
  }
  return bestValue;
}

// ===== 見た目（あとで glb に置換OK） =====
function DiceVisual() {
  const gltf = useGLTF("/models/dice.glb");
  return <Clone object={gltf.scene} scale={0.6} />
}

// ===== Dice：refで roll() を外から呼べるようにする =====
export type DiceHandle = {
  roll: () => void;
};

const spawns = [
  { x: -1.2, y: 10, z: 0 },
  { x:  0.0, y: 10, z: 0 },
  { x:  1.2, y: 10, z: 0 },
];

type Vec3 = { x: number; y: number; z: number };

const Dice = forwardRef<DiceHandle, { onSettled: (v: number) => void; spawn: Vec3 }>(
  function Dice({ onSettled, spawn }, ref) {
    const rb = useRef<any>(null);
    const [rolling, setRolling] = useState(false);

    const rand = useMemo(
      () => ({
        q: new THREE.Quaternion(),
      }),
      []
    );

    const roll = () => {
      const body = rb.current;
      if (!body) return;

      setRolling(true);

      // ★ spawn位置へリセット（x,zを分けると重ならない）
      body.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);

      // 初期回転もランダム（偏り軽減）
      rand.q.setFromEuler(
        new THREE.Euler(
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2
        )
      );
      body.setRotation(
        { x: rand.q.x, y: rand.q.y, z: rand.q.z, w: rand.q.w },
        true
      );

      body.wakeUp?.();

      // ランダム投げ（インパルス）
      const impulseStrength = 3.5;
      const upBoost = 2.0;

      const ix = (Math.random() - 0.5) * impulseStrength;
      const iz = (Math.random() - 0.5) * impulseStrength;
      const iy = upBoost + Math.random() * 1.0;

      body.applyImpulse({ x: ix, y: iy, z: iz }, true);

      // 回転の勢い（トルクインパルス）
      const torqueStrength = 10.0;
      const tx = (Math.random() - 0.5) * torqueStrength;
      const ty = (Math.random() - 0.5) * torqueStrength;
      const tz = (Math.random() - 0.5) * torqueStrength;

      body.applyTorqueImpulse({ x: tx, y: ty, z: tz }, true);
    };

    // 親から roll() を呼べるようにする
    useImperativeHandle(ref, () => ({ roll }), []);

    // 止まったら出目確定
    useFrame(() => {
      if (!rolling) return;
      const body = rb.current;
      if (!body) return;

      const lv = body.linvel();
      const av = body.angvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z);
      const spin = Math.hypot(av.x, av.y, av.z);

      if (speed < 0.05 && spin < 0.05) {
        const rot = body.rotation();
        const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
        onSettled(getDiceValue(q));
        setRolling(false);
      }
    });

    return (
      <RigidBody
        ref={rb}
        colliders="cuboid"
        friction={0.8}
        restitution={0.3}
        position={[spawn.x, -5000, spawn.z]}
      >
        <Suspense fallback={null}>
          <DiceVisual />
        </Suspense>
      </RigidBody>
    );
  }
);

export default function App() {
  const diceRefs = useRef<(DiceHandle | null)[]>([]);
  const [values, setValues] = useState<(number | null)[]>([null, null, null]);

  const N = 3;
  const [pendingValues, setPendingValues] = useState<(number | null)[]>(Array(N).fill(null));
  const [finalValues, setFinalValues] = useState<number[] | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState<ReactNode>(null);



  const rollAll = () => {
    setPendingValues(Array(N).fill(null)); // 途中経過をクリア
    setFinalValues(null);                 // 表示も消す
    setModalOpen(false);
    setModalContent("");
    diceRefs.current.forEach((d) => d?.roll());
  };


  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      {modalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "grid",
            placeItems: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              background: "white",
              borderRadius: 16,
              padding: 16,
              border: "1px solid #ddd",
            }}
          >
            <div>{modalContent}</div>

            <button
              onClick={() => setModalOpen(false)}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "white",
                cursor: "pointer",
                color: "black"
              }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
      {/* ✅ ボタンは Canvas の外（普通のDOM） */}
      <div style={{ position: "absolute", left: 16, top: 16, zIndex: 10 }}>
        <div>
          結果: <b>{finalValues ? finalValues.join(", ") : "-"}</b>
        </div>
        <div>
          合計: <b>{finalValues ? finalValues.reduce((a, b) => a + b, 0) : "-"}</b>
        </div>
      </div>
      <div style={{ position: "fixed", left: "50%", top: "80%", transform: "translate(-50%, 0)", zIndex: 10 }}>
        <button
          onClick={rollAll}
          style={{
            fontSize: 16,
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "white",
            cursor: "pointer",
          }}
        >
          振る
        </button>
      </div>

      <Canvas shadows camera={{ position: [10, 20, 10], fov: 50 }}>
        <Suspense fallback={null}>
          <Environment files="/hdr/golden_gate_hills_4k.exr" background />
        </Suspense>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />

        {/* <axesHelper args={[2]} /> */}

        <Physics gravity={[0, -9.81, 0]}>
          {/* 床 */}
          <RigidBody type="fixed" colliders="cuboid">
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[20, 20]} />
              <meshStandardMaterial />
            </mesh>
          </RigidBody>

          {spawns.map((spawn, i) => (
            <Dice 
              key={i}
              spawn={spawn}
              ref={(h) => {(diceRefs.current[i] = h)}}
              onSettled={(v) => {
                setPendingValues((prev) => {
                  const next = [...prev];
                  next[i] = v;

                  // 3つ全部そろった瞬間にだけ確定表示を更新
                  if (next.every((x) => x != null)) {
                    const vals = next as number[]
                    setFinalValues(next as number[]);
                    // if (vals.includes(6)) {
                    //   setModalContent(
                    //     <div style={{display: "flex", flexFlow: "column", justifyContent: "center", alignItems: "center"}}>
                    //       <h2 style={{ margin: 12 }}>🎊おめでとう！🎊</h2>
                    //       <p style={{margin: 0}}>
                    //         出目: <b>{vals.join(", ")}</b>
                    //       </p>
                    //       <p style={{margin: 0}}>お誕生日おめでとうございます!</p>
                    //       <p style={{margin: 0}}>ささやかながらAmazonギフトコードを贈らせていただきます</p>
                    //       <a style={{ margin: 12 }} href="https://www.amazon.co.jp/g/VXB768UJWSTLCZ?t=SvL">https://www.amazon.co.jp/g/VXB768UJWSTLCZ?t=SvL</a>
                    //     </div>
                    //   );
                    //   setModalOpen(true);
                    // }

                    const sum = vals.reduce((a, b) => a + b, 0);
                    if (sum === 3) {
                      setModalContent(
                        <div style={{display: "flex", flexFlow: "column", justifyContent: "center", alignItems: "center"}}>
                          <h2 style={{ margin: 12 }}>🎊おめでとう！🎊</h2>
                          <p style={{margin: 0}}>
                            出目: <b>{vals.join(", ")}</b>
                          </p>
                          <p style={{margin: 0}}>お誕生日おめでとうございます!</p>
                          <p style={{margin: 0}}>ささやかながらAmazonギフトコードを贈らせていただきます</p>
                          <a style={{ margin: 12 }} href="https://www.amazon.co.jp/g/VXB768UJWSTLCZ?t=SvL">https://www.amazon.co.jp/g/VXB768UJWSTLCZ?t=SvL</a>
                        </div>
                      );
                      setModalOpen(true);
                    }
                  }
                  return next;
                });
              }}
            />
          ))}
        </Physics>

        <OrbitControls minDistance={10} />
      </Canvas>
    </div>
  );
}
