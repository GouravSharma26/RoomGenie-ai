import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Node.js FileReader polyfill for Three.js GLTFExporter
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      setTimeout(async () => {
        try {
          this.result = await blob.arrayBuffer();
          if (this.onload) this.onload({ target: this });
          if (this.onloadend) this.onloadend();
        } catch (err) {
          if (this.onerror) this.onerror(err);
        }
      }, 10);
    }
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.resolve(__dirname, '../public/models');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const exporter = new GLTFExporter();

async function exportGLB(group, filename) {
  const glb = await exporter.parseAsync(group, { binary: true });
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, Buffer.from(glb));
  console.log(`Generated: ${filename} (${glb.byteLength} bytes)`);
  return filePath;
}

// 1. Modern 3-Seater Sofa (2.1m W x 0.85m H x 0.9m D)
function createSofa() {
  const group = new THREE.Group();
  group.name = 'ModernSofa';

  const baseMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.8 });
  const fabricMat = new THREE.MeshStandardMaterial({ color: 0x4f46e5, roughness: 0.7 });

  // Base platform
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.9), baseMat);
  base.position.set(0, 0.05, 0);
  group.add(base);

  // Seat cushions
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.25, 0.7), fabricMat);
  cushion.position.set(0, 0.225, 0.05);
  group.add(cushion);

  // Backrest
  const backrest = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.55, 0.2), fabricMat);
  backrest.position.set(0, 0.575, -0.35);
  group.add(backrest);

  // Left armrest
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.85), fabricMat);
  armL.position.set(-0.975, 0.35, 0.025);
  group.add(armL);

  // Right armrest
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.85), fabricMat);
  armR.position.set(0.975, 0.35, 0.025);
  group.add(armR);

  return group;
}

// 2. Minimalist Coffee Table (1.2m W x 0.45m H x 0.6m D)
function createCoffeeTable() {
  const group = new THREE.Group();
  group.name = 'MinimalistCoffeeTable';

  const woodMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.6 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5 });

  // Tabletop
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.6), woodMat);
  top.position.set(0, 0.43, 0);
  group.add(top);

  // 4 Legs
  const legGeo = new THREE.CylinderGeometry(0.025, 0.02, 0.41, 16);
  const legPositions = [
    [-0.52, 0.205, -0.22],
    [0.52, 0.205, -0.22],
    [-0.52, 0.205, 0.22],
    [0.52, 0.205, 0.22],
  ];

  legPositions.forEach(([x, y, z]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, y, z);
    group.add(leg);
  });

  return group;
}

// 3. Ergonomic Study Desk (1.4m W x 0.75m H x 0.7m D)
function createDesk() {
  const group = new THREE.Group();
  group.name = 'ErgonomicStudyDesk';

  const topMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.7 });

  // Desktop
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.7), topMat);
  top.position.set(0, 0.73, 0);
  group.add(top);

  // Left Leg Frame
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.71, 0.6), frameMat);
  legL.position.set(-0.625, 0.355, 0);
  group.add(legL);

  // Right Leg Frame
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.71, 0.6), frameMat);
  legR.position.set(0.625, 0.355, 0);
  group.add(legR);

  // Cross Support Beam
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.04), frameMat);
  beam.position.set(0, 0.35, -0.2);
  group.add(beam);

  return group;
}

async function run() {
  await exportGLB(createSofa(), 'sofa.glb');
  await exportGLB(createCoffeeTable(), 'coffee_table.glb');
  await exportGLB(createDesk(), 'desk.glb');
  console.log('Successfully generated all 3 sample CC0 GLB models.');
}

run().catch(console.error);
