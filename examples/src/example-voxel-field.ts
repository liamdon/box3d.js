// Voxel Field — a block-world terrain from b3CreateVoxelWave, plus a hand-built
// platform with a hole and per-voxel materials, with dynamic shapes dropped on
// top. The generic renderer draws voxel shapes by reading the field back, and a
// local-space ray cast (b3RayCastVoxelField) is drawn against the terrain.

import type { Box3DModule, b3Vec3 } from 'box3d.js';
import Box3D from 'box3d.js/inline';
import * as THREE from 'three';
import { createWorldRenderer } from './box3d-three';
import { createHarness } from './harness';

const b3: Box3DModule = await Box3D();
const app = createHarness({ camera: [0, 22, 28], target: [0, 8, 0] });

const worldDef = b3.b3DefaultWorldDef();
worldDef.gravity = [0, -10, 0];
const world = b3.b3CreateWorld(worldDef);

// --- wave terrain: 32x12x32 voxels, centred on the origin ---
const SIZE = 32;
const HEIGHT = 12;
const terrainOrigin: b3Vec3 = [-SIZE / 2, 0, -SIZE / 2];
const terrain = b3.b3CreateVoxelWave(
	SIZE,
	HEIGHT,
	SIZE,
	0,
	0,
	[1, 1, 1],
	0.25,
	0.4,
	false,
)!;
const terrainDef = b3.b3DefaultBodyDef();
terrainDef.position = terrainOrigin;
const terrainBody = b3.b3CreateBody(world, terrainDef); // static
b3.b3CreateVoxelFieldShape(terrainBody, b3.b3DefaultShapeDef(), terrain);

// --- hand-built platform: 8x2x8 floor with a 2x2 hole, checkerboard materials ---
const PX = 8;
const PY = 2;
const PZ = 8;
const voxels = new Uint8Array(PX * PY * PZ);
const materialIndices = new Uint8Array(PX * PY * PZ);
const idx = (x: number, y: number, z: number) => x + PX * (y + PY * z);
for (let z = 0; z < PZ; z++) {
	for (let x = 0; x < PX; x++) {
		const hole = x >= 3 && x <= 4 && z >= 3 && z <= 4;
		voxels[idx(x, 0, z)] = hole ? 0 : 1;
		materialIndices[idx(x, 0, z)] = (x + z) % 2; // 0 = rough, 1 = ice
	}
}
const platform = b3.b3CreateVoxelField(
	voxels,
	materialIndices,
	[1, 1, 1],
	PX,
	PY,
	PZ,
	false,
)!;
const rough = b3.b3DefaultSurfaceMaterial();
rough.friction = 0.8;
const ice = b3.b3DefaultSurfaceMaterial();
ice.friction = 0.02;
const platformDef = b3.b3DefaultBodyDef();
platformDef.position = [-PX / 2, 14, -PZ / 2];
const platformBody = b3.b3CreateBody(world, platformDef); // static
b3.b3CreateVoxelFieldShape(platformBody, b3.b3DefaultShapeDef(), platform, [
	rough,
	ice,
]);

// --- dynamic shapes dropped over the platform; some fall through the hole ---
const renderer = createWorldRenderer(b3, world);
app.scene.add(renderer.object3d);

const rand = (a: number, b: number) => a + Math.random() * (b - a);
for (let i = 0; i < 40; i++) {
	const def = b3.b3DefaultBodyDef();
	def.type = b3.b3BodyType.b3_dynamicBody;
	def.position = [rand(-3.5, 3.5), 18 + i * 0.6, rand(-3.5, 3.5)];
	const body = b3.b3CreateBody(world, def);
	const shapeDef = b3.b3DefaultShapeDef();
	shapeDef.baseMaterial.restitution = 0.2;
	if (i % 2 === 0) {
		b3.b3CreateSphereShape(body, shapeDef, {
			center: [0, 0, 0],
			radius: rand(0.35, 0.5),
		});
	} else {
		b3.b3CreateBoxShape(body, shapeDef, 0.4, 0.4, 0.4);
	}
}

// --- local-space ray cast against the terrain field, drawn each frame ---
const rayOrigin: b3Vec3 = [14, 20, 14];
const rayTranslation: b3Vec3 = [-28, -20, -28];
const rayLine = new THREE.Line(
	new THREE.BufferGeometry().setFromPoints([
		new THREE.Vector3(),
		new THREE.Vector3(),
	]),
	new THREE.LineBasicMaterial({ color: 0xffd93d }),
);
const hitMarker = new THREE.Mesh(
	new THREE.SphereGeometry(0.3, 12, 8),
	new THREE.MeshStandardMaterial({ color: 0xff6b6b }),
);
app.scene.add(rayLine, hitMarker);

function castRay(): void {
	// the terrain body sits at terrainOrigin with identity rotation, so local = world - origin
	const localOrigin: b3Vec3 = [
		rayOrigin[0] - terrainOrigin[0],
		rayOrigin[1] - terrainOrigin[1],
		rayOrigin[2] - terrainOrigin[2],
	];
	const hit = b3.b3RayCastVoxelField(terrain, localOrigin, rayTranslation, 1);
	const f = hit.hit ? hit.fraction : 1;
	const end = new THREE.Vector3(
		rayOrigin[0] + rayTranslation[0] * f,
		rayOrigin[1] + rayTranslation[1] * f,
		rayOrigin[2] + rayTranslation[2] * f,
	);
	rayLine.geometry.setFromPoints([new THREE.Vector3(...rayOrigin), end]);
	hitMarker.visible = hit.hit;
	hitMarker.position.copy(end);
}

app.onFrame(() => {
	app.step(() => b3.b3World_Step(world, 1 / 60, 4));
	renderer.update();
	castRay();
});
app.start();
