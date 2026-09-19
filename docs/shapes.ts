import Box3D from 'box3d.js/inline';
import type { Box3DModule, b3Quat, b3Vec3 } from 'box3d.js';

const b3: Box3DModule = await Box3D();
const world = b3.b3CreateWorld(b3.b3DefaultWorldDef());
const bodyDef = b3.b3DefaultBodyDef();
bodyDef.type = b3.b3BodyType.b3_dynamicBody;
const body = b3.b3CreateBody(world, bodyDef);
const sd = b3.b3DefaultShapeDef();

/* SNIPPET_START: box */
// Box: defined by half-extents (hx, hy, hz) from the body origin
b3.b3CreateBoxShape(body, sd, 0.5, 0.5, 0.5);  // 1x1x1 cube
b3.b3CreateBoxShape(body, sd, 2.0, 0.1, 2.0);  // flat platform
/* SNIPPET_END: box */

/* SNIPPET_START: sphere */
// center is a b3Vec3: [x, y, z]
b3.b3CreateSphereShape(body, sd, { center: [0, 0, 0], radius: 0.5 });
/* SNIPPET_END: sphere */

/* SNIPPET_START: capsule */
// Capsule: a cylinder with hemispherical caps, defined by two center points + radius
b3.b3CreateCapsuleShape(body, sd, {
    center1: [0, -0.5, 0],
    center2: [0,  0.5, 0],
    radius: 0.3,
});
/* SNIPPET_END: capsule */

/* SNIPPET_START: hull */
// Convex hull: the tightest convex shape enclosing a set of points.
// Pass a flat [x,y,z, x,y,z, ...] array -- box3d computes the hull internally.
const positions = [
    -0.5, 0, -0.5,
     0.5, 0, -0.5,
     0.5, 0,  0.5,
    -0.5, 0,  0.5,
     0,   1,  0,   // apex
];
const hullData = b3.b3CreateHull(positions)!;
b3.b3CreateHullShape(body, sd, hullData);
hullData.delete(); // free the C++ handle when done
/* SNIPPET_END: hull */

/* SNIPPET_START: cylinder-cone */
// Cylinder and cone are built-in hull makers.
// b3CreateCylinder(halfHeight, radius, convexRadius, segments)
const cylData = b3.b3CreateCylinder(0.5, 0.4, 0.0, 16)!;
b3.b3CreateHullShape(body, sd, cylData);
cylData.delete();

// b3CreateCone(height, radius, convexRadius, segments)
const coneData = b3.b3CreateCone(1.0, 0.5, 0.0, 16)!;
b3.b3CreateHullShape(body, sd, coneData);
coneData.delete();
/* SNIPPET_END: cylinder-cone */

/* SNIPPET_START: mesh */
// Triangle mesh: for complex static terrain and level geometry.
// Positions: flat Float32Array [x,y,z, ...]; indices: Uint32Array.
// Winding: counter-clockwise (CCW) is the front face.
const meshPositions = new Float32Array([
    -10, 0, -10,
     10, 0, -10,
     10, 0,  10,
    -10, 0,  10,
]);
const meshIndices = new Uint32Array([0, 1, 2, 0, 2, 3]);

const meshData = b3.b3CreateMesh(meshPositions, meshIndices)!;

const staticBodyDef = b3.b3DefaultBodyDef();
const staticBody = b3.b3CreateBody(world, staticBodyDef);
const scale: b3Vec3 = [1, 1, 1];
b3.b3CreateMeshShape(staticBody, b3.b3DefaultShapeDef(), meshData, scale);
meshData.delete();
/* SNIPPET_END: mesh */

/* SNIPPET_START: compound */
// Compound shapes combine multiple child shapes on a single body.
// In box3d, compounds are static-only -- the body type must be b3_staticBody.
const compoundBodyDef = b3.b3DefaultBodyDef();
compoundBodyDef.type = b3.b3BodyType.b3_staticBody;
const compoundBody = b3.b3CreateBody(world, compoundBodyDef);

const IDENTITY_QUAT: b3Quat = [0, 0, 0, 1];

// Each child is a convex hull plus the transform placing it on the body.
// (position is a b3Vec3, quaternion a b3Quat.) Build box hulls from their corners:
function boxHull(hx: number, hy: number, hz: number) {
    return b3.b3CreateHull([
        -hx, -hy, -hz,  hx, -hy, -hz,  hx, -hy, hz,  -hx, -hy, hz,
        -hx,  hy, -hz,  hx,  hy, -hz,  hx,  hy, hz,  -hx,  hy, hz,
    ])!;
}

const spec = {
    hulls: [
        { hull: boxHull(0.5, 2, 0.5), transform: { position: [-2, 0, 0], quaternion: IDENTITY_QUAT } }, // left wall
        { hull: boxHull(0.5, 2, 0.5), transform: { position: [ 2, 0, 0], quaternion: IDENTITY_QUAT } }, // right wall
        { hull: boxHull(2.5, 0.5, 0.5), transform: { position: [0, -1, 0], quaternion: IDENTITY_QUAT } }, // floor
    ],
};

// Compound data is NOT copied into the world -- keep it (and its hulls) alive for
// as long as the shape exists, then free it after the body/world is destroyed.
const compoundData = b3.b3CreateCompound(spec)!;
b3.b3CreateBakedCompoundShape(compoundBody, b3.b3DefaultShapeDef(), compoundData);
/* SNIPPET_END: compound */

b3.b3DestroyWorld(world);
