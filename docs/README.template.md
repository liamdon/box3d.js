# box3d.js

WebAssembly bindings for [box3d](https://github.com/erincatto/box3d) - Erin Catto's 3D rigid body physics engine - compiled with Emscripten and exposed as an ES module with full TypeScript definitions.

> This is a fork of [isaac-mason/box3d.js](https://github.com/isaac-mason/box3d.js) built against [liamdon/box3d](https://github.com/liamdon/box3d), a fork of the engine that adds a **voxel field** shape for block worlds. Everything else matches upstream; see the [Voxel Field](#voxel-field-static-only) section for the addition.

The API mirrors the box3d C API 1:1 (`b3CreateWorld`, `b3World_Step`, …) so the upstream docs and samples translate relatively directly.

```bash
npm install @liamdon/box3d.js
```

**Builds**

| Import | Use case |
|--------|----------|
| `@liamdon/box3d.js/inline` | Browser - single-file, no separate `.wasm` to serve |
| `@liamdon/box3d.js` | Node.js or bundlers that can serve `.wasm` |
| `@liamdon/box3d.js/mt-inline` | Browser + multithreading (requires cross-origin isolation) |
| `@liamdon/box3d.js/mt` | Node.js + multithreading |

**Examples**

<Examples />

## Table of Contents

<TOC />

## Quick Start

Initialize the WASM module once with `await Box3D()`, then call the physics API through the returned module object.

<Snippet source="./quick-start.ts" />

## How Does This Compare to Jolt / Rapier / Others?

box3d is Erin Catto's 3D rigid body engine — the 3D sibling of Box2D, from the author of Box2D itself.

For comparisons across engines (box3d.js, Jolt, Rapier, and others), see the **[JS physics benchmarks](https://isaac-mason.github.io/js-physics-benchmarks/)**.

## Physics World

### Creating a World

<Snippet source="./world.ts" select="create-world" />

`b3DefaultWorldDef()` returns a world definition with sensible defaults. Common fields to override:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `gravity` | `b3Vec3` | `[0, 0, 0]` | World gravity vector |
| `workerCount` | `number` | `0` | Thread count for the MT build (see [Multithreading](#multithreading)) |
| `maximumLinearSpeed` | `number` | `500` | Speed cap - raise this for CCD bullet bodies |

### Stepping the Simulation

<Snippet source="./world.ts" select="step" />

Call `b3World_Step` in your game loop. `subStepCount` controls solver accuracy - 4 is a good default.

<Snippet source="./world.ts" select="game-loop" />

### Destroying a World

<Snippet source="./world.ts" select="destroy" />

### Memory Management

box3d.js wraps a WASM module, so some objects are allocated on the WASM heap and must be freed explicitly.

**Hull data is copied** into the world's internal database on shape creation, so `b3HullData` handles can be destroyed immediately after - or reused across multiple shapes before being destroyed.

**Mesh, compound, heightfield, and voxel field data are not copied** - the world stores a raw pointer. `b3MeshData`, `b3CompoundData`, `b3HeightFieldData`, and `b3VoxelFieldData` must be kept alive for as long as the shape (or world) exists, and destroyed only after.

<Snippet source="./memory.ts" select="geometry-lifetime" />

**Destroying a world** frees all bodies, shapes, and joints inside it automatically - no need to clean them up individually first.

<Snippet source="./memory.ts" select="world-cleanup" />

**Removing objects during simulation** - use the individual destroy functions. Destroying a body also removes all its shapes and any joints attached to it.

<Snippet source="./memory.ts" select="runtime-removal" />

### Units and Scale

box3d uses SI units and a right-handed coordinate system (+Y up by default):

- **Length**: metres (m)
- **Mass**: kilograms (kg) - note: default shape density is **1000 kg/m³**
- **Time**: seconds (s)
- **Triangle winding**: counter-clockwise (CCW) is the front face

## Rigid Bodies

### Body Types

<Snippet source="./bodies.ts" select="body-types" />

| Type | Moves | Affected by forces | Collides with |
|------|-------|-------------------|---------------|
| `b3_staticBody` | Never | No | Dynamic only |
| `b3_dynamicBody` | Simulated | Yes | All types |
| `b3_kinematicBody` | Scripted | No | Dynamic only |

<ExamplesTable ids="example-shapes,example-cube-heap" />

### Position and Rotation

Math types are plain arrays: `b3Vec3` is `[x, y, z]` and `b3Quat` is `[x, y, z, w]` (the identity rotation is `[0, 0, 0, 1]`) — pass and receive them straight from gl-matrix/mathcat-style libraries. Value getters are out-param-first and zero-allocation: pass a scratch array to fill instead of receiving a freshly allocated object.

<Snippet source="./bodies.ts" select="transform" />

### Velocity

<Snippet source="./bodies.ts" select="velocity" />

### Forces and Impulses

Forces accumulate until the next `b3World_Step` call, then clear. Impulses apply an instant velocity change.

**Important:** box3d's default shape density is 1000 kg/m³, making bodies much heavier than in most engines. Scale your impulse magnitudes by the body's mass to get predictable results.

<Snippet source="./bodies.ts" select="forces" />

<ExamplesTable ids="example-add-impulse-at-position,example-explosion" />

### Damping

<Snippet source="./bodies.ts" select="damping" />

<ExamplesTable ids="example-linear-damping,example-angular-damping" />

### Gravity Scale

<Snippet source="./bodies.ts" select="gravity-scale" />

<ExamplesTable ids="example-gravity-factor" />

### Sleeping

Bodies at rest are put to sleep automatically to save CPU. You can also control sleep manually.

<Snippet source="./bodies.ts" select="sleeping" />

### Continuous Collision Detection

Enable CCD for fast-moving objects (bullets, projectiles) to prevent tunneling through thin walls.

<Snippet source="./bodies.ts" select="ccd" />

<ExamplesTable ids="example-ccd" />

### Changing Body Type

<Snippet source="./bodies.ts" select="change-type" />

### Kinematic Bodies

Use `b3Body_SetTargetTransform` to move kinematic bodies each frame. box3d computes the velocities needed to reach the target, so dynamic bodies are pushed physically rather than teleported through.

<Snippet source="./bodies.ts" select="kinematic-move" />

### Material Properties

Friction and restitution can be set per shape at creation, or updated at runtime via `b3Shape_SetSurfaceMaterial`.

<Snippet source="./bodies.ts" select="material" />

<ExamplesTable ids="example-friction,example-restitution" />

### Collision Filtering

box3d filters collisions with `bigint` category and mask bits. A contact fires when `(categoryA & maskB) != 0n AND (categoryB & maskA) != 0n`.

<Snippet source="./bodies.ts" select="collision-filter" />

<ExamplesTable ids="example-collision-filtering" />

### Sensors

Sensor shapes detect overlaps without generating contact forces. Both the sensor and each visitor shape must opt in to sensor events.

<Snippet source="./bodies.ts" select="sensor" />

<ExamplesTable ids="example-sensor" />

## Shapes

box3d shapes attach to a body and define its collision geometry. A body can have multiple shapes.

### Box

<Snippet source="./shapes.ts" select="box" />

### Sphere

<Snippet source="./shapes.ts" select="sphere" />

### Capsule

<Snippet source="./shapes.ts" select="capsule" />

### Convex Hull

<Snippet source="./shapes.ts" select="hull" />

### Cylinder and Cone

<Snippet source="./shapes.ts" select="cylinder-cone" />

### Triangle Mesh

Triangle meshes are best suited for static terrain and level geometry. box3d performs internal preprocessing (active edges, BVH) on mesh creation.

<Snippet source="./shapes.ts" select="mesh" />

<ExamplesTable ids="example-triangle-mesh" />

### Voxel Field (Static Only)

Voxel fields describe block worlds as a grid of unit cubes. Only the faces of solid voxels that touch empty space collide, and coplanar faces never generate edge contacts, so bodies slide cleanly across flat voxel floors. Fields are immutable: to edit a block world, rebuild the affected chunk's field, destroy the old shape, and create a new one (set `invokeContactCreation` on the shape def so resting bodies wake). Keep chunks around 16–64 voxels per axis and tile them; with `hasBorder`, the outer layer never collides but hides its neighbours' faces so seams stay smooth.

This shape is a fork addition (from [liamdon/box3d](https://github.com/liamdon/box3d)); it is not in upstream box3d.

<Snippet source="./shapes.ts" select="voxel" />

<ExamplesTable ids="example-voxel-field" />

### Compound Shapes (Static Only)

Compound shapes combine multiple child shapes on a single body. **In box3d, compound shapes are static-only** - `b3_dynamicBody` and `b3_kinematicBody` will reject compound shapes.

<Snippet source="./shapes.ts" select="compound" />

<ExamplesTable ids="example-static-compound" />

## Joints

Joints constrain the relative motion between two bodies. All joint defs share a `bodyIdA` / `bodyIdB` pair. Joint frames (`frameA`, `frameB`) are local-space transforms that define where and how the joint attaches.

**Axis conventions:**
- Revolute: rotates about the joint frame's local **Z**-axis
- Prismatic: slides along the joint frame's local **X**-axis
- Spherical: cone centered on frame **Z**

<ExamplesTable ids="example-constraints,example-hinge-motor" />

### Revolute (Hinge)

<Snippet source="./joints.ts" select="revolute" />

### Revolute Motor

<Snippet source="./joints.ts" select="revolute-motor" />

### Weld (Fixed)

<Snippet source="./joints.ts" select="weld" />

### Distance

<Snippet source="./joints.ts" select="distance" />

### Spherical (Ball and Socket)

<Snippet source="./joints.ts" select="spherical" />

### Prismatic (Slider)

<Snippet source="./joints.ts" select="prismatic" />

### Wheel (Suspension)

<Snippet source="./joints.ts" select="wheel" />

## Queries

Queries ask questions about the physics world without advancing the simulation.

### Cast Ray (Closest)

<Snippet source="./queries.ts" select="cast-ray" />

<ExamplesTable ids="example-cast-ray" />

### Cast Ray (All Hits)

<Snippet source="./queries.ts" select="cast-ray-all" />

### Cast Shape (Shapecast)

Sweep a sphere proxy through the world and find the closest hit.

<Snippet source="./queries.ts" select="cast-shape" />

<ExamplesTable ids="example-cast-shape" />

### Overlap AABB

<Snippet source="./queries.ts" select="overlap-aabb" />

### Overlap Shape

<Snippet source="./queries.ts" select="overlap-shape" />

### Query Filter

<Snippet source="./queries.ts" select="query-filter" />

## Events

box3d surfaces physics events (contacts, sensors, body moves, joints) each `b3World_Step`. Events are opt-in per shape. Rather than allocating a JS object per event every step — which does not scale — box3d.js reads them through a **reusable, wasm-backed events buffer**: allocate the buffer (and small reader scratch objects) once, refill it each step with `getEvents`, and read it back with zero allocation. Free it with `destroyEventsBuffer` when done.

### Contact Events

<Snippet source="./events.ts" select="contact-events" />

<ExamplesTable ids="example-events" />

### Reading Contacts Every Frame

Events fire when contacts begin, end, or hit. To instead inspect **every current contact manifold** each frame — for debug drawing, gameplay logic, or custom response — use a reusable, wasm-backed contacts buffer. This is the recommended fast path: its storage lives in the wasm heap and grows on its own, so refilling it each frame copies nothing across the wasm/JS boundary and allocates no typed arrays. You allocate the buffer (and small reader scratch objects) once, fill it in place each frame, and free it when done.

<Snippet source="./events.ts" select="contacts-buffer" />

<ExamplesTable ids="example-contacts" />

### Sensor Events

<Snippet source="./events.ts" select="sensor-events" />

<ExamplesTable ids="example-sensor" />

### Pre-Solve Callback

The pre-solve callback fires for each contact before the constraint solver runs. Return `false` to suppress the contact response entirely (useful for one-way platforms).

<Snippet source="./events.ts" select="pre-solve" />

## Multithreading

box3d's internal solver can spread work across OS threads via Emscripten pthreads. This requires `SharedArrayBuffer`, which in turn requires [cross-origin isolation](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated).

**Required HTTP headers:**
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Initialization

<Snippet source="./multithreading.ts" select="mt-init" />

### World Setup

<Snippet source="./multithreading.ts" select="mt-world" />

### Stepping

<Snippet source="./multithreading.ts" select="mt-step" />

The simulation API is identical to the single-threaded build - only the import path and `workerCount` differ.

<ExamplesTable ids="example-multithreading" />

## Building from Source

### Prerequisites

- [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) - `emcmake` and `em++` must be on `PATH`. The published builds are produced with **emsdk 6.0.2** (emcc/clang 6.0.2); other recent versions should work.
- [CMake](https://cmake.org/) ≥ 3.22
- Node.js ≥ 18
- pnpm

```bash
# Install the pinned Emscripten version and activate the environment
cd /path/to/emsdk
./emsdk install 6.0.2
./emsdk activate 6.0.2
source ./emsdk_env.sh
```

### Build

```bash
git clone --recurse-submodules <repo-url>
pnpm install
pnpm build
```

Outputs to `dist/`:

| File | Description |
|------|-------------|
| `box3d.mjs` + `box3d.wasm` | Single-threaded, separate WASM |
| `box3d.inline.mjs` | Single-threaded, inlined WASM |
| `box3d.mt.mjs` + `box3d.mt.wasm` | Multithreaded, separate WASM |
| `box3d.mt.inline.mjs` | Multithreaded, inlined WASM |
| `box3d.d.ts` | TypeScript definitions (shared by all builds) |

```bash
# Debug build
pnpm build:debug

# Smoke test (falling-box simulation on both ST and MT builds)
pnpm test
```

### Docs

```bash
# Regenerate README.md from docs/README.template.md
pnpm docs:build

# Typecheck all code snippets in docs/
pnpm docs:check
```

### Releasing

Releases are published to npm by [`publish.yml`](.github/workflows/publish.yml) via npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/), so no npm token is needed locally or in CI. `dist/` is committed, so the workflow publishes the checked-in build after running the smoke test.

```bash
# 1. Rebuild and commit dist/ if the bindings changed
pnpm build && pnpm test

# 2. Bump "version" in package.json and note the changes in CHANGELOG.md, then commit

# 3. Tag the release; the tag must match package.json's version
git tag v0.2.1 && git push origin v0.2.1
```

To rehearse without publishing, run the workflow manually from the Actions tab; a manual run does `npm publish --dry-run`.
