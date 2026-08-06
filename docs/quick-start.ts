import Box3D from 'box3d.js';
import type { Box3DModule, b3Vec3 } from 'box3d.js';

// Initialize the WASM module. Use box3d.js/inline if your environment can't serve a separate .wasm file.
const b3: Box3DModule = await Box3D();

// Create a world with downward gravity. Math types are plain arrays: b3Vec3 is [x, y, z].
const worldDef = b3.b3DefaultWorldDef();
worldDef.gravity = [0, -10, 0];
const world = b3.b3CreateWorld(worldDef);

// Static ground: a wide flat box
const groundDef = b3.b3DefaultBodyDef();
groundDef.position = [0, 0, 0];
const ground = b3.b3CreateBody(world, groundDef);
b3.b3CreateBoxShape(ground, b3.b3DefaultShapeDef(), 25, 0.5, 25);

// Dynamic sphere dropped from above
const bodyDef = b3.b3DefaultBodyDef();
bodyDef.type = b3.b3BodyType.b3_dynamicBody;
bodyDef.position = [0, 10, 0];
const body = b3.b3CreateBody(world, bodyDef);
b3.b3CreateSphereShape(body, b3.b3DefaultShapeDef(), { center: [0, 0, 0], radius: 0.5 });

// Step the simulation at 60 Hz for ~2.5 seconds
for (let i = 0; i < 150; i++) {
    b3.b3World_Step(world, 1 / 60, 4);
}

// Getters are out-param-first: pass a scratch array to fill (zero-allocation).
const pos: b3Vec3 = [0, 0, 0];
b3.b3Body_GetPosition(pos, body);
console.log(`sphere landed at y = ${pos[1].toFixed(2)}`);

b3.b3DestroyWorld(world);
