// Build a three.js geometry for a box3d voxel field by reading the field back
// (b3GetVoxelFieldInfo / Bits / MaterialIndices). Only exposed faces are
// emitted, matching what the engine collides with. With a border, the outer
// layer is skipped (it never collides) but still hides its neighbours' faces.

import type { Box3DModule, b3VoxelFieldData } from 'box3d.js';
import * as THREE from 'three';

// +x, -x, +y, -y, +z, -z: normal, then the four corners (CCW seen from outside)
const FACES: Array<{
	n: [number, number, number];
	c: Array<[number, number, number]>;
}> = [
	{
		n: [1, 0, 0],
		c: [
			[1, 0, 0],
			[1, 1, 0],
			[1, 1, 1],
			[1, 0, 1],
		],
	},
	{
		n: [-1, 0, 0],
		c: [
			[0, 0, 1],
			[0, 1, 1],
			[0, 1, 0],
			[0, 0, 0],
		],
	},
	{
		n: [0, 1, 0],
		c: [
			[0, 1, 0],
			[0, 1, 1],
			[1, 1, 1],
			[1, 1, 0],
		],
	},
	{
		n: [0, -1, 0],
		c: [
			[0, 0, 1],
			[0, 0, 0],
			[1, 0, 0],
			[1, 0, 1],
		],
	},
	{
		n: [0, 0, 1],
		c: [
			[1, 0, 1],
			[1, 1, 1],
			[0, 1, 1],
			[0, 0, 1],
		],
	},
	{
		n: [0, 0, -1],
		c: [
			[0, 0, 0],
			[0, 1, 0],
			[1, 1, 0],
			[1, 0, 0],
		],
	},
];

export function voxelFieldGeometry(
	b3: Box3DModule,
	field: b3VoxelFieldData,
	palette: number[] = [
		0x9a9a9a, 0x6bcb77, 0x4d96ff, 0xffd93d, 0xff6b6b, 0xc78bff,
	],
): THREE.BufferGeometry {
	const info = b3.b3GetVoxelFieldInfo(field);
	const bits = b3.b3GetVoxelFieldBits(field);
	const materials = b3.b3GetVoxelFieldMaterialIndices(field);
	const { countX, countY, countZ } = info;
	const [sx, sy, sz] = info.scale;
	const border = info.hasBorder ? 1 : 0;

	const index = (x: number, y: number, z: number) =>
		x + countX * (y + countY * z);
	const solid = (x: number, y: number, z: number): boolean => {
		if (x < 0 || y < 0 || z < 0 || x >= countX || y >= countY || z >= countZ)
			return false;
		const i = index(x, y, z);
		return ((bits[i >> 3] >> (i & 7)) & 1) === 1;
	};

	const positions: number[] = [];
	const normals: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	const color = new THREE.Color();

	for (let z = border; z < countZ - border; z++) {
		for (let y = border; y < countY - border; y++) {
			for (let x = border; x < countX - border; x++) {
				if (!solid(x, y, z)) continue;
				const mat = materials.length > 0 ? materials[index(x, y, z)] : 0;
				color.setHex(palette[mat % palette.length]);
				for (const face of FACES) {
					if (solid(x + face.n[0], y + face.n[1], z + face.n[2])) continue;
					const base = positions.length / 3;
					for (const [cx, cy, cz] of face.c) {
						positions.push((x + cx) * sx, (y + cy) * sy, (z + cz) * sz);
						normals.push(face.n[0], face.n[1], face.n[2]);
						colors.push(color.r, color.g, color.b);
					}
					indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
				}
			}
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		'position',
		new THREE.Float32BufferAttribute(positions, 3),
	);
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	if (materials.length > 0) {
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	}
	geometry.setIndex(indices);
	return geometry;
}
