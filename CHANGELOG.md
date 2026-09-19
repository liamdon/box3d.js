# Changelog

## v0.2.0 (`@liamdon/box3d.js`)

First release of the fork. Published as `@liamdon/box3d.js`; the API is a superset of `box3d.js` v0.1.1 apart from the upstream engine renames listed below.

- Engine built from [liamdon/box3d](https://github.com/liamdon/box3d) `voxel-field` (upstream box3d through `f555ee4` "Optimize Broad-Phase (#159)" plus the voxel field shape). The engine now reports itself as box3d v0.2.0.
- **New:** voxel field shapes. `b3CreateVoxelField`, `b3DestroyVoxelField`, `b3CreateVoxelWave`, `b3CreateVoxelFieldShape` (with an optional per-shape `materials` array), `b3Shape_GetVoxelField`, `b3ShapeType.b3_voxelShape`, readback via `b3GetVoxelFieldInfo` / `b3GetVoxelFieldBits` / `b3GetVoxelFieldMaterialIndices` / `b3IsVoxelSolid`, and local-space queries `b3RayCastVoxelField`, `b3ShapeCastVoxelField`, `b3OverlapVoxelField`, `b3QueryVoxelField`, `b3ComputeVoxelFieldAABB`.
- **Breaking (upstream engine renames, mirrored 1:1):** `b3CreateCompoundShape` → `b3CreateBakedCompoundShape`; `b3Body_GetLocalCenterOfMass` / `b3Body_GetWorldCenterOfMass` → `b3Body_GetLocalCenter` / `b3Body_GetWorldCenter`; `b3RecPlayer_Destroy` → `b3DestroyPlayer`; `b3CollideCapsuleAndTriangle` / `b3CollideHullAndTriangle` / `b3CollideSphereAndTriangle` → `b3CollideTriangleAndCapsule(v1, v2, v3, capsule)` / `b3CollideTriangleAndHull(v1, v2, v3, triangleFlags, hull, enableSpeculative)` / `b3CollideTriangleAndSphere(v1, v2, v3, sphere)` (triangle first).
- **Removed:** `b3World_DumpShapeBounds` (declared but no longer implemented by the engine).
- Emscripten pinned to 6.0.9 (was 6.0.2).
- Examples: a Voxel Field example; the generic renderer draws voxel shapes.

## v0.1.1

- Documentation updates to reflect the new API surface and usage patterns, included in the npm package README.md

## v0.1.0

Rework of embind API surface so that box3d.js interops with gl-matrix-style libraries and reads values without allocating JavaScript objects.

- **Breaking:** math types are now plain arrays, matching gl-matrix/mathcat — `b3Vec3` is `[x, y, z]`, `b3Quat` is `[x, y, z, w]`, `b3AABB` is `[minX, minY, minZ, maxX, maxY, maxZ]`. Pass and receive them straight from your existing math library, no wrapper objects or conversion.
- **Breaking:** value reads are out-param-first and zero-allocation. Getters fill a caller-supplied array and return it, e.g. `b3Body_GetPosition(out, bodyId)`; the allocating form that returned a fresh object is gone. Reuse a scratch array per frame to keep the hot path free of GC pressure.
- Removed the pure math-op bindings (`b3Cross`, `b3MakeQuatFromAxisAngle`, `b3AABB_Union`, …). Do vector/quaternion math in JS with gl-matrix/mathcat rather than crossing the wasm boundary for each operation.
- The emitted modules are now validated and post-processed into clean ESM: Emscripten's `require()` calls are rewritten to `await import`, Node builtins are given the `node:` scheme, and the single-file (`*.inline.mjs`) builds have their dead Node file-reader code stripped. The outputs now bundle with no bundler config.

## v0.0.2

- Added `repository`, `homepage`, `bugs`, and `author` fields to `package.json`

## v0.0.1

- Initial release
