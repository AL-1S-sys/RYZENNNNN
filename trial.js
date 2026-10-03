import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ------------------------------------------------------------------
   MOBILE COMPATIBILITY (Android + iOS)
------------------------------------------------------------------- */

// Keep a CSS custom property in sync with the *real* visible height.
function syncAppHeight() {
  const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${h}px`);
}
syncAppHeight();
window.addEventListener('resize', syncAppHeight);
window.addEventListener('orientationchange', () => {
  setTimeout(syncAppHeight, 50);
  setTimeout(syncAppHeight, 300);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncAppHeight);
}

// Stop iOS Safari's native pinch-to-zoom / double-tap-to-zoom gestures
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('gestureend', (e) => e.preventDefault());

let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 350) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

// Block multi-touch page gestures anywhere outside the scrollable info panel
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1 && !e.target.closest('#info-panel')) {
    e.preventDefault();
  }
}, { passive: false });

/* ------------------------------------------------------------------
   BUILDING FOOTPRINT (U-shape with triangular bevels)
------------------------------------------------------------------- */
const B = {
  outerLeft:  -11,
  outerRight:  11,
  backOuter:  -7.5,   // rear edge of the back bar
  backInner:  -3.5,   // where the courtyard starts
  wingInnerL: -4.5,   // inner face of the left wing
  wingInnerR:  4.5,   // inner face of the right wing
  frontEdge:   7        // where both wings end
};

// Corridor: a wide walkway running in front of every room, tracing the U
const PATH_W = 1.8;
const PATH_Y = 0.17;              // just above the slab top (0.15)

// Every floor plan has 8 back-corridor rooms: 6 sit flat along the back wall,
// and 2 are angled 45° to sit flush in the triangular bevel nooks at each end.
const BACK_SLOT_Z = -6.2;
const CORNER_Z = -5.29;              // inset from the diagonal wall by half its depth
const CORNER_W = 2.2, CORNER_D = 2.0; // corner rooms, angled to match the bevel
const BACK_W = 1.6, BACK_D = 2.0;     // flat rooms along the straight back wall
const BIG_W = 3.3;                    // wider corridor rooms (Layer 4)
const MED_W = 2.6;                    // shrunk version of BIG_W
const SMALL_W = 1.25;                 // shrunk rooms used when an extra room needs to fit

const BACK_SLOTS = [
  { x: -8.79, z: CORNER_Z,     rot:  Math.PI / 4, w: CORNER_W, d: CORNER_D }, // left bevel nook
  { x: -6.20, z: BACK_SLOT_Z,  rot:  0,           w: BACK_W,   d: BACK_D },
  { x: -4.34, z: BACK_SLOT_Z,  rot:  0,           w: BACK_W,   d: BACK_D },
  { x: -2.48, z: BACK_SLOT_Z,  rot:  0,           w: BACK_W,   d: BACK_D },
  { x: -0.62, z: BACK_SLOT_Z,  rot:  0,           w: BACK_W,   d: BACK_D },
  { x:  1.24, z: BACK_SLOT_Z,  rot:  0,           w: BACK_W,   d: BACK_D },
  { x:  3.10, z: BACK_SLOT_Z,  rot:  0,           w: BACK_W,   d: BACK_D },
  { x:  8.79, z: CORNER_Z,     rot: -Math.PI / 4, w: CORNER_W, d: CORNER_D }  // right bevel nook
];
const WING_SLOTS = [
  { x: -8.6, z: -1.0 }, { x: -8.6, z: 4.15 },   // left wing, front then back
  { x:  8.6, z: -1.0 }, { x:  8.6, z: 4.15 }    // right wing, front then back
];
const WING_W = 5.0, WING_D = 4.0;   // w runs along the wing, d across it

// QR Code Checkpoint Registry
const checkpoints = {
  'L1_ENTRANCE':      { name: 'Main Lobby & Security',      layer: 1, targetId: 'l1_lobby' },
  'CAFETERIA':        { name: 'Cafeteria/Student lounge',   layer: 1, targetId: 'l1_cafeteria_annex' },
  'LIBRARY_LOWER':    { name: 'Library Lower Floor',        layer: 2, targetId: 'l2_library' },
  'LIBRARY_UPPER':    { name: 'Library Upper Floor',        layer: 3, targetId: 'l3_libupper' },
  'STUDENT_LOUNGE_1': { name: 'Student Lounge 1',           layer: 3, targetId: 'l3_electronics' },
  'STUDENT_LOUNGE_2': { name: 'Student Lounge 2',           layer: 4, targetId: 'l4_printroom' }
};

// Floor plans: 4 wing rooms (in WING_SLOTS order) + corridor rooms.
// Corridor rooms normally pull their x/z/w/d/rot from BACK_SLOTS by index,
// but any room may override x/z/w/d/rot directly. Wing rooms follow the same
// pattern against WING_SLOTS.
//
// PHOTOS: any room can have an `images: [...]` list (paths relative to
// index.html). One image shows full width in the details panel; two images
// show side by side. Rooms without `images` show no photo section.
// Tapping a photo opens it full screen.
const floorPlans = {
  1: {
    wings: [
      { id: 'l1_wing_left_a',  name: 'Faculty Room A', desc: 'Faculty desks and consultation space near the lobby.', hours: '8:00 AM - 5:00 PM', status: 'Open' },
      { id: 'l1_wing_left_b',  name: 'Faculty Room B', desc: 'Additional faculty desks opening onto the courtyard.', hours: '8:00 AM - 5:00 PM', status: 'Open' },
      { id: 'l1_wing_right_a', name: 'CAS', desc: 'cas department.', hours: '8:00 AM - 4:30 PM', status: 'Open' },
      { id: 'l1_wing_right_b', name: 'CAS', desc: 'cas department.', hours: '8:00 AM - 4:30 PM', status: 'Open' }
    ],
    corridor: [
      { id: 'l1_lobby',       name: 'Main Lobby & Security', desc: 'Main entrance, guard post, and visitor logbook.', hours: '6:00 AM - 9:00 PM', status: 'Open',
        images: ['images/lobby-1.jpg', 'images/lobby-2.jpg'] },
      { id: 'l1_admin_clinic_chapel', name: 'Business center, Teacher lounge', desc: 'none', hours: '6:00 AM - 8:00 PM', status: 'Open',
        // Centred to match Layer 2's Room 204 + 205 combined footprint below it.
        x: -5.35 + BIG_W / 2, z: BACK_SLOT_Z, w: BIG_W * 2, d: BACK_D, windows: [1, 1.2, 1.2] },
      { id: 'l1_cafeteria_annex', name: 'Cafeteria/Student lounge', desc: 'none', hours: '7:00 AM - 7:00 PM', status: 'Open',
        images: ['images/cafeteria.jpg'],
        x: 8.79, z: CORNER_Z, rot: -Math.PI / 4, w: CORNER_W, d: CORNER_D }
    ]
  },
  2: {
    wings: [
      { id: 'l2_wing_left_a',  name: 'ROOM 202', desc: 'Tiered seating for 80.', hours: '7:00 AM - 7:00 PM', status: 'Open' },
      { id: 'l2_wing_left_b',  name: 'ROOM 201', desc: 'Tiered seating for 80.', hours: '7:00 AM - 7:00 PM', status: 'Open' },
      { id: 'l2_wing_right_a', name: 'ROOM 206', desc: 'Flat-floor room with movable tables.', hours: '7:00 AM - 7:00 PM', status: 'Open' },
      { id: 'l2_wing_right_b', name: 'ROOM 207', desc: 'Flat-floor room with movable tables.', hours: '7:00 AM - 7:00 PM', status: 'Open' }
    ],
    corridor: [
      { id: 'l2_library',      name: 'Library Lower Floor', desc: 'Book stacks, quiet reading, and the circulation desk.', hours: '8:00 AM - 6:00 PM', status: 'Open',
        images: ['images/library-lower.jpg'] },
      { id: 'l2_room103',      name: 'ROOM 204', desc: 'Standard classroom.', hours: '7:00 AM - 7:00 PM', status: 'Open',
        x: -5.35, z: BACK_SLOT_Z, w: BIG_W, d: BACK_D },
      { id: 'l2_room104',      name: 'ROOM 205', desc: 'Standard classroom.', hours: '7:00 AM - 7:00 PM', status: 'Open',
        x: -5.35 + BIG_W, z: BACK_SLOT_Z, w: BIG_W, d: BACK_D },
      { id: 'l2_restroom_f',   name: 'Restroom (Women/Men)', desc: 'Located along the corridor.', hours: 'Always Open', status: 'Open',
        x:  0.6, z: BACK_SLOT_Z, w: BACK_W, d: BACK_D }
    ]
  },
  3: {
    wings: [
      { id: 'l3_wing_left_a',  name: 'ROOM 302', desc: '40 workstations for programming classes.', hours: '8:00 AM - 6:00 PM', status: 'Open' },
      { id: 'l3_wing_left_b',  name: 'ROOM 301', desc: 'Racks, patch panels, and hands-on networking benches.', hours: '8:00 AM - 6:00 PM', status: 'Open' },
      // Right wing is split into 3 narrower rooms with explicit x/z/w/d.
      { id: 'l3_wing_right_a', name: 'ROOM 307', desc: 'Seating and charging stations overlooking the courtyard.', hours: '24/7 Access', status: 'Open',
        x: 8.6, z: -1.85, w: 3.3, d: WING_D },
      { id: 'l3_wing_right_b', name: 'ROOM 308', desc: 'Bookable pods for small-group work sessions.', hours: '24/7 Access', status: 'Open',
        x: 8.6, z:  1.6,  w: 3.3, d: WING_D },
      { id: 'l3_wing_right_c', name: 'ROOM 309', desc: 'Quieter lounge with study booths.', hours: '24/7 Access', status: 'Open',
        x: 8.6, z:  5.05, w: 3.3, d: WING_D }
    ],
    corridor: [
      { id: 'l3_libupper',    name: 'Library Upper Floor', desc: 'Book stacks, quiet reading, and the circulation desk.', hours: 'N/A', status: 'Close',
        images: ['images/library-upper.jpg'] },
      { id: 'l3_comlab2',     name: 'ROOM 304', desc: 'General-use lab, printing station, and video/audio editing suites.', hours: '8:00 AM - 6:00 PM', status: 'Open',
        x: -5.35, z: BACK_SLOT_Z, w: BIG_W, d: BACK_D },
      { id: 'l3_facultyb',    name: 'ROOM 305', desc: 'IT faculty offices with an adjoining group work room.', hours: '8:00 AM - 5:00 PM', status: 'Open',
        x: -5.35 + BIG_W, z: BACK_SLOT_Z, w: BIG_W, d: BACK_D },
      { id: 'l3_restroom_f',  name: 'Restroom (Women/Men)', desc: 'Located at the end of the corridor.', hours: 'Always Open', status: 'Open',
        x: 0.6, z: BACK_SLOT_Z, rot: 0, w: BACK_W, d: BACK_D },
      { id: 'l3_comlab3',     name: 'ROOM 306', desc: 'Overflow lab for programming classes.', hours: '8:00 AM - 6:00 PM', status: 'Open',
        // Sits immediately next to the restroom, 1.86 centre-to-centre spacing.
        x: 0.6 + 1.86, z: BACK_SLOT_Z, rot: 0, w: BACK_W, d: BACK_D },
      { id: 'l3_electronics', name: 'Student lounge1', desc: 'A student lounge is a dedicated, comfortable space on campus designed for students to relax, socialize, study, or unwind between classes.', hours: '24/7', status: 'Open',
        images: ['images/student-lounge-1.jpg'],
        x: 0.6 + 1.86 * 2, z: BACK_SLOT_Z, rot: 0, w: BACK_W, d: BACK_D }
    ]
  },
  4: {
    wings: [
      { id: 'l4_wing_left_a',  name: 'ROOM 402', desc: 'Raked seating for talks and defenses.', hours: 'By Reservation', status: 'Open' },
      { id: 'l4_wing_left_b',  name: 'ROOM 401', desc: 'Backstage holding area for performers.', hours: 'By Reservation', status: 'Open' },
      { id: 'l4_wing_right_a', name: 'ROOM 408', desc: 'Large meeting table and video conferencing.', hours: '8:00 AM - 5:00 PM', status: 'Open' },
      { id: 'l4_wing_right_b', name: 'ROOM 409', desc: 'Breakout room beside the conference room.', hours: '8:00 AM - 5:00 PM', status: 'Open' }
    ],
    // Room 403 sits in the same corner-nook slot as Layer 3's library.
    // Rooms 404/405 are merged and line up above Layer 2's Room 204 + 205.
    corridor: [
      { id: 'l4_lounge',    name: 'ROOM 403', desc: 'Games, seating, and campus views.', hours: '8:00 AM - 5:00 PM', status: 'Open',
        x: -8.79, z: CORNER_Z, rot: Math.PI / 4, w: CORNER_W, d: CORNER_D },
      { id: 'l4_studio_council', name: 'ROOM 404/ROOM 405', desc: 'Joint space combining the open art/design studio with the student council office and meeting area.', hours: '8:00 AM - 6:00 PM', status: 'Open',
        x: -5.35 + BIG_W / 2, z: BACK_SLOT_Z, w: BIG_W * 2, d: BACK_D, windows: 2 },
      { id: 'l4_restroom_f', name: 'Restroom (Women/Men)', desc: 'Located along the top-floor corridor.', hours: 'Always Open', status: 'Open',
        x:  0.6, z: BACK_SLOT_Z, w: BACK_W, d: BACK_D },
      { id: 'l4_storage_alumni', name: 'ROOM 406/ROOM 407', desc: 'COMLAB 1 and COMLAB 2.', hours: '8:00 AM - 5:00 PM (storage side restricted)', status: 'Open',
        x:  2.95, z: BACK_SLOT_Z, w: 2.7, d: BACK_D, windows: 2 },
      { id: 'l4_printroom', name: 'Student Lounge2', desc: 'Games, seating, and campus views.  ', hours: '24/7', status: 'Open',
        images: ['images/student-lounge-2.jpg'],
        x:  5.3, z: BACK_SLOT_Z, w: SMALL_W, d: BACK_D }
    ]

  }
};

// Rooms flagged for the "School Amenities" dashboard: the campus's
// dedicated student-relaxation spots. Kept at module scope so both the 3D
// scene and the dashboard panel read from the same single list.
const highlightedIds = [
  'l1_cafeteria_annex',               // Cafeteria/Student lounge
  'l2_library', 'l3_libupper',        // Library Lower Floor, Library Upper Floor
  'l3_electronics', 'l4_printroom'    // Student Lounge 1, Student Lounge 2
];

// Flatten the floor plans into positioned POIs
const ROOM_COLOR = 0xf3f1e7;
const poiData3D = [];
Object.keys(floorPlans).forEach(key => {
  const layer = parseInt(key);
  const plan = floorPlans[layer];

  plan.wings.forEach((room, i) => {
    const slot = WING_SLOTS[i] || {};
    poiData3D.push({
      ...room,
      layer,
      x: room.x !== undefined ? room.x : slot.x,
      z: room.z !== undefined ? room.z : slot.z,
      w: room.w !== undefined ? room.w : WING_W,
      d: room.d !== undefined ? room.d : WING_D,
      color: ROOM_COLOR,
      windows: room.windows !== undefined ? room.windows : 1
    });
  });
  plan.corridor.forEach((room, i) => {
    const slot = BACK_SLOTS[i] || {};
    poiData3D.push({
      ...room,
      layer,
      x: room.x !== undefined ? room.x : slot.x,
      z: room.z !== undefined ? room.z : slot.z,
      w: room.w !== undefined ? room.w : slot.w,
      d: room.d !== undefined ? room.d : slot.d,
      rot: room.rot !== undefined ? room.rot : slot.rot,
      windows: room.windows !== undefined ? room.windows : 1,
      color: ROOM_COLOR
    });
  });
});

// Resolve the scanned checkpoint against the generated rooms
const urlParams = new URLSearchParams(window.location.search);
const cpParam = urlParams.get('cp') || 'L1_ENTRANCE';
const currentSpot = { ...(checkpoints[cpParam] || checkpoints['L1_ENTRANCE']) };
const spotRoom = poiData3D.find(p => p.id === currentSpot.targetId);
currentSpot.x = spotRoom ? spotRoom.x : 0;
currentSpot.z = spotRoom ? spotRoom.z : 0;

// Scene Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8eef5);

// Use the visualViewport size when available (more reliable on mobile).
function getViewportSize() {
  if (window.visualViewport) {
    return { w: window.visualViewport.width, h: window.visualViewport.height };
  }
  return { w: window.innerWidth || 300, h: window.innerHeight || 300 };
}

const { w: initW, h: initH } = getViewportSize();

const BASE_FOV_DEG = 45;
const BASE_ASPECT = 16 / 9; // the wide-desktop aspect the scene was framed for
const BASE_V_FOV_RAD = THREE.MathUtils.degToRad(BASE_FOV_DEG);
const BASE_H_FOV_RAD = 2 * Math.atan(Math.tan(BASE_V_FOV_RAD / 2) * BASE_ASPECT);
const MAX_V_FOV_DEG = 85; // clamp so extremely narrow screens don't fisheye

function getResponsiveFovDeg(aspect) {
  if (aspect >= BASE_ASPECT) return BASE_FOV_DEG;
  const vFovRad = 2 * Math.atan(Math.tan(BASE_H_FOV_RAD / 2) / aspect);
  return Math.min(THREE.MathUtils.radToDeg(vFovRad), MAX_V_FOV_DEG);
}

const camera = new THREE.PerspectiveCamera(getResponsiveFovDeg(initW / initH), initW / initH, 1, 1000);

const wideCamPos = new THREE.Vector3(18, 19, 26);
const wideTarget = new THREE.Vector3(0, 6, 0.5);

camera.position.copy(wideCamPos);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(initW, initH);
// Cap pixel ratio at 2 to keep frame rate reasonable on high-DPI screens.
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

renderer.domElement.style.touchAction = 'none';
renderer.domElement.style.cursor = 'grab';
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 5;
controls.maxDistance = 70;
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI / 2 + 0.1;
controls.target.copy(wideTarget);

// One finger orbits, two fingers pinch-to-dolly + pan.
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN
};
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN
};
controls.rotateSpeed = 0.7;
controls.panSpeed = 0.7;
controls.zoomSpeed = 0.8;

const targetCamPos = new THREE.Vector3().copy(wideCamPos);
const targetLookAt = new THREE.Vector3().copy(wideTarget);
let isTransitioning = false;

controls.addEventListener('start', () => { isTransitioning = false; });

let activeIsolatedLayer = 'all';

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.7));

const sunLight = new THREE.DirectionalLight(0xfff5e6, 0.9);
sunLight.position.set(30, 50, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 150;
sunLight.shadow.camera.left = -30;
sunLight.shadow.camera.right = 30;
sunLight.shadow.camera.top = 30;
sunLight.shadow.camera.bottom = -30;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

// Grounds
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x94b49f, roughness: 0.9 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
ground.receiveShadow = true;
scene.add(ground);

// Courtyard paving fills the opening of the U exactly
const courtW = B.wingInnerR - B.wingInnerL;
const courtD = B.frontEdge - B.backInner;
const walkway = new THREE.Mesh(
  new THREE.PlaneGeometry(courtW, courtD),
  new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.6 })
);
walkway.rotation.x = -Math.PI / 2;
walkway.position.set(0, 0.01, B.backInner + courtD / 2);
walkway.receiveShadow = true;
scene.add(walkway);

/* U-shaped slab geometry with triangular bevels on both back corners. */
function makeUShape(m = 0) {
  const s = new THREE.Shape();

  s.moveTo(B.outerLeft  - m,     B.backOuter - m + 3.0);
  s.lineTo(B.outerLeft  - m + 3.0, B.backOuter - m);

  s.lineTo(B.outerRight + m - 3.0, B.backOuter - m);
  s.lineTo(B.outerRight + m,     B.backOuter - m + 3.0);

  s.lineTo(B.outerRight + m, B.frontEdge + m);
  s.lineTo(B.wingInnerR - m, B.frontEdge + m);
  s.lineTo(B.wingInnerR - m, B.backInner + m);
  s.lineTo(B.wingInnerL + m, B.backInner + m);
  s.lineTo(B.wingInnerL + m, B.frontEdge + m);
  s.lineTo(B.outerLeft  - m, B.frontEdge + m);
  s.closePath();
  return s;
}

function makeSlabGeometry(margin, thickness, topY) {
  const geo = new THREE.ExtrudeGeometry(makeUShape(margin), { depth: thickness, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);      // shape Y becomes world Z; slab now spans y = -thickness..0
  geo.translate(0, topY, 0);
  return geo;
}

/* Corridor geometry */
const pathMat = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.75 });

const backPathZ = B.backInner - PATH_W / 2;                 // centre of the back run
const wingPathX = B.wingInnerR + PATH_W / 2;                // centre of each wing run
const wingPathLen = B.frontEdge - B.backInner;

function makeStrip(w, d, x, z) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pathMat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, PATH_Y, z);
  mesh.receiveShadow = true;
  return mesh;
}

function buildFloorPath() {
  const parts = [];
  const spanX = B.outerRight - B.outerLeft;

  parts.push(makeStrip(spanX, PATH_W, 0, backPathZ));
  parts.push(makeStrip(PATH_W, wingPathLen, -wingPathX, B.backInner + wingPathLen / 2));
  parts.push(makeStrip(PATH_W, wingPathLen,  wingPathX, B.backInner + wingPathLen / 2));

  return parts;
}

const floorMeshes = {};
const selectableSlabs = [];
const selectableRooms = [];
const spacing = 4.5;

const infoPanel = document.getElementById('info-panel');
const layerDisplay = document.getElementById('layer-display');
const overlay = document.getElementById('instructions-overlay');
const locationDisplay = document.getElementById('location-display');

/* Reusable staircase builder: a row of steps rising along local +z */
function makeStaircase(stepCount, stepDepth, riseStep = 0.38) {
  const stairGroup = new THREE.Group();
  for (let s = 0; s < stepCount; s++) {
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(PATH_W * 0.8, 0.2, stepDepth),
      new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.6 })
    );
    step.position.set(0, s * riseStep + 0.1, s * stepDepth);
    step.castShadow = true;
    step.receiveShadow = true;
    stairGroup.add(step);
  }
  return stairGroup;
}

// The notch between the two left-wing rooms, used to place a second
// staircase there on every floor.
const LEFT_WING_GAP_START = WING_SLOTS[0].z + WING_D / 2;
const LEFT_WING_GAP_Z = LEFT_WING_GAP_START + 0.15;

// Build Floors
for (let i = 1; i <= 4; i++) {
  const floorGroup = new THREE.Group();
  const floorY = (i - 1) * spacing;
  floorGroup.position.y = floorY;

  // Main U slab
  const slabMesh = new THREE.Mesh(
    makeSlabGeometry(0, 0.3, 0.15),
    new THREE.MeshStandardMaterial({ color: 0xdde3ea, roughness: 0.5, side: THREE.DoubleSide })
  );
  slabMesh.receiveShadow = true;
  slabMesh.userData = { type: 'slab', layerNumber: i, floorY: floorY };
  floorGroup.add(slabMesh);
  selectableSlabs.push(slabMesh);

  // Balcony lip
  const balconyMesh = new THREE.Mesh(
    makeSlabGeometry(0.25, 0.12, -0.15),
    new THREE.MeshStandardMaterial({ color: 0xc4cbd4, roughness: 0.4, side: THREE.DoubleSide })
  );
  balconyMesh.receiveShadow = true;
  floorGroup.add(balconyMesh);

  // Corridor path
  buildFloorPath().forEach(seg => floorGroup.add(seg));

  // Staircase sits on the right side of the back corridor
  if (i < 4) {
    const backStair = makeStaircase(5, 0.6);
    backStair.position.set(6.2, 1, BACK_SLOT_Z);
    backStair.rotation.y = Math.PI / 2;
    floorGroup.add(backStair);
  }

  // Second staircase, in the notch between Faculty Room A and B
  if (i < 4) {
    const wingStair = makeStaircase(5, 0.6);
    wingStair.position.set(-wingPathX, 1, LEFT_WING_GAP_Z);
    floorGroup.add(wingStair);
  }

  // Rooms loop for current floor
  poiData3D.filter(p => p.layer === i).forEach(poi => {
    const isTargetRoom = (poi.id === currentSpot.targetId);
    const isHighlighted = highlightedIds.includes(poi.id);

    const roomGroup = new THREE.Group();
    roomGroup.position.set(poi.x, 0.75, poi.z);

    // Wing rooms face the courtyard; back-corridor rooms use their assigned angle
    if (poi.rot !== undefined) {
      roomGroup.rotation.y = poi.rot;
    } else if (poi.x < 0 && poi.z > B.backInner) {
      roomGroup.rotation.y = Math.PI / 2;
    } else if (poi.x > 0 && poi.z > B.backInner) {
      roomGroup.rotation.y = -Math.PI / 2;
    }

    const roomMesh = new THREE.Mesh(
      new THREE.BoxGeometry(poi.w, 1.2, poi.d),
      new THREE.MeshStandardMaterial({
        color: isTargetRoom ? 0xff4081 : (isHighlighted ? 0xffd700 : poi.color),
        roughness: 0.7,
        emissive: isTargetRoom ? 0xff80ab : (isHighlighted ? 0xffa500 : 0x000000),
        emissiveIntensity: isTargetRoom ? 0.5 : (isHighlighted ? 0.6 : 0)
      })
    );
    roomMesh.castShadow = true;
    roomMesh.receiveShadow = true;
    roomGroup.add(roomMesh);

    // Glazing on the courtyard-facing side. `windows` can be a number N
    // (N equal panes) or an array of relative weights, e.g. [1, 1.2, 1.2].
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: 0.1, transparent: true, opacity: 0.5 });
    const facadeW = poi.w * 0.8;
    const mullionGap = 0.3;
    const weights = Array.isArray(poi.windows) ? poi.windows : Array(poi.windows || 1).fill(1);
    const windowCount = weights.length;
    const totalGap = mullionGap * (windowCount - 1);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const unitW = (facadeW - totalGap) / weightSum;

    let cursorX = -facadeW / 2;
    weights.forEach((weight) => {
      const paneW = unitW * weight;
      const glassMesh = new THREE.Mesh(new THREE.BoxGeometry(paneW, 0.6, 0.1), glassMat);
      glassMesh.position.set(cursorX + paneW / 2, 0, poi.d / 2 + 0.02);
      roomGroup.add(glassMesh);
      cursorX += paneW + mullionGap;
    });

    roomGroup.userData = { type: 'room', layerNumber: i, data: poi, floorY: floorY };
    if (isTargetRoom || isHighlighted) roomGroup.scale.set(1.05, 1.2, 1.05);

    floorGroup.add(roomGroup);
    selectableRooms.push(roomGroup);
  });

  floorGroup.visible = true;
  floorMeshes[i] = floorGroup;
  scene.add(floorGroup);
}

// 3D Pin
const userPin = new THREE.Mesh(
  new THREE.ConeGeometry(0.6, 1.5, 8),
  new THREE.MeshBasicMaterial({ color: 0xff3b30 })
);
userPin.rotation.x = Math.PI;
userPin.position.set(currentSpot.x, (currentSpot.layer - 1) * spacing + 2, currentSpot.z);
scene.add(userPin);

if (locationDisplay) locationDisplay.innerHTML = `📍 ${currentSpot.name}`;

const closeBtn = document.getElementById('close-instructions');
if (closeBtn) {
  closeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (overlay) overlay.classList.add('hidden');

    // If this session came from a scanned QR code, fly straight into that
    // room's floor instead of sitting on the all-floors overview.
    if (spotRoom) {
      isolateAndZoomToRoom(spotRoom);
    } else {
      isolateAndZoomFloor('all', 0);
    }
  });
}

/* ------------------------------------------------------------------
   "X" EXIT-ZOOM BUTTON
   Shown any time the camera is isolated on a single layer/room;
   tapping it flies back out to the all-floors overview.
------------------------------------------------------------------- */
let exitZoomBtn = null;
function ensureExitZoomBtn() {
  if (exitZoomBtn) return exitZoomBtn;

  const btn = document.createElement('button');
  btn.id = 'exit-zoom-btn';
  btn.setAttribute('aria-label', 'Exit zoomed view');
  btn.innerText = '\u00D7'; // ×
  Object.assign(btn.style, {
    position: 'fixed',
    top: 'calc(16px + env(safe-area-inset-top, 0px))',
    right: 'calc(16px + env(safe-area-inset-right, 0px))',
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(20, 20, 20, 0.65)',
    color: '#ffffff',
    fontSize: '26px',
    lineHeight: '44px',
    textAlign: 'center',
    padding: '0',
    cursor: 'pointer',
    zIndex: '9999',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    display: 'none',
    touchAction: 'manipulation'
  });
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    isolateAndZoomFloor('all', 0);
  });
  document.body.appendChild(btn);
  exitZoomBtn = btn;
  return btn;
}
function setExitZoomBtnVisible(visible) {
  ensureExitZoomBtn().style.display = visible ? 'block' : 'none';
}

// Tap vs drag detection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let pointerStart = null;

window.addEventListener('pointerdown', (e) => { pointerStart = { x: e.clientX, y: e.clientY }; });

window.addEventListener('pointerup', (event) => {
  if (!pointerStart) return;
  const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  pointerStart = null;
  // Slightly larger drag threshold since a finger wobbles during a tap.
  if (moved > 12) return;

  // Ignore taps on any UI layer (including the photo viewer) so they never hit the map underneath
  if (!overlay || event.target.closest('#image-lightbox') || event.target.closest('#info-panel') || event.target.closest('#ui-container') || event.target.closest('#exit-zoom-btn') || event.target.closest('#dashboard-panel') || event.target.closest('#dashboard-btn') || event.target.closest('#nav-panel') || event.target.closest('#nav-pill') || !overlay.classList.contains('hidden')) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const visibleTargets = [...selectableRooms, ...selectableSlabs].filter(m => m.parent.visible);
  const intersects = raycaster.intersectObjects(visibleTargets, true);

  if (intersects.length > 0) {
    let hit = intersects[0].object;
    while (hit && !hit.userData.type && hit.parent) hit = hit.parent;

    if (activeIsolatedLayer === 'all') {
      if (hit.userData.layerNumber) isolateAndZoomFloor(hit.userData.layerNumber, hit.userData.floorY);
    } else if (hit.userData.type === 'room') {
      showRoomDetails(hit.userData.data);
    } else if (hit.userData.type === 'slab') {
      isolateAndZoomFloor('all', 0);
    }
  } else if (infoPanel) {
    infoPanel.classList.remove('active');
  }
});

const closePanelBtn = document.getElementById('close-panel');
if (closePanelBtn) {
  closePanelBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    closeLightbox();
    if (infoPanel) infoPanel.classList.remove('active');
  });
}

/* ------------------------------------------------------------------
   PHOTO LIGHTBOX: tap a room photo to view it full screen
------------------------------------------------------------------- */
const lightbox = document.getElementById('image-lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');

function openLightbox(src, alt) {
  if (!lightbox || !lightboxImg) return;
  lightboxImg.src = src;
  lightboxImg.alt = alt || '';
  lightbox.classList.add('active');
  lightbox.setAttribute('aria-hidden', 'false');
}
function closeLightbox() {
  if (!lightbox) return;
  lightbox.classList.remove('active');
  lightbox.setAttribute('aria-hidden', 'true');
}
if (lightbox) {
  // Tapping anywhere (backdrop, image, or ✕) closes it
  lightbox.addEventListener('click', (e) => {
    e.stopPropagation();
    closeLightbox();
  });
}
if (lightboxClose) {
  lightboxClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closeLightbox();
  });
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

function showRoomDetails(room) {
  closeLightbox();
  closeNavPanel();
  currentDetailRoom = room;

  const rn = document.getElementById('room-name');
  const rlt = document.getElementById('room-layer-tag');
  const rd = document.getElementById('room-desc');
  const rh = document.getElementById('room-hours');
  const rs = document.getElementById('room-status');
  const gallery = document.getElementById('room-gallery');

  if (rn) rn.innerText = room.name;
  if (rlt) rlt.innerText = `Floor Layer ${room.layer}`;
  if (rd) rd.innerText = room.desc;
  if (rh) rh.innerText = room.hours;
  if (rs) {
    rs.innerText = room.status;
    rs.style.color = (room.status === 'Open') ? '#0B3B24' : '#B04A2F';
  }

  // Photos: shown only for rooms that have an `images` list
  if (gallery) {
    gallery.innerHTML = '';
    const imgs = room.images || [];
    gallery.classList.toggle('has-images', imgs.length > 0);
    gallery.classList.toggle('two', imgs.length === 2);
    imgs.forEach(src => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = room.name;
      img.loading = 'lazy';
      img.draggable = false;
      img.addEventListener('error', () => img.remove()); // hide broken images
      img.addEventListener('click', (e) => {              // tap to enlarge
        e.stopPropagation();
        openLightbox(src, room.name);
      });
      gallery.appendChild(img);
    });
  }

  if (infoPanel) infoPanel.classList.add('active');
}

function isolateAndZoomFloor(selectedLayer, floorY) {
  activeIsolatedLayer = selectedLayer;
  if (infoPanel) infoPanel.classList.remove('active');

  if (layerDisplay) {
    layerDisplay.innerHTML = (selectedLayer === 'all')
      ? '🏢 Viewing: All Floors'
      : `🏢 Viewing: Floor Layer ${selectedLayer}`;
  }

  Object.keys(floorMeshes).forEach(key => {
    const layerNum = parseInt(key);
    floorMeshes[layerNum].visible = (selectedLayer === 'all' || selectedLayer === layerNum);
  });

  if (userPin) userPin.visible = (selectedLayer === 'all' || selectedLayer === currentSpot.layer);
  setExitZoomBtnVisible(selectedLayer !== 'all');

  if (selectedLayer === 'all') {
    targetCamPos.copy(wideCamPos);
    targetLookAt.copy(wideTarget);
  } else {
    targetLookAt.set(0, floorY + 0.5, 0.5);
    targetCamPos.set(0, floorY + 14, 20);
  }
  isTransitioning = true;
}

// Zooms straight into a specific room: isolates its floor, frames the
// camera tight on the room, and pops the info panel open automatically.
function isolateAndZoomToRoom(poi) {
  const floorY = (poi.layer - 1) * spacing;

  activeIsolatedLayer = poi.layer;
  if (infoPanel) infoPanel.classList.remove('active');

  if (layerDisplay) {
    layerDisplay.innerHTML = `🏢 Viewing: Floor Layer ${poi.layer}`;
  }

  Object.keys(floorMeshes).forEach(key => {
    const layerNum = parseInt(key);
    floorMeshes[layerNum].visible = (layerNum === poi.layer);
  });

  if (userPin) userPin.visible = (poi.layer === currentSpot.layer);
  setExitZoomBtnVisible(true);

  targetLookAt.set(poi.x, floorY + 0.5, poi.z);
  targetCamPos.set(poi.x + 6, floorY + 7, poi.z + 8);
  isTransitioning = true;

  showRoomDetails(poi);
}

/* ------------------------------------------------------------------
   SCHOOL AMENITIES DASHBOARD
   A list panel of every room flagged in `highlightedIds`. Picking a
   room flies the camera straight to it, same as scanning its QR code.
------------------------------------------------------------------- */
const dashboardBtn = document.getElementById('dashboard-btn');
const dashboardPanel = document.getElementById('dashboard-panel');
const dashboardList = document.getElementById('dashboard-list');
const dashboardCloseBtn = document.getElementById('dashboard-close');

function buildDashboard() {
  if (!dashboardList) return;
  dashboardList.innerHTML = '';

  const rooms = highlightedIds
    .map(id => poiData3D.find(p => p.id === id))
    .filter(Boolean);

  rooms.forEach(room => {
    const item = document.createElement('button');
    item.className = 'dash-item';
    item.type = 'button';
    item.innerHTML = `
      <div class="dash-item-main">
        <span class="dash-item-name">${room.name}</span>
        <span class="dash-item-floor">Floor ${room.layer}</span>
      </div>
      <div class="dash-item-meta">
        <span class="dash-item-hours">${room.hours}</span>
        <span class="dash-item-status" style="color: ${room.status === 'Open' ? '#0B3B24' : '#B04A2F'}">${room.status}</span>
      </div>
    `;
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      if (dashboardPanel) dashboardPanel.classList.remove('active');
      isolateAndZoomToRoom(room);
    });
    dashboardList.appendChild(item);
  });
}

if (dashboardBtn && dashboardPanel) {
  buildDashboard();
  dashboardBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    dashboardPanel.classList.toggle('active');
  });
}
if (dashboardCloseBtn) {
  dashboardCloseBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (dashboardPanel) dashboardPanel.classList.remove('active');
  });
}

/* ------------------------------------------------------------------
   POINT-TO-POINT NAVIGATION
   - Every floor has the same walkable corridor network (back run + two
     wing runs). Rooms plug into it at their door, and the two staircases
     link each floor to the next.
   - Dijkstra finds the shortest path, then a glowing guide line with
     moving dots is drawn along it (and up/down the stairs).
   - UI: "Directions" button (From / To), "Directions to here" button in
     the room details sheet, and a step-by-step list.
------------------------------------------------------------------- */
const NAV_Y = 0.3;            // guide line height above each floor group's origin
const NAV_BACK_X = 8.79;      // how far the back corridor reaches (corner nooks)
const NAV_TUBE_R = 0.13;      // thickness of the guide line
const STAIR_COST = 7;         // path "cost" of climbing one floor
const ROUTE_SPEED = 3.2;      // moving-dot speed
const DOT_SPACING = 1.5;      // distance between moving dots

const roomById = {};
poiData3D.forEach(p => { roomById[p.id] = p; });

let currentDetailRoom = null;

// Same facing rules the 3D rooms use, so the door is where the glass is.
function roomRot(poi) {
  if (poi.rot !== undefined) return poi.rot;
  if (poi.x < 0 && poi.z > B.backInner) return Math.PI / 2;
  if (poi.x > 0 && poi.z > B.backInner) return -Math.PI / 2;
  return 0;
}
function doorPoint(poi) {
  const r = roomRot(poi);
  return { x: poi.x + Math.sin(r) * poi.d / 2, z: poi.z + Math.cos(r) * poi.d / 2 };
}
// Where a room's door meets the corridor
function roomAccess(poi) {
  if (poi.z > B.backInner) {
    return {
      seg: poi.x < 0 ? 'L' : 'R',
      x: poi.x < 0 ? -wingPathX : wingPathX,
      z: Math.min(Math.max(poi.z, backPathZ), B.frontEdge)
    };
  }
  return { seg: 'B', x: Math.min(Math.max(poi.x, -NAV_BACK_X), NAV_BACK_X), z: backPathZ };
}

/* ---- Walkable graph ---- */
const navNodes = {};
const navAdj = {};
(function buildNavGraph() {
  const addNode = (key, x, z, floor) => {
    navNodes[key] = { x, z, floor };
    navAdj[key] = [];
    return key;
  };
  const link = (a, b, cost) => {
    navAdj[a].push({ to: b, cost });
    navAdj[b].push({ to: a, cost });
  };
  const chain = (list, axis) => {
    list.sort((m, n) => navNodes[m][axis] - navNodes[n][axis]);
    for (let i = 1; i < list.length; i++) {
      const a = navNodes[list[i - 1]], b = navNodes[list[i]];
      link(list[i - 1], list[i], Math.hypot(a.x - b.x, a.z - b.z));
    }
  };

  for (let f = 1; f <= 4; f++) {
    const segL = [], segB = [], segR = [];

    const BL = addNode(`${f}:BL`, -wingPathX, backPathZ, f);   // back-left junction
    const BR = addNode(`${f}:BR`,  wingPathX, backPathZ, f);   // back-right junction
    segB.push(BL, BR);
    segL.push(BL);
    segR.push(BR);

    segB.push(addNode(`${f}:BACK_L`, -NAV_BACK_X, backPathZ, f));
    segB.push(addNode(`${f}:BACK_R`,  NAV_BACK_X, backPathZ, f));
    segL.push(addNode(`${f}:END_L`, -wingPathX, B.frontEdge, f));
    segR.push(addNode(`${f}:END_R`,  wingPathX, B.frontEdge, f));

    // Staircase landings (match the stairs drawn in the floor loop)
    segB.push(addNode(`${f}:ST_BACK`, 6.2, backPathZ, f));
    segL.push(addNode(`${f}:ST_LEFT`, -wingPathX, LEFT_WING_GAP_Z, f));

    poiData3D.filter(p => p.layer === f).forEach(p => {
      const a = roomAccess(p);
      const key = addNode(`${f}:room:${p.id}`, a.x, a.z, f);
      (a.seg === 'B' ? segB : a.seg === 'L' ? segL : segR).push(key);
    });

    chain(segB, 'x');
    chain(segL, 'z');
    chain(segR, 'z');
  }

  // Stairs join each floor to the one above
  for (let f = 1; f < 4; f++) {
    ['ST_BACK', 'ST_LEFT'].forEach(n => link(`${f}:${n}`, `${f + 1}:${n}`, STAIR_COST));
  }
})();

function findPath(start, end) {
  const dist = {}, prev = {}, done = {};
  Object.keys(navNodes).forEach(k => { dist[k] = Infinity; });
  dist[start] = 0;
  while (true) {
    let u = null, best = Infinity;
    for (const k in dist) {
      if (!done[k] && dist[k] < best) { best = dist[k]; u = k; }
    }
    if (u === null) return null;
    if (u === end) break;
    done[u] = true;
    navAdj[u].forEach(e => {
      const nd = best + e.cost;
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; }
    });
  }
  const path = [end];
  while (path[0] !== start) path.unshift(prev[path[0]]);
  return path;
}

/* ---- Guide line (3D) ---- */
const routeGroup = new THREE.Group();
scene.add(routeGroup);

// depthTest off + high renderOrder so the line stays visible through floor slabs
const routeLineMat  = new THREE.MeshBasicMaterial({ color: 0x1a73e8, transparent: true, opacity: 0.95, depthTest: false });
const routeDotMat   = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1,    depthTest: false });
const routeStartMat = new THREE.MeshBasicMaterial({ color: 0x1a73e8, transparent: true, opacity: 1,    depthTest: false });
const routeDestMat  = new THREE.MeshBasicMaterial({ color: 0x2e7d32, transparent: true, opacity: 1,    depthTest: false });
const jointGeo      = new THREE.SphereGeometry(NAV_TUBE_R, 10, 10);
const dotGeo        = new THREE.SphereGeometry(0.2, 12, 12);
const markerGeo     = new THREE.SphereGeometry(0.42, 16, 16);
const destConeGeo   = new THREE.ConeGeometry(0.5, 1.2, 8);

const routeState = {
  active: false, items: [], dots: [], world: [], pts: [], cum: [], total: 0,
  destCone: null, destBaseY: 0, toName: ''
};

function routeToWorld(p) {
  return new THREE.Vector3(p.x, (p.floor - 1) * spacing + NAV_Y, p.z);
}

function addRouteMesh(mesh, layers) {
  mesh.renderOrder = 999;
  routeGroup.add(mesh);
  routeState.items.push({ mesh, layers });
  return mesh;
}

function makeSegmentMesh(a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 0.01) return null;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(NAV_TUBE_R, NAV_TUBE_R, len, 8), routeLineMat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.userData.ownGeo = true;
  return mesh;
}

function clearRoute() {
  routeState.items.forEach(({ mesh }) => {
    if (mesh.userData.ownGeo) mesh.geometry.dispose();
    routeGroup.remove(mesh);
  });
  routeState.dots.forEach(d => routeGroup.remove(d.mesh));
  routeState.items = [];
  routeState.dots = [];
  routeState.world = [];
  routeState.pts = [];
  routeState.cum = [];
  routeState.total = 0;
  routeState.destCone = null;
  routeState.active = false;
  updateNavPill();
}

function drawRoute(pts, toRoom) {
  clearRoute();

  const world = pts.map(routeToWorld);
  routeState.pts = pts;
  routeState.world = world;

  const cum = [0];
  for (let i = 0; i < pts.length; i++) {
    const joint = addRouteMesh(new THREE.Mesh(jointGeo, routeLineMat), [pts[i].floor]);
    joint.position.copy(world[i]);
    if (i > 0) {
      const seg = makeSegmentMesh(world[i - 1], world[i]);
      if (seg) addRouteMesh(seg, [pts[i - 1].floor, pts[i].floor]);
      cum.push(cum[i - 1] + world[i - 1].distanceTo(world[i]));
    }
  }
  routeState.cum = cum;
  routeState.total = cum[cum.length - 1];

  // Start (blue) and destination (green) markers
  const startM = addRouteMesh(new THREE.Mesh(markerGeo, routeStartMat), [pts[0].floor]);
  startM.position.copy(world[0]);
  const endM = addRouteMesh(new THREE.Mesh(markerGeo, routeDestMat), [pts[pts.length - 1].floor]);
  endM.position.copy(world[world.length - 1]);

  // Green arrow floating over the destination room
  const coneBaseY = (toRoom.layer - 1) * spacing + 2.9;
  const cone = addRouteMesh(new THREE.Mesh(destConeGeo, routeDestMat), [toRoom.layer]);
  cone.rotation.x = Math.PI;
  cone.position.set(toRoom.x, coneBaseY, toRoom.z);
  routeState.destCone = cone;
  routeState.destBaseY = coneBaseY;

  // Moving dots that flow from start to destination
  const dotCount = Math.max(1, Math.ceil(routeState.total / DOT_SPACING));
  for (let k = 0; k < dotCount; k++) {
    const dot = new THREE.Mesh(dotGeo, routeDotMat);
    dot.renderOrder = 1000;
    routeGroup.add(dot);
    routeState.dots.push({ mesh: dot });
  }

  routeState.toName = toRoom.name;
  routeState.active = true;
  updateNavPill();
}

function updateRoute(nowSec) {
  if (!routeState.active) return;

  routeState.items.forEach(({ mesh, layers }) => {
    mesh.visible = layers.some(l => floorMeshes[l] && floorMeshes[l].visible);
  });

  const { pts, cum, world, total } = routeState;
  const flow = (nowSec * ROUTE_SPEED) % DOT_SPACING;
  routeState.dots.forEach((d, k) => {
    const s = flow + k * DOT_SPACING;
    if (s > total) { d.mesh.visible = false; return; }
    let i = 1;
    while (i < cum.length - 1 && s > cum[i]) i++;
    const segLen = (cum[i] - cum[i - 1]) || 1;
    const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / segLen));
    d.mesh.position.lerpVectors(world[i - 1], world[i], t);
    d.mesh.visible = [pts[i - 1].floor, pts[i].floor].some(l => floorMeshes[l] && floorMeshes[l].visible);
  });

  if (routeState.destCone) {
    routeState.destCone.position.y = routeState.destBaseY + Math.sin(nowSec * 3) * 0.15;
    routeState.destCone.rotation.y = nowSec * 1.5;
  }
}

/* ---- Directions text ---- */
const fmtM = (d) => `${Math.max(1, Math.round(d))} m`;
const stairLabel = (key) => key.includes('ST_BACK') ? 'back-corridor staircase' : 'left-wing staircase';

function buildSteps(keys, fromRoom, toRoom, startLeg, endLeg) {
  const steps = [`Start at ${fromRoom.name} (Floor ${fromRoom.layer}) and head out into the corridor.`];
  let walk = startLeg;
  let stairRun = null;

  const flushStairs = () => {
    if (!stairRun) return;
    steps.push(`Take the ${stairRun.name} ${stairRun.to > stairRun.from ? 'up' : 'down'} to Floor ${stairRun.to}.`);
    stairRun = null;
  };

  for (let i = 1; i < keys.length; i++) {
    const a = navNodes[keys[i - 1]], b = navNodes[keys[i]];
    if (a.floor !== b.floor) {
      if (!stairRun) {
        if (walk > 0.5) steps.push(`Walk about ${fmtM(walk)} to the ${stairLabel(keys[i - 1])}.`);
        walk = 0;
        stairRun = { name: stairLabel(keys[i - 1]), from: a.floor, to: b.floor };
      } else {
        stairRun.to = b.floor;
      }
    } else {
      flushStairs();
      walk += Math.hypot(a.x - b.x, a.z - b.z);
    }
  }
  flushStairs();

  walk += endLeg;
  steps.push(`Walk about ${fmtM(walk)} to ${toRoom.name}.`);
  steps.push(`You've arrived at ${toRoom.name} (Floor ${toRoom.layer}).`);
  return steps;
}

/* ---- Directions UI (built here so index.html needs no changes) ---- */
const navStyle = document.createElement('style');
navStyle.textContent = `
  #nav-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    width: 100%; margin-top: 8px; padding: 9px 10px;
    background: var(--paper); color: var(--canopy);
    border: 1px solid var(--canopy); border-radius: 4px;
    font-family: 'Inter', sans-serif; font-weight: 500; font-size: 0.8rem;
    cursor: pointer; pointer-events: auto; touch-action: manipulation;
  }
  #nav-btn:active { background: #eee9d9; }
  #nav-btn:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }

  #nav-panel {
    position: absolute; left: 0; right: 0; bottom: -100%;
    width: 100%; max-width: 480px; margin: 0 auto;
    max-height: min(55vh, 440px);
    background: var(--paper); border: 1px solid var(--line); border-bottom: none;
    border-radius: 18px 18px 0 0; z-index: 18;
    padding: 14px 22px calc(18px + env(safe-area-inset-bottom, 0px));
    padding-left: calc(22px + env(safe-area-inset-left, 0px));
    padding-right: calc(22px + env(safe-area-inset-right, 0px));
    box-sizing: border-box; box-shadow: 0 -8px 28px rgba(11, 59, 36, 0.18);
    transition: bottom 0.3s ease;
    overflow-y: auto; -webkit-overflow-scrolling: touch; touch-action: pan-y;
    -webkit-user-select: text; user-select: text;
  }
  #nav-panel.active { bottom: 0; }
  .nav-handle { width: 36px; height: 4px; border-radius: 2px; background: var(--line); margin: 0 auto 12px; }
  .nav-header { position: relative; padding-right: 34px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
  .nav-title { margin: 0; font-family: 'Fraunces', serif; font-weight: 600; font-size: 1.1rem; color: var(--canopy); }
  #nav-close {
    position: absolute; top: -4px; right: -6px; width: 32px; height: 32px;
    border: none; background: transparent; color: var(--ink-soft); font-size: 1.1rem;
    border-radius: 50%; cursor: pointer; touch-action: manipulation;
    display: flex; align-items: center; justify-content: center;
  }
  #nav-close:active { background: var(--line); color: var(--ink); }
  .nav-field { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; font-size: 0.7rem; color: var(--brass); }
  .nav-field select {
    width: 100%; padding: 9px 10px; font-family: 'Inter', sans-serif; font-size: 16px;
    border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--ink);
  }
  .nav-swap-row { display: flex; justify-content: center; margin-top: 8px; }
  #nav-swap {
    border: 1px solid var(--line); background: #fff; color: var(--canopy);
    border-radius: 14px; padding: 3px 14px; font-size: 0.9rem; cursor: pointer; touch-action: manipulation;
  }
  .nav-actions { display: flex; gap: 8px; margin-top: 12px; }
  .nav-actions button {
    flex: 1; padding: 11px 10px; border-radius: 4px; cursor: pointer; touch-action: manipulation;
    font-family: 'Inter', sans-serif; font-weight: 500; font-size: 0.85rem;
  }
  #nav-go { background: var(--canopy); color: var(--paper); border: none; }
  #nav-go:active { background: var(--canopy-dark); }
  #nav-clear { background: transparent; color: var(--ink-soft); border: 1px solid var(--line); flex: 0 0 90px; }
  #nav-summary { margin-top: 12px; font-size: 0.82rem; color: var(--ink-soft); line-height: 1.4; }
  #nav-summary strong { color: var(--canopy); }
  #nav-steps { list-style: none; margin: 10px 0 0; padding: 0; counter-reset: navstep; }
  #nav-steps li {
    counter-increment: navstep; position: relative; padding: 9px 0 9px 30px;
    border-top: 1px solid var(--line); font-size: 0.84rem; line-height: 1.45; color: var(--ink);
  }
  #nav-steps li::before {
    content: counter(navstep); position: absolute; left: 0; top: 9px; width: 20px; height: 20px;
    border-radius: 50%; background: var(--canopy); color: var(--paper); font-size: 0.7rem;
    display: flex; align-items: center; justify-content: center;
  }
  #nav-steps li.arrive::before { background: #2e7d32; }

  #info-dir-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    width: 100%; margin-top: 14px; padding: 11px 10px;
    background: var(--canopy); color: var(--paper); border: none; border-radius: 4px;
    font-family: 'Inter', sans-serif; font-weight: 500; font-size: 0.85rem;
    cursor: pointer; touch-action: manipulation;
  }
  #info-dir-btn:active { background: var(--canopy-dark); }

  #nav-pill {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    max-width: calc(100vw - 32px); padding: 10px 18px; border-radius: 22px; border: none;
    background: var(--canopy); color: var(--paper); z-index: 16; display: none;
    font-family: 'Inter', sans-serif; font-weight: 500; font-size: 0.82rem;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3); cursor: pointer; touch-action: manipulation;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
`;
document.head.appendChild(navStyle);

// Directions button under "School Amenities"
const uiContainer = document.getElementById('ui-container');
const navBtn = document.createElement('button');
navBtn.id = 'nav-btn';
navBtn.type = 'button';
navBtn.textContent = '\u27A4 Directions';
if (uiContainer) uiContainer.appendChild(navBtn);

// Directions sheet
const navPanel = document.createElement('div');
navPanel.id = 'nav-panel';
navPanel.innerHTML = `
  <div class="nav-handle"></div>
  <div class="nav-header">
    <button id="nav-close" type="button" aria-label="Close directions">\u2715</button>
    <h2 class="nav-title">Directions</h2>
  </div>
  <label class="nav-field">From<select id="nav-from"></select></label>
  <div class="nav-swap-row"><button id="nav-swap" type="button" aria-label="Swap start and destination">\u21C5</button></div>
  <label class="nav-field" style="margin-top:6px">To<select id="nav-to"></select></label>
  <div class="nav-actions">
    <button id="nav-go" type="button">Show route</button>
    <button id="nav-clear" type="button">Clear</button>
  </div>
  <div id="nav-summary"></div>
  <ol id="nav-steps"></ol>
`;
document.body.appendChild(navPanel);

// Floating "route active" chip, shown while the sheet is closed
const navPill = document.createElement('button');
navPill.id = 'nav-pill';
navPill.type = 'button';
document.body.appendChild(navPill);

const navFromSel = document.getElementById('nav-from');
const navToSel = document.getElementById('nav-to');
const navSummary = document.getElementById('nav-summary');
const navSteps = document.getElementById('nav-steps');

// Room labels (unique per floor) for the dropdowns
const navLabel = {};
(function buildNavLabels() {
  const counts = {}, seen = {};
  poiData3D.forEach(p => { const k = `${p.layer}|${p.name}`; counts[k] = (counts[k] || 0) + 1; });
  poiData3D.forEach(p => {
    const k = `${p.layer}|${p.name}`;
    seen[k] = (seen[k] || 0) + 1;
    navLabel[p.id] = counts[k] > 1 ? `${p.name} (${String.fromCharCode(64 + seen[k])})` : p.name;
  });
})();

const navDefaultFrom = currentSpot.targetId;

function fillNavSelect(sel, placeholder) {
  sel.innerHTML = '';
  if (placeholder) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = placeholder;
    sel.appendChild(o);
  }
  for (let f = 1; f <= 4; f++) {
    const group = document.createElement('optgroup');
    group.label = `Floor ${f}`;
    poiData3D
      .filter(p => p.layer === f)
      .sort((a, b) => navLabel[a.id].localeCompare(navLabel[b.id], undefined, { numeric: true }))
      .forEach(p => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = navLabel[p.id] + (p.id === navDefaultFrom ? ' \u2022 You are here' : '');
        group.appendChild(o);
      });
    sel.appendChild(group);
  }
}
fillNavSelect(navFromSel, null);
fillNavSelect(navToSel, 'Choose destination\u2026');
navFromSel.value = navDefaultFrom;

function setNavMessage(html) {
  navSummary.innerHTML = html;
  navSteps.innerHTML = '';
}

function updateNavPill() {
  if (!navPill) return;
  const show = routeState.active && !navPanel.classList.contains('active');
  navPill.style.display = show ? 'block' : 'none';
  if (show) navPill.textContent = `\u27A4 Route to ${routeState.toName} \u2022 tap for steps`;
}

function openNavPanel() {
  if (infoPanel) infoPanel.classList.remove('active');
  if (dashboardPanel) dashboardPanel.classList.remove('active');
  navPanel.classList.add('active');
  updateNavPill();
}
function closeNavPanel() {
  navPanel.classList.remove('active');
  updateNavPill();
}

function requestRoute() {
  const fromId = navFromSel.value;
  const toId = navToSel.value;
  if (!toId) { setNavMessage('Choose a destination first.'); return; }
  if (fromId === toId) { setNavMessage('You\u2019re already there \u2014 pick a different start or destination.'); return; }

  const from = roomById[fromId], to = roomById[toId];
  const keys = findPath(`${from.layer}:room:${fromId}`, `${to.layer}:room:${toId}`);
  if (!keys) { setNavMessage('No walkable route was found between these two places.'); return; }

  // Door-to-corridor legs at each end
  const startDoor = doorPoint(from), endDoor = doorPoint(to);
  const first = navNodes[keys[0]], last = navNodes[keys[keys.length - 1]];
  const startLeg = Math.hypot(startDoor.x - first.x, startDoor.z - first.z);
  const endLeg = Math.hypot(endDoor.x - last.x, endDoor.z - last.z);

  // Polyline for the guide line
  const pts = [];
  const push = (x, z, floor) => {
    const p = pts[pts.length - 1];
    if (p && p.floor === floor && Math.hypot(p.x - x, p.z - z) < 0.01) return;
    pts.push({ x, z, floor });
  };
  push(startDoor.x, startDoor.z, from.layer);
  keys.forEach(k => push(navNodes[k].x, navNodes[k].z, navNodes[k].floor));
  push(endDoor.x, endDoor.z, to.layer);

  // Total walking distance (flat parts only)
  let flat = startLeg + endLeg;
  for (let i = 1; i < keys.length; i++) {
    const a = navNodes[keys[i - 1]], b = navNodes[keys[i]];
    if (a.floor === b.floor) flat += Math.hypot(a.x - b.x, a.z - b.z);
  }

  drawRoute(pts, to);

  const where = from.layer === to.layer ? `Same floor (Floor ${from.layer})` : `Floor ${from.layer} \u2192 Floor ${to.layer}`;
  navSummary.innerHTML = `<strong>${where}</strong> \u2022 about ${fmtM(flat)} of walking (approx.)`;
  navSteps.innerHTML = '';
  buildSteps(keys, from, to, startLeg, endLeg).forEach((text, i, arr) => {
    const li = document.createElement('li');
    li.textContent = text;
    if (i === arr.length - 1) li.className = 'arrive';
    navSteps.appendChild(li);
  });

  // Frame the route: one floor -> isolate it; several -> show the whole building
  const floorsUsed = new Set(pts.map(p => p.floor));
  if (floorsUsed.size === 1) {
    const f = [...floorsUsed][0];
    isolateAndZoomFloor(f, (f - 1) * spacing);
  } else {
    isolateAndZoomFloor('all', 0);
  }
}

navBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  if (navPanel.classList.contains('active')) closeNavPanel(); else openNavPanel();
});
document.getElementById('nav-close').addEventListener('click', (e) => { e.stopPropagation(); closeNavPanel(); });
document.getElementById('nav-go').addEventListener('click', (e) => { e.stopPropagation(); requestRoute(); });
document.getElementById('nav-clear').addEventListener('click', (e) => {
  e.stopPropagation();
  clearRoute();
  navSummary.innerHTML = '';
  navSteps.innerHTML = '';
  navToSel.value = '';
});
document.getElementById('nav-swap').addEventListener('click', (e) => {
  e.stopPropagation();
  const f = navFromSel.value, t = navToSel.value;
  if (!t) return;
  navFromSel.value = t;
  navToSel.value = f;
});
navPill.addEventListener('click', (e) => { e.stopPropagation(); openNavPanel(); });
if (dashboardBtn) dashboardBtn.addEventListener('click', () => closeNavPanel());

// "Directions to here" inside the room details sheet
const infoDirBtn = document.createElement('button');
infoDirBtn.id = 'info-dir-btn';
infoDirBtn.type = 'button';
infoDirBtn.textContent = '\u27A4 Directions to here';
const roomMetaEl = infoPanel ? infoPanel.querySelector('.room-meta') : null;
if (roomMetaEl && roomMetaEl.parentElement) roomMetaEl.parentElement.appendChild(infoDirBtn);
infoDirBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentDetailRoom) return;
  navToSel.value = currentDetailRoom.id;
  openNavPanel();
  requestRoute();
});

function animate() {
  requestAnimationFrame(animate);

  if (isTransitioning) {
    camera.position.lerp(targetCamPos, 0.05);
    controls.target.lerp(targetLookAt, 0.05);
    if (camera.position.distanceTo(targetCamPos) < 0.05 && controls.target.distanceTo(targetLookAt) < 0.05) {
      isTransitioning = false;
    }
  }

  if (userPin && userPin.visible) userPin.rotation.y += 0.03;
  updateRoute(performance.now() / 1000);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// Debounced resize handler for mobile address-bar animations.
let resizeTimeout = null;
function handleResize() {
  const { w, h } = getViewportSize();
  const aspect = w / h;

  camera.fov = getResponsiveFovDeg(aspect);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
}
window.addEventListener('resize', () => {
  if (resizeTimeout) clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(handleResize, 100);
});
window.addEventListener('orientationchange', () => {
  setTimeout(handleResize, 100);
  setTimeout(handleResize, 400);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(handleResize, 100);
  });
}
