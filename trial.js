import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ------------------------------------------------------------------
   MOBILE COMPATIBILITY (Android + iOS)
   ------------------------------------------------------------------
   Mobile browsers resize the viewport as address bars/nav bars show
   and hide, and iOS Safari intercepts two-finger pinches as a page
   zoom gesture before Three.js ever sees them. These handlers fix
   both, plus a couple of small touch-quality issues.
------------------------------------------------------------------- */

// Keep a CSS custom property in sync with the *real* visible height,
// instead of relying on 100vh/100%, which lags behind on iOS Safari
// and Android Chrome whenever their address bar shows/hides.
function syncAppHeight() {
  const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${h}px`);
}
syncAppHeight();
window.addEventListener('resize', syncAppHeight);
window.addEventListener('orientationchange', () => {
  // iOS reports the old innerHeight for a moment after rotation.
  setTimeout(syncAppHeight, 50);
  setTimeout(syncAppHeight, 300);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncAppHeight);
}

// Stop iOS Safari's native pinch-to-zoom / double-tap-to-zoom gestures
// so they don't fight with OrbitControls' own pinch-to-dolly handling.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('gestureend', (e) => e.preventDefault());

let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 350) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

// Belt-and-braces: block multi-touch page gestures anywhere outside the
// scrollable info panel (touch-action: none in CSS already covers most
// of this, but some Android WebViews need the JS fallback too).
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

// Room slot positions adjusted to avoid the 3-unit corner bevels (flat run is x -8..8)
// and to leave clearance for the staircase.
// Every floor plan has 8 back-corridor rooms: 6 sit flat along the back wall,
// and 2 are angled 45° to sit flush in the triangular bevel nooks at each end.
const BACK_SLOT_Z = -6.2;
const CORNER_Z = -5.29;              // inset from the diagonal wall by half its depth
const CORNER_W = 2.2, CORNER_D = 2.0; // corner rooms, angled to match the bevel
const BACK_W = 1.6, BACK_D = 2.0;     // flat rooms along the straight back wall
const BIG_W = 3.3;                    // wider corridor rooms (Layer 4), smaller than a full wing room (WING_W)
const MED_W = 2.6;                    // shrunk version of BIG_W, used when an extra room needs to fit alongside
const SMALL_W = 1.25;                 // shrunk rooms used when an extra room needs to fit in the same touching row

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
// but any room may override x/z/w/d/rot directly (used on Layer 4 below
// to make the last two corridor rooms as big as the wing rooms). Wing
// rooms follow the same pattern against WING_SLOTS (used on Layer 3 below
// to split the right wing into 3 narrower rooms instead of the usual 2).
const floorPlans = {
  1: {
    wings: [
      { id: 'l1_wing_left_a',  name: 'Faculty Room A', desc: 'Faculty desks and consultation space near the lobby.', hours: '8:00 AM - 5:00 PM', status: 'Open' },
      { id: 'l1_wing_left_b',  name: 'Faculty Room B', desc: 'Additional faculty desks opening onto the courtyard.', hours: '8:00 AM - 5:00 PM', status: 'Open' },
      { id: 'l1_wing_right_a', name: 'CAS', desc: 'cas department.', hours: '8:00 AM - 4:30 PM', status: 'Open' },
      { id: 'l1_wing_right_b', name: 'CAS', desc: 'cas department.', hours: '8:00 AM - 4:30 PM', status: 'Open' }
    ],
    corridor: [
      { id: 'l1_lobby',       name: 'Main Lobby & Security', desc: 'Main entrance, guard post, and visitor logbook.', hours: '6:00 AM - 9:00 PM', status: 'Open' },
      { id: 'l1_admin_clinic_chapel', name: 'Business center, Teacher lounge', desc: 'none', hours: '6:00 AM - 8:00 PM', status: 'Open',
        // Centred at -5.35 + BIG_W/2 = -3.7, matching Layer 2's Lecture Hall
        // 103 + 104 combined footprint (-7.0 .. -0.4) directly below it.
        // windows: [1, 1.2, 1.2] gives Admin the baseline window size, and
        // both Clinic's window and the Chapel/Kiosks window slightly larger.
        x: -5.35 + BIG_W / 2, z: BACK_SLOT_Z, w: BIG_W * 2, d: BACK_D, windows: [1, 1.2, 1.2] },
      { id: 'l1_cafeteria_annex', name: 'Cafeteria/Student lounge', desc: 'none', hours: '7:00 AM - 5:00 PM', status: 'Open',
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
      { id: 'l2_library',      name: 'Library Lower Floor', desc: 'Book stacks, quiet reading, and the circulation desk.', hours: '8:00 AM - 6:00 PM', status: 'Open' },
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
      // Right wing is split into 3 rooms instead of the usual 2 - each is
      // narrower (w) than WING_W so all three fit in the same wing length,
      // with x/z/w/d given explicitly instead of pulling from WING_SLOTS.
      { id: 'l3_wing_right_a', name: 'ROOM 307', desc: 'Seating and charging stations overlooking the courtyard.', hours: '24/7 Access', status: 'Open',
        x: 8.6, z: -1.85, w: 3.3, d: WING_D },
      { id: 'l3_wing_right_b', name: 'ROOM 308', desc: 'Bookable pods for small-group work sessions.', hours: '24/7 Access', status: 'Open',
        x: 8.6, z:  1.6,  w: 3.3, d: WING_D },
      { id: 'l3_wing_right_c', name: 'ROOM 309', desc: 'Quieter lounge with study booths.', hours: '24/7 Access', status: 'Open',
        x: 8.6, z:  5.05, w: 3.3, d: WING_D }
    ],
    corridor: [
      { id: 'l3_libupper',    name: 'Library Upper Floor', desc: 'Book stacks, quiet reading, and the circulation desk.', hours: '8:00 AM - 5:00 PM', status: 'Open' },
      { id: 'l3_comlab2',     name: 'ROOM 304', desc: 'General-use lab, printing station, and video/audio editing suites.', hours: '8:00 AM - 6:00 PM', status: 'Open',
        x: -5.35, z: BACK_SLOT_Z, w: BIG_W, d: BACK_D },
      { id: 'l3_facultyb',    name: 'ROOM 305', desc: 'IT faculty offices with an adjoining group work room.', hours: '8:00 AM - 5:00 PM', status: 'Open',
        x: -5.35 + BIG_W, z: BACK_SLOT_Z, w: BIG_W, d: BACK_D },
      { id: 'l3_restroom_f',  name: 'Restroom (Women/Men)', desc: 'Located at the end of the corridor.', hours: 'Always Open', status: 'Open',
        x: 0.6, z: BACK_SLOT_Z, rot: 0, w: BACK_W, d: BACK_D },
      { id: 'l3_comlab3',     name: 'ROOM 306', desc: 'Overflow lab for programming classes.', hours: '8:00 AM - 6:00 PM', status: 'Open',
        // Moved to sit immediately next to the restroom (0.6), using the same
        // 1.86 centre-to-centre spacing as the other back-corridor slots.
        x: 0.6 + 1.86, z: BACK_SLOT_Z, rot: 0, w: BACK_W, d: BACK_D },
      { id: 'l3_electronics', name: 'Student lounge1', desc: 'Benches and equipment for hardware and circuits work.', hours: '8:00 AM - 5:00 PM', status: 'Open',
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
    // Room 1 (the lounge) sits in the same corner-nook slot as Layer 3's
    // library, so the two line up vertically.
    //
    // The Creative Arts Studio and Student Council Headquarters have been
    // merged into a single room, sized (2 x BIG_W = 6.6 units) and
    // positioned so it lines up directly above Layer 2's Lecture Hall
    // 103 + 104 footprint (x: -5.35 .. -5.35 + 2*BIG_W, centre -3.7).
    // The remaining rooms (restroom, storage, alumni office, print center)
    // are shifted right and narrowed slightly (using SMALL_W) so they still
    // fit in the space left before the right-hand bevel.
    corridor: [
      { id: 'l4_lounge',    name: 'ROOM 403', desc: 'Games, seating, and campus views.', hours: '8:00 AM - 5:00 PM', status: 'Open',
        x: -8.79, z: CORNER_Z, rot: Math.PI / 4, w: CORNER_W, d: CORNER_D },
      { id: 'l4_studio_council', name: 'ROOM 404/ROOM 405', desc: 'Joint space combining the open art/design studio with the student council office and meeting area.', hours: '8:00 AM - 6:00 PM', status: 'Open',
        // Centred at -5.35 + BIG_W/2 = -3.7, matching the midpoint of Layer 2's
        // Lecture Hall 103 (-5.35) + 104 (-5.35 + BIG_W) footprint exactly.
        x: -5.35 + BIG_W / 2, z: BACK_SLOT_Z, w: BIG_W * 2, d: BACK_D, windows: 2 },
      { id: 'l4_restroom_f', name: 'Restroom (Women/Men)', desc: 'Located along the top-floor corridor.', hours: 'Always Open', status: 'Open',
        x:  0.6, z: BACK_SLOT_Z, w: BACK_W, d: BACK_D },
      { id: 'l4_storage_alumni', name: 'ROOM 406/ROOM 407', desc: 'COMLAB 1 and COMLAB 2.', hours: '8:00 AM - 5:00 PM (storage side restricted)', status: 'Open',
        // Occupies the same combined footprint the two separate rooms used
        // to share (1.6 .. 4.3), so nothing else in the row had to move.
        x:  2.95, z: BACK_SLOT_Z, w: 2.7, d: BACK_D, windows: 2 },
      { id: 'l4_printroom', name: 'Student Lounge2', desc: 'Games, seating, and campus views.  ', hours: '8:00 AM - 5:00 PM', status: 'Open',
        // Shrunk from BACK_W to SMALL_W, kept centred in the same spot.
        x:  5.3, z: BACK_SLOT_Z, w: SMALL_W, d: BACK_D }
    ]

  }
};

// Flatten the floor plans into positioned POIs
const ROOM_COLOR = 0xf3f1e7;
const poiData3D = [];
Object.keys(floorPlans).forEach(key => {
  const layer = parseInt(key);
  const plan = floorPlans[layer];

  plan.wings.forEach((room, i) => {
    // Fall back to the matching WING_SLOTS entry for any field the room
    // doesn't specify itself, so most wings can stay slot-driven while a
    // few (e.g. Layer 3's split right wing) can override x/z/w/d directly.
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
    // Fall back to the matching BACK_SLOTS entry for any field the room
    // doesn't specify itself, so most rooms can stay slot-driven while a
    // few (e.g. Layer 4's rooms) can override x/z/w/d/rot.
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

// Use the visualViewport size when available (more reliable than
// window.innerWidth/Height on mobile, especially mid-gesture on iOS).
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
// Cap pixel ratio at 2 to keep frame rate reasonable on high-DPI Android
// and iPhone screens (Retina/3x panels would otherwise triple the pixel
// count for very little visible benefit).
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

// Explicit touch gesture mapping: one finger orbits, two fingers
// pinch-to-dolly + pan. Spelling this out avoids relying on Three.js
// defaults, which is what actually needs to match the "pinch to zoom"
// instruction shown in the onboarding card.
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
// Slightly gentler zoom step so pinch-to-zoom doesn't feel twitchy on
// small phone screens.
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

// The notch between the two left-wing rooms (Faculty Room A / B slots), used to
// place a second staircase there on every floor.
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

  // Second staircase, tucked in the notch between Faculty Room A and Faculty
  // Room B (the left-wing rooms), sitting right in the walking path, present
  // on every layer.
  if (i < 4) {
    const wingStair = makeStaircase(5, 0.6);
    wingStair.position.set(-wingPathX, 1, LEFT_WING_GAP_Z);
    floorGroup.add(wingStair);
  }

  // List of room IDs you want to highlight
  const highlightedIds = [
    'l1_cafeteria_annex',               // Cafeteria/Student lounge
    'l2_library', 'l3_libupper',        // Library Lower Floor, Library Upper Floor
    'l3_electronics', 'l4_printroom'    // Student Lounge 1, Student Lounge 2
  ];

  // Rooms loop for current floor
  poiData3D.filter(p => p.layer === i).forEach(poi => {
    const isTargetRoom = (poi.id === currentSpot.targetId);
    const isHighlighted = highlightedIds.includes(poi.id);

    const roomGroup = new THREE.Group();
    roomGroup.position.set(poi.x, 0.75, poi.z);

    // Wing rooms face the courtyard; back-corridor rooms use their assigned angle
    // (0 for the flat run, ±45° for the two rooms angled into the bevel nooks)
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

    // Glazing on the courtyard-facing side. `windows` can be:
    //   - a number N: N equal-width panes with mullion gaps between them
    //     (the wing rooms, plus most wide merged corridor rooms use this)
    //   - an array of relative weights, e.g. [1, 1, 2]: panes sized
    //     proportionally to those weights instead of evenly — used when a
    //     merged room's sub-spaces aren't the same width (Admin and Clinic
    //     each get their own window, while the wider merged Chapel/Kiosks
    //     portion gets one single, wider window instead of being split).
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

    // If this session came from a scanned QR code (cp param resolved to an
    // actual room), fly straight into that room's floor instead of sitting
    // on the all-floors overview - this is the "scan -> auto zoom" moment.
    if (spotRoom) {
      isolateAndZoomToRoom(spotRoom);
    } else {
      activeIsolatedLayer = 'all';
      Object.keys(floorMeshes).forEach(key => { floorMeshes[key].visible = true; });

      if (userPin) userPin.visible = true;
      if (layerDisplay) layerDisplay.innerHTML = '🏢 Viewing: All Floors';

      targetCamPos.copy(wideCamPos);
      targetLookAt.copy(wideTarget);
      isTransitioning = true;
    }
  });
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
  // A slightly larger drag threshold than a mouse would need, since a
  // finger naturally wobbles a few extra pixels during a tap on touchscreens.
  if (moved > 12) return;

  if (!overlay || event.target.closest('#info-panel') || event.target.closest('#ui-container') || !overlay.classList.contains('hidden')) return;

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
    if (infoPanel) infoPanel.classList.remove('active');
  });
}

function showRoomDetails(room) {
  const rn = document.getElementById('room-name');
  const rlt = document.getElementById('room-layer-tag');
  const rd = document.getElementById('room-desc');
  const rh = document.getElementById('room-hours');
  const rs = document.getElementById('room-status');

  if (rn) rn.innerText = room.name;
  if (rlt) rlt.innerText = `Floor Layer ${room.layer}`;
  if (rd) rd.innerText = room.desc;
  if (rh) rh.innerText = room.hours;
  if (rs) {
    rs.innerText = room.status;
    rs.style.color = (room.status === 'Open') ? '#0B3B24' : '#B04A2F';
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

  if (selectedLayer === 'all') {
    targetCamPos.copy(wideCamPos);
    targetLookAt.copy(wideTarget);
  } else {
    targetLookAt.set(0, floorY + 0.5, 0.5);
    targetCamPos.set(0, floorY + 14, 20);
  }
  isTransitioning = true;
}

// Zooms straight into the specific room a scanned QR checkpoint points to:
// isolates that room's floor layer (like isolateAndZoomFloor), but frames
// the camera tight on the room's own x/z instead of the whole floor centre,
// highlights the pin, and pops the info panel open automatically.
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

  // Close, angled framing on just this room rather than the whole floor.
  targetLookAt.set(poi.x, floorY + 0.5, poi.z);
  targetCamPos.set(poi.x + 6, floorY + 7, poi.z + 8);
  isTransitioning = true;

  showRoomDetails(poi);
}

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
  controls.update();
  renderer.render(scene, camera);
}
animate();

// Debounced resize handler: mobile browsers fire resize repeatedly while
// the address bar animates in/out, so this avoids doing a full relayout
// every single frame of that animation.
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
  // Give the browser chrome time to settle before reading the new size.
  setTimeout(handleResize, 100);
  setTimeout(handleResize, 400);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(handleResize, 100);
  });
}
