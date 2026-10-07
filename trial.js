/* ==================================================================
   PHINMA AU South - 3D Interactive Campus Map  (trial.js)
   ------------------------------------------------------------------
   TABLE OF CONTENTS
    1. Imports
    2. Mobile fixes (screen height, block browser zoom)
    3. Building layout constants (sizes + positions)
    4. Room data (checkpoints, floorPlans, highlightedIds)
    5. Flatten room data into one list (poiData3D)
    6. Read the scanned QR checkpoint from the URL
    7. Scene, camera, renderer, controls
    8. Lights and ground
    9. Building shapes (U-shaped slab, corridor strips)
   10. Staircases (3D meshes + guide-line shapes)
   11. Build the 4 floors and their rooms
   12. "You are here" pin + welcome overlay button
   13. Exit-zoom (×) button
   14. Tap detection (raycasting)
   15. Photo lightbox
   16. Room details panel
   17. Camera fly-to functions
   18. School Amenities dashboard
   19. Point-to-point navigation (graph, Dijkstra, guide line, UI)
   20. Animation loop
   21. Window resize handling
=================================================================== */


/* ------------------------------------------------------------------
   1. IMPORTS
   'three' and 'three/addons/' are mapped to a CDN in index.html's
   <script type="importmap">, so these short names work in the browser.
------------------------------------------------------------------- */
import * as THREE from 'three';                                   // the 3D engine
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // drag-to-rotate / pinch-to-zoom camera


/* ------------------------------------------------------------------
   2. MOBILE COMPATIBILITY (Android + iOS)
------------------------------------------------------------------- */

// Phone browsers have address bars that grow/shrink, so "100vh" is unreliable.
// This copies the REAL visible height into the CSS variable --app-height,
// which index.html uses for html/body height.
function syncAppHeight() {
  const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${h}px`);
}
syncAppHeight();                                   // run once at start
window.addEventListener('resize', syncAppHeight);  // and whenever the window changes
window.addEventListener('orientationchange', () => {
  // Rotation settles a moment later, so re-check twice
  setTimeout(syncAppHeight, 50);
  setTimeout(syncAppHeight, 300);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncAppHeight);
}

// iOS Safari has its own pinch-zoom gestures. We cancel them because
// OrbitControls handles pinch-zoom inside the 3D scene instead.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('gestureend', (e) => e.preventDefault());

// Block "double-tap to zoom": if two taps happen within 350 ms, cancel the second.
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 350) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });  // passive:false is required, otherwise preventDefault() is ignored

// Block multi-finger page gestures everywhere EXCEPT inside the scrollable info panel
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1 && !e.target.closest('#info-panel')) {
    e.preventDefault();
  }
}, { passive: false });


/* ------------------------------------------------------------------
   3. BUILDING LAYOUT CONSTANTS
   The building is a "U" seen from above. X = left/right, Z = back/front.
   Negative Z is the back of the building, positive Z is the front.
------------------------------------------------------------------- */

// Outline of the U-shaped footprint
const B = {
  outerLeft:  -11,    // far left edge of the building
  outerRight:  11,    // far right edge
  backOuter:  -7.5,   // rear edge of the back bar
  backInner:  -3.5,   // where the courtyard (open middle of the U) starts
  wingInnerL: -4.5,   // inner face of the left wing (faces the courtyard)
  wingInnerR:  4.5,   // inner face of the right wing
  frontEdge:   7      // where both wings end at the front
};

// Corridor (walkway) that runs in front of every room, tracing the U
const PATH_W = 1.8;    // corridor width
const PATH_Y = 0.17;   // height of the corridor strip (just above the slab top at 0.15)

// Every floor has 8 back-corridor "slots": 6 flat along the back wall,
// and 2 angled 45° to fit in the diagonal (beveled) corners.
const BACK_SLOT_Z = -6.2;               // Z position of rooms along the straight back wall
const CORNER_Z = -5.29;                 // Z of the corner rooms (inset from the diagonal wall)
const CORNER_W = 2.2, CORNER_D = 2.0;   // corner room width / depth
const BACK_W = 1.6, BACK_D = 2.0;       // normal back room width / depth
const BIG_W = 3.3;                      // wide corridor room (used on layers 2-4)
const MED_W = 2.6;                      // medium version (currently unused)
const SMALL_W = 1.25;                   // small room, used when an extra room must fit

// Default positions for back-corridor rooms. Rooms in floorPlans.corridor
// take these BY INDEX (1st corridor room -> 1st slot, and so on)
// unless the room gives its own x/z/w/d/rot.
const BACK_SLOTS = [
  { x: -8.79, z: CORNER_Z,     rot:  Math.PI / 4, w: CORNER_W, d: CORNER_D }, // left bevel corner (angled 45°)
  { x: -6.20, z: BACK_SLOT_Z,  rot:  0,           w: BACK_W,   d: BACK_D },
  { x: -4.34, z: BACK_SLOT_Z,  rot:  0,           w: BACK_W,   d: BACK_D },
  { x: -2.48, z: BACK_SLOT_Z,  rot:  0,           w: BACK_W,   d: BACK_D },
  { x: -0.62, z: BACK_SLOT_Z,  rot:  0,           w: BACK_W,   d: BACK_D },
  { x:  1.24, z: BACK_SLOT_Z,  rot:  0,           w: BACK_W,   d: BACK_D },
  { x:  3.10, z: BACK_SLOT_Z,  rot:  0,           w: BACK_W,   d: BACK_D },
  { x:  8.79, z: CORNER_Z,     rot: -Math.PI / 4, w: CORNER_W, d: CORNER_D }  // right bevel corner
];

// Default positions for the 4 wing rooms (same index rule as above)
const WING_SLOTS = [
  { x: -8.6, z: -1.0 }, { x: -8.6, z: 4.15 },   // left wing: front then back
  { x:  8.6, z: -1.0 }, { x:  8.6, z: 4.15 }    // right wing: front then back
];
const WING_W = 5.0, WING_D = 4.0;   // w runs ALONG the wing, d runs ACROSS it


/* ------------------------------------------------------------------
   4. ROOM DATA  (edit this section to change room info)
------------------------------------------------------------------- */

// QR code checkpoints. A URL like  index.html?cp=CAFETERIA  makes the
// map start at that spot. targetId must match a room `id` below.
const checkpoints = {
  'L1_ENTRANCE':      { name: 'Main Lobby & Security',      layer: 1, targetId: 'l1_lobby' },
  'CAFETERIA':        { name: 'Cafeteria/Student lounge',   layer: 1, targetId: 'l1_cafeteria_annex' },
  'LIBRARY_LOWER':    { name: 'Library Lower Floor',        layer: 2, targetId: 'l2_library' },
  'LIBRARY_UPPER':    { name: 'Library Upper Floor',        layer: 3, targetId: 'l3_libupper' },
  'STUDENT_LOUNGE_1': { name: 'Student Lounge 1',           layer: 3, targetId: 'l3_electronics' },
  'STUDENT_LOUNGE_2': { name: 'Student Lounge 2',           layer: 4, targetId: 'l4_printroom' }
};

// Floor plans: for each floor, 4 `wings` rooms (in WING_SLOTS order)
// plus `corridor` rooms (in BACK_SLOTS order).
//
// Each room can have:
//   id, name, desc, hours, status     -> info shown in the details panel
//   x, z, w, d, rot                   -> optional position/size/rotation override
//   windows                           -> number of glass panes, or an array of
//                                        relative widths e.g. [1, 1.2, 1.2]
//   images: ['images/a.jpg', ...]     -> photos (paths relative to index.html).
//                                        1 image = full width, 2 = side by side.
const floorPlans = {
  1: {
    wings: [
      { id: 'l1_wing_left_a',  name: 'Faculty Room A', desc: 'Faculty desks and consultation space near the lobby.', hours: '8:00 AM - 5:00 PM', status: 'Open' },
      { id: 'l1_wing_left_b',  name: 'Faculty Room B', desc: 'Additional faculty desks opening onto the courtyard.', hours: '8:00 AM - 5:00 PM', status: 'Open' },
      { id: 'l1_wing_right_a', name: 'CELA DEPARTMENT', desc: 'cas department.', hours: '8:00 AM - 4:30 PM', status: 'Open' },
      { id: 'l1_wing_right_b', name: 'CMA DEPARTMENT', desc: 'cas department.', hours: '8:00 AM - 4:30 PM', status: 'Open' }
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

// Rooms shown in gold on the map AND listed in the "School Amenities" panel.
// Kept at module level so the 3D scene and the dashboard share one list.
const highlightedIds = [
  'l1_cafeteria_annex',               // Cafeteria/Student lounge
  'l2_library', 'l3_libupper',        // Library Lower Floor, Library Upper Floor
  'l3_electronics', 'l4_printroom'    // Student Lounge 1, Student Lounge 2
];


/* ------------------------------------------------------------------
   5. FLATTEN FLOOR PLANS INTO ONE LIST (poiData3D)
   Each room gets its final x / z / w / d / rot / windows. The pattern
   `room.x !== undefined ? room.x : slot.x` means:
   "use the room's own value if it has one, otherwise the slot default".
   POI = Point Of Interest.
------------------------------------------------------------------- */
const ROOM_COLOR = 0xf3f1e7;   // default cream room colour
const poiData3D = [];
Object.keys(floorPlans).forEach(key => {
  const layer = parseInt(key);
  const plan = floorPlans[layer];

  // Wing rooms: positioned by WING_SLOTS (by index)
  plan.wings.forEach((room, i) => {
    const slot = WING_SLOTS[i] || {};
    poiData3D.push({
      ...room,                       // copy id, name, desc, hours, status, images...
      layer,
      x: room.x !== undefined ? room.x : slot.x,
      z: room.z !== undefined ? room.z : slot.z,
      w: room.w !== undefined ? room.w : WING_W,
      d: room.d !== undefined ? room.d : WING_D,
      color: ROOM_COLOR,
      windows: room.windows !== undefined ? room.windows : 1
    });
  });

  // Corridor rooms: positioned by BACK_SLOTS (by index)
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


/* ------------------------------------------------------------------
   6. READ THE SCANNED QR CHECKPOINT FROM THE URL
   Example: index.html?cp=CAFETERIA  ->  cpParam = 'CAFETERIA'
   Falls back to the main lobby if missing or unknown.
------------------------------------------------------------------- */
const urlParams = new URLSearchParams(window.location.search);
const cpParam = urlParams.get('cp') || 'L1_ENTRANCE';
const currentSpot = { ...(checkpoints[cpParam] || checkpoints['L1_ENTRANCE']) };
const spotRoom = poiData3D.find(p => p.id === currentSpot.targetId);   // the room object for that spot
currentSpot.x = spotRoom ? spotRoom.x : 0;   // pin position = that room's position
currentSpot.z = spotRoom ? spotRoom.z : 0;


/* ------------------------------------------------------------------
   7. SCENE, CAMERA, RENDERER, CONTROLS
------------------------------------------------------------------- */
const scene = new THREE.Scene();                    // container for everything in 3D
scene.background = new THREE.Color(0xe8eef5);       // light blue sky colour

// visualViewport is more reliable than innerWidth/innerHeight on phones.
function getViewportSize() {
  if (window.visualViewport) {
    return { w: window.visualViewport.width, h: window.visualViewport.height };
  }
  return { w: window.innerWidth || 300, h: window.innerHeight || 300 };
}

const { w: initW, h: initH } = getViewportSize();

// Responsive field of view: the scene was framed for a wide 16:9 screen.
// On tall (portrait) screens we widen the vertical FOV so the building
// still fits horizontally instead of being cropped.
const BASE_FOV_DEG = 45;
const BASE_ASPECT = 16 / 9;
const BASE_V_FOV_RAD = THREE.MathUtils.degToRad(BASE_FOV_DEG);
const BASE_H_FOV_RAD = 2 * Math.atan(Math.tan(BASE_V_FOV_RAD / 2) * BASE_ASPECT);
const MAX_V_FOV_DEG = 85;   // clamp so very narrow screens don't look fisheye

function getResponsiveFovDeg(aspect) {
  if (aspect >= BASE_ASPECT) return BASE_FOV_DEG;
  const vFovRad = 2 * Math.atan(Math.tan(BASE_H_FOV_RAD / 2) / aspect);
  return Math.min(THREE.MathUtils.radToDeg(vFovRad), MAX_V_FOV_DEG);
}

// PerspectiveCamera(fov, aspect, near, far)
const camera = new THREE.PerspectiveCamera(getResponsiveFovDeg(initW / initH), initW / initH, 1, 1000);

// The "all floors" overview position and the point the camera looks at
const wideCamPos = new THREE.Vector3(18, 19, 26);
const wideTarget = new THREE.Vector3(0, 6, 0.5);
camera.position.copy(wideCamPos);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(initW, initH);
// Cap pixel ratio at 2 so high-DPI phones don't render too many pixels
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // soft-edged shadows

renderer.domElement.style.touchAction = 'none';     // stop the browser from scrolling when dragging the canvas
renderer.domElement.style.cursor = 'grab';
document.body.appendChild(renderer.domElement);     // add the <canvas> to the page

// OrbitControls = camera that orbits around a target point
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;        // smooth "inertia" after you let go
controls.dampingFactor = 0.05;
controls.minDistance = 5;             // closest zoom
controls.maxDistance = 70;            // farthest zoom
controls.minPolarAngle = 0;           // can look straight down
controls.maxPolarAngle = Math.PI / 2 + 0.1;   // can't go far below the ground
controls.target.copy(wideTarget);

// One finger orbits, two fingers pinch-to-zoom and pan
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

// Fly-to animation state: the camera slowly slides toward these targets.
const targetCamPos = new THREE.Vector3().copy(wideCamPos);
const targetLookAt = new THREE.Vector3().copy(wideTarget);
let isTransitioning = false;

// If the user touches the controls mid-flight, stop the animation
controls.addEventListener('start', () => { isTransitioning = false; });

// Which floor is isolated right now: 'all' or a floor number 1-4
let activeIsolatedLayer = 'all';

// The room currently open in the details panel (used by "Directions to here")
let currentDetailRoom = null;


/* ------------------------------------------------------------------
   8. LIGHTS AND GROUND
------------------------------------------------------------------- */
scene.add(new THREE.AmbientLight(0xffffff, 0.7));   // soft light from everywhere

// "Sun": directional light that casts shadows
const sunLight = new THREE.DirectionalLight(0xfff5e6, 0.9);
sunLight.position.set(30, 50, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;     // shadow quality
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;        // area of the scene that gets shadows
sunLight.shadow.camera.far = 150;
sunLight.shadow.camera.left = -30;
sunLight.shadow.camera.right = 30;
sunLight.shadow.camera.top = 30;
sunLight.shadow.camera.bottom = -30;
sunLight.shadow.bias = -0.0005;           // prevents striped shadow artifacts
scene.add(sunLight);

// Green grass plane
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x94b49f, roughness: 0.9 })
);
ground.rotation.x = -Math.PI / 2;    // planes are vertical by default; lay it flat
ground.position.y = -0.01;           // just below 0 so it doesn't flicker with the paving
ground.receiveShadow = true;
scene.add(ground);

// Grey courtyard paving that fills the opening of the U exactly
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


/* ------------------------------------------------------------------
   9. BUILDING SHAPES
------------------------------------------------------------------- */

// Draws the U outline as a 2D shape (corner by corner, clockwise).
// `m` is a margin that grows the outline (used for the balcony lip).
// The two back corners are cut diagonally by 3.0 units (the bevels).
function makeUShape(m = 0) {
  const s = new THREE.Shape();

  s.moveTo(B.outerLeft  - m,       B.backOuter - m + 3.0);   // start: left bevel, upper point
  s.lineTo(B.outerLeft  - m + 3.0, B.backOuter - m);         // left bevel, lower point
  s.lineTo(B.outerRight + m - 3.0, B.backOuter - m);         // along the back wall
  s.lineTo(B.outerRight + m,       B.backOuter - m + 3.0);   // right bevel
  s.lineTo(B.outerRight + m, B.frontEdge + m);               // down the right side
  s.lineTo(B.wingInnerR - m, B.frontEdge + m);               // end of right wing
  s.lineTo(B.wingInnerR - m, B.backInner + m);               // into the courtyard (right)
  s.lineTo(B.wingInnerL + m, B.backInner + m);               // across the courtyard back
  s.lineTo(B.wingInnerL + m, B.frontEdge + m);               // out of the courtyard (left)
  s.lineTo(B.outerLeft  - m, B.frontEdge + m);               // end of left wing
  s.closePath();                                             // back to the start
  return s;
}

// Turns the 2D outline into a thick 3D floor slab.
function makeSlabGeometry(margin, thickness, topY) {
  const geo = new THREE.ExtrudeGeometry(makeUShape(margin), { depth: thickness, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);      // shape Y becomes world Z; slab now spans y = -thickness..0
  geo.translate(0, topY, 0);     // move it so its top surface sits at topY
  return geo;
}

/* Corridor geometry: three flat grey strips (back, left wing, right wing) */
const pathMat = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.75 });

const backPathZ = B.backInner - PATH_W / 2;                 // Z centre of the back corridor
const wingPathX = B.wingInnerR + PATH_W / 2;                // X centre of each wing corridor (mirrored for left)
const wingPathLen = B.frontEdge - B.backInner;              // length of each wing corridor

// One flat rectangle lying on the floor
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

  parts.push(makeStrip(spanX, PATH_W, 0, backPathZ));                                        // back corridor
  parts.push(makeStrip(PATH_W, wingPathLen, -wingPathX, B.backInner + wingPathLen / 2));     // left wing corridor
  parts.push(makeStrip(PATH_W, wingPathLen,  wingPathX, B.backInner + wingPathLen / 2));     // right wing corridor

  return parts;
}

// Lookup tables filled while building the floors
const floorMeshes = {};          // floor number -> its THREE.Group
const selectableSlabs = [];      // slabs the user can tap
const selectableRooms = [];      // rooms the user can tap
const spacing = 4.5;             // vertical distance between floors

// Grab page elements from index.html
const infoPanel = document.getElementById('info-panel');
const layerDisplay = document.getElementById('layer-display');
const overlay = document.getElementById('instructions-overlay');
const locationDisplay = document.getElementById('location-display');

// The gap between the two left-wing rooms, where the spiral staircase goes
const LEFT_WING_GAP_START = WING_SLOTS[0].z + WING_D / 2;
const LEFT_WING_GAP_Z = LEFT_WING_GAP_START + 0.15;


/* ------------------------------------------------------------------
   10. STAIRCASES
   Back-right = ZIGZAG (two flights + a landing, running left/right
                along the back corridor)
   Left wing  = SPIRAL (2 turns around a centre post)
   The 3D meshes AND the blue route line are both built from these same
   definitions, so the line always follows the stair's real shape.
------------------------------------------------------------------- */
const stairMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.6 });

// Zigzag settings: xStart..xEnd = flight length, z1/z2 = the two lanes, steps per flight.
// Shorter run + more steps = smoother stair that stays clear of the cafeteria corner.
const ZIGZAG = { xStart: 5.95, xEnd: 6.95, z1: -5.75, z2: -6.35, steps: 16, width: 0.3 };
// Spiral settings: cx/cz = centre, rOuter = stair radius, rRoute = radius of the route line
const SPIRAL = { cx: -wingPathX, cz: LEFT_WING_GAP_Z, steps: 24, turns: 2, rOuter: 0.85, rRoute: 0.6, a0: -Math.PI / 2 };
const SPIRAL_ENTRY_Z = SPIRAL.cz - SPIRAL.rRoute;   // where the spiral starts on the corridor

// Builds the zigzag staircase from box-shaped steps
function makeZigzagStair() {
  const g = new THREE.Group();
  const z = ZIGZAG, rise = spacing / (z.steps * 2);          // height of one step (2 flights = 1 floor)
  const tread = Math.abs(z.xEnd - z.xStart) / z.steps;       // depth of one step
  const landW = 0.3;                                         // landing width (was 0.5 - narrower keeps it off the cafeteria)
  // Helper: add a box. w runs along X, d runs along Z, h is its height.
  const addBlock = (w, d, h, x, zz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stairMat);
    m.position.set(x, 0.15 + h / 2, zz);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  };
  for (let s = 0; s < z.steps; s++) {
    const t = (s + 0.5) / z.steps;   // 0..1 progress along the flight
    addBlock(tread, z.width, rise * (s + 1) - 0.01,
             z.xStart + (z.xEnd - z.xStart) * t, z.z1);                    // flight 1 (up, heading right)
    addBlock(tread, z.width, rise * (z.steps + s + 1) - 0.01,
             z.xEnd + (z.xStart - z.xEnd) * t, z.z2);                      // flight 2 (back, heading left)
  }
  addBlock(landW, Math.abs(z.z1 - z.z2) + z.width, rise * z.steps - 0.01,
           z.xEnd + landW / 2, (z.z1 + z.z2) / 2);                         // landing between the flights
  return g;
}

// Builds the spiral staircase: a centre post with steps rotated around it
function makeSpiralStair() {
  const g = new THREE.Group();
  const s = SPIRAL;
  g.position.set(s.cx, 0, s.cz);
  const rise = spacing / s.steps, stepAng = (s.turns * 2 * Math.PI) / s.steps;   // height + angle per step

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, spacing, 12), stairMat);
  post.position.y = 0.15 + spacing / 2;
  post.castShadow = true;
  g.add(post);

  const len = s.rOuter - 0.1;
  for (let k = 0; k < s.steps; k++) {
    const mid = s.a0 + (k + 0.5) * stepAng;      // angle at the middle of this step
    const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.5), stairMat);
    step.position.set(Math.cos(mid) * (0.1 + len / 2), 0.15 + rise * (k + 1) - 0.06, Math.sin(mid) * (0.1 + len / 2));
    step.rotation.y = -mid;                      // point the step outward from the post
    step.castShadow = true; step.receiveShadow = true;
    g.add(step);
  }
  return g;
}

// Guide-line shapes. `y` = height above the lower floor's guide line (0 -> spacing).
function zigzagRoute() {
  const z = ZIGZAG, rise = spacing / (z.steps * 2), pts = [];
  const xLand = z.xEnd + 0.15;                     // centre of the 0.3-wide landing
  for (let s = 0; s < z.steps; s++) {              // flight 1
    const t = (s + 0.5) / z.steps;
    pts.push({ x: z.xStart + (z.xEnd - z.xStart) * t, z: z.z1, y: rise * (s + 1) });
  }
  pts.push({ x: xLand, z: z.z1, y: rise * z.steps });   // onto the landing
  pts.push({ x: xLand, z: z.z2, y: rise * z.steps });   // across the landing
  for (let s = 0; s < z.steps; s++) {              // flight 2
    const t = (s + 0.5) / z.steps;
    pts.push({ x: z.xEnd + (z.xStart - z.xEnd) * t, z: z.z2, y: rise * (z.steps + s + 1) });
  }
  return pts;
}
function spiralRoute() {
  const s = SPIRAL, M = s.steps * 2, pts = [];     // 2 points per step for a smooth curve
  for (let i = 0; i <= M; i++) {
    const a = s.a0 + s.turns * 2 * Math.PI * (i / M);
    pts.push({ x: s.cx + s.rRoute * Math.cos(a), z: s.cz + s.rRoute * Math.sin(a), y: spacing * (i / M) });
  }
  return pts;
}
// Route points for climbing (or descending) one staircase between two floors.
// `key` tells which staircase; reversed when going down.
function stairRoutePts(key, lowerFloor, goingUp) {
  const local = key.includes('ST_BACK') ? zigzagRoute() : spiralRoute();
  if (!goingUp) local.reverse();
  return local.map(p => ({ x: p.x, z: p.z, floor: lowerFloor, y: (lowerFloor - 1) * spacing + NAV_Y + p.y }));
}


/* ------------------------------------------------------------------
   11. BUILD THE 4 FLOORS AND THEIR ROOMS
------------------------------------------------------------------- */
for (let i = 1; i <= 4; i++) {
  // Each floor is a Group, so we can show/hide or move it as one object
  const floorGroup = new THREE.Group();
  const floorY = (i - 1) * spacing;
  floorGroup.position.y = floorY;

  // Main U-shaped slab (the floor itself). Tapping it returns to all floors.
  const slabMesh = new THREE.Mesh(
    makeSlabGeometry(0, 0.3, 0.15),
    new THREE.MeshStandardMaterial({ color: 0xdde3ea, roughness: 0.5, side: THREE.DoubleSide })
  );
  slabMesh.receiveShadow = true;
  slabMesh.userData = { type: 'slab', layerNumber: i, floorY: floorY };   // userData = our own labels for tap detection
  floorGroup.add(slabMesh);
  selectableSlabs.push(slabMesh);

  // Balcony lip: a slightly bigger, thinner slab just under the main one
  const balconyMesh = new THREE.Mesh(
    makeSlabGeometry(0.25, 0.12, -0.15),
    new THREE.MeshStandardMaterial({ color: 0xc4cbd4, roughness: 0.4, side: THREE.DoubleSide })
  );
  balconyMesh.receiveShadow = true;
  floorGroup.add(balconyMesh);

  // Corridor strips
  buildFloorPath().forEach(seg => floorGroup.add(seg));

  // Stairs on floors 1-3 only (floor 4 has nothing above it). Right = zigzag, left wing = spiral.
  if (i < 4) {
    floorGroup.add(makeZigzagStair());
    floorGroup.add(makeSpiralStair());
  }

  // Build every room that belongs to this floor
  poiData3D.filter(p => p.layer === i).forEach(poi => {
    const isTargetRoom = (poi.id === currentSpot.targetId);   // the scanned QR room -> pink
    const isHighlighted = highlightedIds.includes(poi.id);    // amenity room -> gold

    const roomGroup = new THREE.Group();
    roomGroup.position.set(poi.x, 0.75, poi.z);

    // Rotation: use the room's own angle, otherwise wing rooms face the courtyard
    if (poi.rot !== undefined) {
      roomGroup.rotation.y = poi.rot;
    } else if (poi.x < 0 && poi.z > B.backInner) {
      roomGroup.rotation.y = Math.PI / 2;      // left wing faces right
    } else if (poi.x > 0 && poi.z > B.backInner) {
      roomGroup.rotation.y = -Math.PI / 2;     // right wing faces left
    }

    // The room box itself (width x height 1.2 x depth)
    const roomMesh = new THREE.Mesh(
      new THREE.BoxGeometry(poi.w, 1.2, poi.d),
      new THREE.MeshStandardMaterial({
        color: isTargetRoom ? 0xff4081 : (isHighlighted ? 0xffd700 : poi.color),
        roughness: 0.7,
        emissive: isTargetRoom ? 0xff80ab : (isHighlighted ? 0xffa500 : 0x000000),   // glow
        emissiveIntensity: isTargetRoom ? 0.5 : (isHighlighted ? 0.6 : 0)
      })
    );
    roomMesh.castShadow = true;
    roomMesh.receiveShadow = true;
    roomGroup.add(roomMesh);

    // Glass panes on the front (door/courtyard-facing) side.
    // `windows` can be a number N (N equal panes) or an array of relative
    // widths, e.g. [1, 1.2, 1.2].
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: 0.1, transparent: true, opacity: 0.5 });
    const facadeW = poi.w * 0.8;          // glass covers 80% of the room width
    const mullionGap = 0.3;               // gap between panes
    const weights = Array.isArray(poi.windows) ? poi.windows : Array(poi.windows || 1).fill(1);
    const windowCount = weights.length;
    const totalGap = mullionGap * (windowCount - 1);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const unitW = (facadeW - totalGap) / weightSum;    // width of weight "1"

    let cursorX = -facadeW / 2;           // start at the left end of the glass area
    weights.forEach((weight) => {
      const paneW = unitW * weight;
      const glassMesh = new THREE.Mesh(new THREE.BoxGeometry(paneW, 0.6, 0.1), glassMat);
      glassMesh.position.set(cursorX + paneW / 2, 0, poi.d / 2 + 0.02);   // just in front of the wall
      roomGroup.add(glassMesh);
      cursorX += paneW + mullionGap;
    });

    // Labels used by tap detection (section 14)
    roomGroup.userData = { type: 'room', layerNumber: i, data: poi, floorY: floorY };
    // Special rooms are made slightly bigger so they stand out
    if (isTargetRoom || isHighlighted) roomGroup.scale.set(1.05, 1.2, 1.05);

    floorGroup.add(roomGroup);
    selectableRooms.push(roomGroup);
  });

  floorGroup.visible = true;
  floorMeshes[i] = floorGroup;
  scene.add(floorGroup);
}


/* ------------------------------------------------------------------
   12. "YOU ARE HERE" PIN + WELCOME OVERLAY BUTTON
------------------------------------------------------------------- */

// Red cone floating over the scanned room, flipped upside-down to look like a map pin
const userPin = new THREE.Mesh(
  new THREE.ConeGeometry(0.6, 1.5, 8),
  new THREE.MeshBasicMaterial({ color: 0xff3b30 })
);
userPin.rotation.x = Math.PI;
userPin.position.set(currentSpot.x, (currentSpot.layer - 1) * spacing + 2, currentSpot.z);
scene.add(userPin);

if (locationDisplay) locationDisplay.innerHTML = `📍 ${currentSpot.name}`;

// "Explore campus" button on the welcome card
const closeBtn = document.getElementById('close-instructions');
if (closeBtn) {
  closeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (overlay) overlay.classList.add('hidden');

    // If the user arrived by QR code, fly straight into that room's floor
    // instead of sitting on the all-floors overview.
    if (spotRoom) {
      isolateAndZoomToRoom(spotRoom);
    } else {
      isolateAndZoomFloor('all', 0);
    }
  });
}


/* ------------------------------------------------------------------
   13. "X" EXIT-ZOOM BUTTON
   Created in code (not in index.html). Shown whenever the camera is
   isolated on a single floor/room; tapping it flies back to the overview.
------------------------------------------------------------------- */
let exitZoomBtn = null;
function ensureExitZoomBtn() {
  if (exitZoomBtn) return exitZoomBtn;   // already created, reuse it

  const btn = document.createElement('button');
  btn.id = 'exit-zoom-btn';
  btn.setAttribute('aria-label', 'Exit zoomed view');
  btn.innerText = '\u00D7'; // ×
  // Inline styles so no extra CSS file is needed
  Object.assign(btn.style, {
    position: 'fixed',
    top: 'calc(16px + env(safe-area-inset-top, 0px))',        // env(...) keeps clear of phone notches
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
    display: 'none',                // hidden until needed
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


/* ------------------------------------------------------------------
   14. TAP DETECTION (RAYCASTING)
   A "raycaster" shoots an invisible line from the camera through the
   tapped screen point and reports which 3D objects it hits.
------------------------------------------------------------------- */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();   // tap position converted to -1..+1 screen coordinates
let pointerStart = null;             // where the finger/mouse went down

window.addEventListener('pointerdown', (e) => { pointerStart = { x: e.clientX, y: e.clientY }; });

window.addEventListener('pointerup', (event) => {
  if (!pointerStart) return;
  const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  pointerStart = null;
  // If the finger moved more than 12px it was a drag (rotating), not a tap.
  // 12px is a bit generous because fingers wobble.
  if (moved > 12) return;

  // Ignore taps on any UI element or while the welcome overlay is still showing,
  // so they never "fall through" to the map underneath.
  if (!overlay || event.target.closest('#image-lightbox') || event.target.closest('#info-panel') || event.target.closest('#ui-container') || event.target.closest('#exit-zoom-btn') || event.target.closest('#dashboard-panel') || event.target.closest('#dashboard-btn') || event.target.closest('#nav-panel') || event.target.closest('#nav-pill') || !overlay.classList.contains('hidden')) return;

  // Convert pixel position -> normalized device coordinates, then cast the ray
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  // Only test floors that are currently visible; `true` = also check children (glass etc.)
  const visibleTargets = [...selectableRooms, ...selectableSlabs].filter(m => m.parent.visible);
  const intersects = raycaster.intersectObjects(visibleTargets, true);

  if (intersects.length > 0) {
    // The nearest hit might be a glass pane; climb up to the parent that has our userData label
    let hit = intersects[0].object;
    while (hit && !hit.userData.type && hit.parent) hit = hit.parent;

    if (activeIsolatedLayer === 'all') {
      // Overview mode: tapping anything isolates that floor
      if (hit.userData.layerNumber) isolateAndZoomFloor(hit.userData.layerNumber, hit.userData.floorY);
    } else if (hit.userData.type === 'room') {
      showRoomDetails(hit.userData.data);          // zoomed on a floor: tap a room -> details
    } else if (hit.userData.type === 'slab') {
      isolateAndZoomFloor('all', 0);               // tap the floor slab -> back to overview
    }
  } else if (infoPanel) {
    infoPanel.classList.remove('active');          // tapped empty space -> close details
  }
});

// Close button (✕) on the room details panel
const closePanelBtn = document.getElementById('close-panel');
if (closePanelBtn) {
  closePanelBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    closeLightbox();
    if (infoPanel) infoPanel.classList.remove('active');
  });
}


/* ------------------------------------------------------------------
   15. PHOTO LIGHTBOX: tap a room photo to view it full screen
------------------------------------------------------------------- */
const lightbox = document.getElementById('image-lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');

function openLightbox(src, alt) {
  if (!lightbox || !lightboxImg) return;
  lightboxImg.src = src;
  lightboxImg.alt = alt || '';
  lightbox.classList.add('active');                  // CSS fades it in
  lightbox.setAttribute('aria-hidden', 'false');     // accessibility: tell screen readers it's visible
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
  if (e.key === 'Escape') closeLightbox();           // keyboard shortcut for desktop
});


/* ------------------------------------------------------------------
   16. ROOM DETAILS PANEL (bottom sheet)
------------------------------------------------------------------- */
function showRoomDetails(room) {
  closeLightbox();
  closeNavPanel();                 // only one bottom sheet at a time
  currentDetailRoom = room;        // remembered for "Directions to here"

  const rn = document.getElementById('room-name');
  const rlt = document.getElementById('room-layer-tag');
  const rd = document.getElementById('room-desc');
  const rh = document.getElementById('room-hours');
  const rs = document.getElementById('room-status');
  const gallery = document.getElementById('room-gallery');

  // Fill in the text fields (the `if` guards avoid errors if an element is missing)
  if (rn) rn.innerText = room.name;
  if (rlt) rlt.innerText = `Floor Layer ${room.layer}`;
  if (rd) rd.innerText = room.desc;
  if (rh) rh.innerText = room.hours;
  if (rs) {
    rs.innerText = room.status;
    rs.style.color = (room.status === 'Open') ? '#0B3B24' : '#B04A2F';   // green = open, red = closed
  }

  // Photos: only shown for rooms that have an `images` list
  if (gallery) {
    gallery.innerHTML = '';                                       // clear the previous room's photos
    const imgs = room.images || [];
    gallery.classList.toggle('has-images', imgs.length > 0);      // CSS shows the gallery only when true
    gallery.classList.toggle('two', imgs.length === 2);           // CSS puts 2 photos side by side
    imgs.forEach(src => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = room.name;
      img.loading = 'lazy';                                       // load only when needed
      img.draggable = false;
      img.addEventListener('error', () => img.remove());          // hide broken images
      img.addEventListener('click', (e) => {                      // tap to enlarge
        e.stopPropagation();
        openLightbox(src, room.name);
      });
      gallery.appendChild(img);
    });
  }

  if (infoPanel) infoPanel.classList.add('active');               // slide the sheet up
}


/* ------------------------------------------------------------------
   17. CAMERA FLY-TO FUNCTIONS
   These only SET the target; animate() (section 20) does the sliding.
------------------------------------------------------------------- */

// Show one floor (or 'all') and move the camera to frame it
function isolateAndZoomFloor(selectedLayer, floorY) {
  activeIsolatedLayer = selectedLayer;
  if (infoPanel) infoPanel.classList.remove('active');

  if (layerDisplay) {
    layerDisplay.innerHTML = (selectedLayer === 'all')
      ? '🏢 Viewing: All Floors'
      : `🏢 Viewing: Floor Layer ${selectedLayer}`;
  }

  // Hide every floor except the selected one
  Object.keys(floorMeshes).forEach(key => {
    const layerNum = parseInt(key);
    floorMeshes[layerNum].visible = (selectedLayer === 'all' || selectedLayer === layerNum);
  });

  // The pin only shows if its floor is visible
  if (userPin) userPin.visible = (selectedLayer === 'all' || selectedLayer === currentSpot.layer);
  setExitZoomBtnVisible(selectedLayer !== 'all');

  if (selectedLayer === 'all') {
    targetCamPos.copy(wideCamPos);
    targetLookAt.copy(wideTarget);
  } else {
    targetLookAt.set(0, floorY + 0.5, 0.5);
    targetCamPos.set(0, floorY + 14, 20);
  }
  isTransitioning = true;   // tells animate() to start sliding
}

// Zooms straight into one room: isolates its floor, frames the camera
// tight on the room, and opens the info panel automatically.
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
  targetCamPos.set(poi.x + 6, floorY + 7, poi.z + 8);   // camera sits up and back from the room
  isTransitioning = true;

  showRoomDetails(poi);
}


/* ------------------------------------------------------------------
   18. SCHOOL AMENITIES DASHBOARD
   A side panel listing every room in `highlightedIds`. Picking one
   flies the camera straight to it, same as scanning its QR code.
------------------------------------------------------------------- */
const dashboardBtn = document.getElementById('dashboard-btn');
const dashboardPanel = document.getElementById('dashboard-panel');
const dashboardList = document.getElementById('dashboard-list');
const dashboardCloseBtn = document.getElementById('dashboard-close');

// Creates one button per amenity room
function buildDashboard() {
  if (!dashboardList) return;
  dashboardList.innerHTML = '';

  // Look up each id in poiData3D; .filter(Boolean) drops ids that weren't found
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
    dashboardPanel.classList.toggle('active');   // open if closed, close if open
  });
}
if (dashboardCloseBtn) {
  dashboardCloseBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (dashboardPanel) dashboardPanel.classList.remove('active');
  });
}


/* ------------------------------------------------------------------
   19. POINT-TO-POINT NAVIGATION
   How it works, in 4 steps:
     a) Every floor has the same walkable corridor network (back run +
        two wing runs). Each room "plugs in" at its door, and the two
        staircases link each floor to the next. This is a GRAPH.
     b) Dijkstra's algorithm finds the shortest path through the graph.
     c) A glowing blue line with moving dots is drawn along that path
        (and up/down the stairs, following the zigzag/spiral shape).
     d) UI: a "Directions" button (From / To), a "Directions to here"
        button in the room sheet, and a step-by-step text list.
------------------------------------------------------------------- */
const NAV_Y = 0.3;            // guide-line height above each floor's origin
const NAV_BACK_X = 8.79;      // how far the back corridor reaches (corner nooks)
const NAV_TUBE_R = 0.13;      // thickness of the guide line
const STAIR_COST = 7;         // climbing one floor "costs" as much as walking 7 units
const ROUTE_SPEED = 3.2;      // moving-dot speed
const DOT_SPACING = 1.5;      // distance between moving dots

// Quick lookup: room id -> room object
const roomById = {};
poiData3D.forEach(p => { roomById[p.id] = p; });

/* ---- Where is each room's door? ---- */

// Same facing rules the 3D rooms use, so the door is where the glass is.
function roomRot(poi) {
  if (poi.rot !== undefined) return poi.rot;
  if (poi.x < 0 && poi.z > B.backInner) return Math.PI / 2;
  if (poi.x > 0 && poi.z > B.backInner) return -Math.PI / 2;
  return 0;
}
// The door is on the room's front face: centre + (rotation direction * half depth)
function doorPoint(poi) {
  const r = roomRot(poi);
  return { x: poi.x + Math.sin(r) * poi.d / 2, z: poi.z + Math.cos(r) * poi.d / 2 };
}
// Where the room's door meets the corridor.
// seg: 'L' = left wing corridor, 'R' = right wing corridor, 'B' = back corridor
function roomAccess(poi) {
  if (poi.z > B.backInner) {   // wing room
    return {
      seg: poi.x < 0 ? 'L' : 'R',
      x: poi.x < 0 ? -wingPathX : wingPathX,
      z: Math.min(Math.max(poi.z, backPathZ), B.frontEdge)   // clamp inside the corridor
    };
  }
  // back-corridor room
  return { seg: 'B', x: Math.min(Math.max(poi.x, -NAV_BACK_X), NAV_BACK_X), z: backPathZ };
}

/* ---- Walkable graph (nodes = points you can stand, edges = walkable links) ---- */
const navNodes = {};   // key -> { x, z, floor }
const navAdj = {};     // key -> list of { to: neighbourKey, cost: distance }
(function buildNavGraph() {   // immediately-invoked function: runs once, keeps its helpers private
  const addNode = (key, x, z, floor) => {
    navNodes[key] = { x, z, floor };
    navAdj[key] = [];
    return key;
  };
  // Two-way link between nodes a and b
  const link = (a, b, cost) => {
    navAdj[a].push({ to: b, cost });
    navAdj[b].push({ to: a, cost });
  };
  // Sorts nodes along one axis and links each to its neighbour (like beads on a string)
  const chain = (list, axis) => {
    list.sort((m, n) => navNodes[m][axis] - navNodes[n][axis]);
    for (let i = 1; i < list.length; i++) {
      const a = navNodes[list[i - 1]], b = navNodes[list[i]];
      link(list[i - 1], list[i], Math.hypot(a.x - b.x, a.z - b.z));
    }
  };

  for (let f = 1; f <= 4; f++) {
    const segL = [], segB = [], segR = [];   // nodes on the left wing, back, and right wing corridors

    const BL = addNode(`${f}:BL`, -wingPathX, backPathZ, f);   // back-left junction
    const BR = addNode(`${f}:BR`,  wingPathX, backPathZ, f);   // back-right junction
    segB.push(BL, BR);
    segL.push(BL);     // junctions belong to two corridors
    segR.push(BR);

    segB.push(addNode(`${f}:BACK_L`, -NAV_BACK_X, backPathZ, f));    // far left end of back corridor
    segB.push(addNode(`${f}:BACK_R`,  NAV_BACK_X, backPathZ, f));    // far right end
    segL.push(addNode(`${f}:END_L`, -wingPathX, B.frontEdge, f));    // front end of left wing
    segR.push(addNode(`${f}:END_R`,  wingPathX, B.frontEdge, f));    // front end of right wing

    // Staircase landings (match the stairs drawn in section 11)
    segB.push(addNode(`${f}:ST_BACK`, ZIGZAG.xStart, backPathZ, f));
    segL.push(addNode(`${f}:ST_LEFT`, SPIRAL.cx, SPIRAL_ENTRY_Z, f));

    // One node per room, placed where its door meets the corridor
    poiData3D.filter(p => p.layer === f).forEach(p => {
      const a = roomAccess(p);
      const key = addNode(`${f}:room:${p.id}`, a.x, a.z, f);
      (a.seg === 'B' ? segB : a.seg === 'L' ? segL : segR).push(key);
    });

    chain(segB, 'x');   // back corridor runs left-right, so sort by x
    chain(segL, 'z');   // wings run front-back, so sort by z
    chain(segR, 'z');
  }

  // Stairs join each floor to the one above (same staircase, next floor)
  for (let f = 1; f < 4; f++) {
    ['ST_BACK', 'ST_LEFT'].forEach(n => link(`${f}:${n}`, `${f + 1}:${n}`, STAIR_COST));
  }
})();

/* ---- Dijkstra's shortest path ----
   Keep a "distance from start" for every node. Repeatedly take the closest
   unvisited node, then see if going through it gives its neighbours a
   shorter distance. Finally walk `prev` backwards from the end to rebuild
   the path. */
function findPath(start, end) {
  const dist = {}, prev = {}, done = {};
  Object.keys(navNodes).forEach(k => { dist[k] = Infinity; });
  dist[start] = 0;
  while (true) {
    // pick the unvisited node with the smallest distance
    let u = null, best = Infinity;
    for (const k in dist) {
      if (!done[k] && dist[k] < best) { best = dist[k]; u = k; }
    }
    if (u === null) return null;     // nothing reachable left -> no route
    if (u === end) break;            // reached the destination
    done[u] = true;
    navAdj[u].forEach(e => {
      const nd = best + e.cost;      // distance if we go through u
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; }
    });
  }
  // Rebuild the path by walking backwards from the end
  const path = [end];
  while (path[0] !== start) path.unshift(prev[path[0]]);
  return path;
}

/* ---- Guide line (3D) ---- */
const routeGroup = new THREE.Group();   // holds every route mesh so it can be cleared easily
scene.add(routeGroup);

// depthTest: false + high renderOrder = the line is drawn on top of everything,
// so it stays visible through floor slabs.
const routeLineMat  = new THREE.MeshBasicMaterial({ color: 0x1a73e8, transparent: true, opacity: 0.95, depthTest: false });
const routeDotMat   = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1,    depthTest: false });
const routeStartMat = new THREE.MeshBasicMaterial({ color: 0x1a73e8, transparent: true, opacity: 1,    depthTest: false });
const routeDestMat  = new THREE.MeshBasicMaterial({ color: 0x2e7d32, transparent: true, opacity: 1,    depthTest: false });
// Shared geometries (created once, reused for every route)
const jointGeo      = new THREE.SphereGeometry(NAV_TUBE_R, 10, 10);   // round joint between line segments
const dotGeo        = new THREE.SphereGeometry(0.2, 12, 12);          // moving white dots
const markerGeo     = new THREE.SphereGeometry(0.42, 16, 16);         // start/end balls
const destConeGeo   = new THREE.ConeGeometry(0.5, 1.2, 8);            // green arrow over the destination

// Everything about the current route, in one object
const routeState = {
  active: false,
  items: [],        // line meshes + the floors they belong to (for hiding)
  dots: [],         // moving dots
  world: [],        // route points as 3D vectors
  pts: [],          // route points as plain data
  cum: [],          // cumulative distance along the route at each point
  total: 0,         // total route length
  destCone: null, destBaseY: 0, toName: ''
};

// Convert a route point to a 3D position. Points may carry their own
// height (y), which is how the stair shapes work.
function routeToWorld(p) {
  return new THREE.Vector3(p.x, p.y !== undefined ? p.y : (p.floor - 1) * spacing + NAV_Y, p.z);
}

// Add a mesh to the route and remember which floors it belongs to,
// so it can be hidden when those floors are hidden.
function addRouteMesh(mesh, layers) {
  mesh.renderOrder = 999;
  routeGroup.add(mesh);
  routeState.items.push({ mesh, layers });
  return mesh;
}

// A thin cylinder stretched between point a and point b
function makeSegmentMesh(a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 0.01) return null;      // too short to bother
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(NAV_TUBE_R, NAV_TUBE_R, len, 8), routeLineMat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);                                 // place at the midpoint
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());  // rotate from "up" to point along a->b
  mesh.userData.ownGeo = true;      // this geometry is unique, so free it when clearing
  return mesh;
}

// Remove the current route and reset its state
function clearRoute() {
  routeState.items.forEach(({ mesh }) => {
    if (mesh.userData.ownGeo) mesh.geometry.dispose();   // free GPU memory
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

// Build the glowing route from a list of points
function drawRoute(pts, toRoom) {
  clearRoute();

  const world = pts.map(routeToWorld);
  routeState.pts = pts;
  routeState.world = world;

  // Joint sphere at every point + a cylinder between consecutive points.
  // `cum` records the running distance so dots can be placed along the line later.
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

  // Moving dots that flow from start to destination (one every DOT_SPACING units)
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

// Runs every frame: hides route parts on hidden floors and moves the dots
function updateRoute(nowSec) {
  if (!routeState.active) return;

  // Show a route piece only if at least one of its floors is visible
  routeState.items.forEach(({ mesh, layers }) => {
    mesh.visible = layers.some(l => floorMeshes[l] && floorMeshes[l].visible);
  });

  const { pts, cum, world, total } = routeState;
  const flow = (nowSec * ROUTE_SPEED) % DOT_SPACING;   // shared offset that makes all dots slide forward
  routeState.dots.forEach((d, k) => {
    const s = flow + k * DOT_SPACING;                  // this dot's distance along the route
    if (s > total) { d.mesh.visible = false; return; } // past the end
    // Find which segment the dot is on...
    let i = 1;
    while (i < cum.length - 1 && s > cum[i]) i++;
    const segLen = (cum[i] - cum[i - 1]) || 1;
    const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / segLen));   // ...and how far (0..1) along it
    d.mesh.position.lerpVectors(world[i - 1], world[i], t);
    d.mesh.visible = [pts[i - 1].floor, pts[i].floor].some(l => floorMeshes[l] && floorMeshes[l].visible);
  });

  // Destination arrow bobs up/down and spins
  if (routeState.destCone) {
    routeState.destCone.position.y = routeState.destBaseY + Math.sin(nowSec * 3) * 0.15;
    routeState.destCone.rotation.y = nowSec * 1.5;
  }
}

/* ---- Directions text ---- */
const fmtM = (d) => `${Math.max(1, Math.round(d))} m`;   // "12 m", never below 1 m
const stairLabel = (key) => key.includes('ST_BACK') ? 'zigzag staircase (back corridor)' : 'spiral staircase (left wing)';

// Turns the node path into readable steps.
// startLeg / endLeg = walking distance from the room door to the corridor at each end.
function buildSteps(keys, fromRoom, toRoom, startLeg, endLeg) {
  const steps = [`Start at ${fromRoom.name} (Floor ${fromRoom.layer}) and head out into the corridor.`];
  let walk = startLeg;     // distance walked since the last step was written
  let stairRun = null;     // set while we're in the middle of climbing stairs

  // Writes the "Take the ... staircase" step once the climb is finished
  const flushStairs = () => {
    if (!stairRun) return;
    steps.push(`Take the ${stairRun.name} ${stairRun.to > stairRun.from ? 'up' : 'down'} to Floor ${stairRun.to}.`);
    stairRun = null;
  };

  for (let i = 1; i < keys.length; i++) {
    const a = navNodes[keys[i - 1]], b = navNodes[keys[i]];
    if (a.floor !== b.floor) {
      // Floor changed -> this hop is a staircase
      if (!stairRun) {
        if (walk > 0.5) steps.push(`Walk about ${fmtM(walk)} to the ${stairLabel(keys[i - 1])}.`);
        walk = 0;
        stairRun = { name: stairLabel(keys[i - 1]), from: a.floor, to: b.floor };
      } else {
        stairRun.to = b.floor;     // still climbing: extend the run (multi-floor climbs = one step)
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

/* ---- Directions UI (built in code, so index.html needs no changes) ---- */

// Inject the CSS for all navigation widgets
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

// "Directions" button under "School Amenities"
const uiContainer = document.getElementById('ui-container');
const navBtn = document.createElement('button');
navBtn.id = 'nav-btn';
navBtn.type = 'button';
navBtn.textContent = '\u27A4 Directions';   // ➤
if (uiContainer) uiContainer.appendChild(navBtn);

// The Directions bottom sheet: From / To dropdowns, swap, Show route, Clear
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

// Dropdown labels. Two rooms with the same name on the same floor (e.g. the
// two "CAS" rooms) get "(A)" / "(B)" added so they can be told apart.
const navLabel = {};
(function buildNavLabels() {
  const counts = {}, seen = {};
  poiData3D.forEach(p => { const k = `${p.layer}|${p.name}`; counts[k] = (counts[k] || 0) + 1; });
  poiData3D.forEach(p => {
    const k = `${p.layer}|${p.name}`;
    seen[k] = (seen[k] || 0) + 1;
    navLabel[p.id] = counts[k] > 1 ? `${p.name} (${String.fromCharCode(64 + seen[k])})` : p.name;   // 65 = 'A'
  });
})();

const navDefaultFrom = currentSpot.targetId;   // "From" defaults to the scanned QR room

// Fill a <select> with rooms grouped by floor
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
      .sort((a, b) => navLabel[a.id].localeCompare(navLabel[b.id], undefined, { numeric: true }))   // "Room 2" before "Room 10"
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

// Show a message in the sheet and clear any old steps
function setNavMessage(html) {
  navSummary.innerHTML = html;
  navSteps.innerHTML = '';
}

// Show the floating pill only when a route exists AND the sheet is closed
function updateNavPill() {
  if (!navPill) return;
  const show = routeState.active && !navPanel.classList.contains('active');
  navPill.style.display = show ? 'block' : 'none';
  if (show) navPill.textContent = `\u27A4 Route to ${routeState.toName} \u2022 tap for steps`;
}

function openNavPanel() {
  if (infoPanel) infoPanel.classList.remove('active');            // one sheet at a time
  if (dashboardPanel) dashboardPanel.classList.remove('active');
  navPanel.classList.add('active');
  updateNavPill();
}
function closeNavPanel() {
  navPanel.classList.remove('active');
  updateNavPill();
}

// Called by "Show route": validates, finds the path, draws it, writes the steps
function requestRoute() {
  const fromId = navFromSel.value;
  const toId = navToSel.value;
  if (!toId) { setNavMessage('Choose a destination first.'); return; }
  if (fromId === toId) { setNavMessage('You\u2019re already there \u2014 pick a different start or destination.'); return; }

  const from = roomById[fromId], to = roomById[toId];
  const keys = findPath(`${from.layer}:room:${fromId}`, `${to.layer}:room:${toId}`);
  if (!keys) { setNavMessage('No walkable route was found between these two places.'); return; }

  // Distance from each room's door to the corridor node at that end
  const startDoor = doorPoint(from), endDoor = doorPoint(to);
  const first = navNodes[keys[0]], last = navNodes[keys[keys.length - 1]];
  const startLeg = Math.hypot(startDoor.x - first.x, startDoor.z - first.z);
  const endLeg = Math.hypot(endDoor.x - last.x, endDoor.z - last.z);

  // Build the polyline for the guide line. `y` is optional: stair points carry their own height.
  const pts = [];
  const push = (x, z, floor, y) => {
    const p = pts[pts.length - 1];
    if (p && p.floor === floor && Math.hypot(p.x - x, p.z - z) < 0.01) return;   // skip duplicate points
    pts.push({ x, z, floor, y });
  };
  push(startDoor.x, startDoor.z, from.layer);
  keys.forEach((k, idx) => {
    const n = navNodes[k];
    if (idx > 0) {
      const prevKey = keys[idx - 1], pn = navNodes[prevKey];
      if (pn.floor !== n.floor) {
        // Floor changed: insert the zigzag / spiral shape between the two landings
        const goingUp = n.floor > pn.floor;
        stairRoutePts(prevKey, Math.min(pn.floor, n.floor), goingUp)
          .forEach(p => push(p.x, p.z, p.floor, p.y));
      }
    }
    push(n.x, n.z, n.floor);
  });
  push(endDoor.x, endDoor.z, to.layer);

  // Total walking distance (flat parts only; stairs not counted)
  let flat = startLeg + endLeg;
  for (let i = 1; i < keys.length; i++) {
    const a = navNodes[keys[i - 1]], b = navNodes[keys[i]];
    if (a.floor === b.floor) flat += Math.hypot(a.x - b.x, a.z - b.z);
  }

  drawRoute(pts, to);

  // Summary line + numbered steps
  const where = from.layer === to.layer ? `Same floor (Floor ${from.layer})` : `Floor ${from.layer} \u2192 Floor ${to.layer}`;
  navSummary.innerHTML = `<strong>${where}</strong> \u2022 about ${fmtM(flat)} of walking (approx.)`;
  navSteps.innerHTML = '';
  buildSteps(keys, from, to, startLeg, endLeg).forEach((text, i, arr) => {
    const li = document.createElement('li');
    li.textContent = text;
    if (i === arr.length - 1) li.className = 'arrive';   // last step gets a green number
    navSteps.appendChild(li);
  });

  // Frame the route: one floor -> isolate it; several floors -> show the whole building
  const floorsUsed = new Set(pts.map(p => p.floor));
  if (floorsUsed.size === 1) {
    const f = [...floorsUsed][0];
    isolateAndZoomFloor(f, (f - 1) * spacing);
  } else {
    isolateAndZoomFloor('all', 0);
  }
}

/* ---- Wire up the navigation buttons ---- */
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
  if (!t) return;            // nothing to swap yet
  navFromSel.value = t;
  navToSel.value = f;
});
navPill.addEventListener('click', (e) => { e.stopPropagation(); openNavPanel(); });
if (dashboardBtn) dashboardBtn.addEventListener('click', () => closeNavPanel());

// "Directions to here" button, added inside the room details sheet
const infoDirBtn = document.createElement('button');
infoDirBtn.id = 'info-dir-btn';
infoDirBtn.type = 'button';
infoDirBtn.textContent = '\u27A4 Directions to here';
const roomMetaEl = infoPanel ? infoPanel.querySelector('.room-meta') : null;
if (roomMetaEl && roomMetaEl.parentElement) roomMetaEl.parentElement.appendChild(infoDirBtn);
infoDirBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentDetailRoom) return;
  navToSel.value = currentDetailRoom.id;   // set destination to the open room
  openNavPanel();
  requestRoute();                          // and immediately show the route
});


/* ------------------------------------------------------------------
   20. ANIMATION LOOP  (runs every frame, ~60 times a second)
------------------------------------------------------------------- */
function animate() {
  requestAnimationFrame(animate);   // schedule the next frame

  // Fly-to: slide 5% of the remaining distance each frame (ease-out feel)
  if (isTransitioning) {
    camera.position.lerp(targetCamPos, 0.05);
    controls.target.lerp(targetLookAt, 0.05);
    // Stop once we're close enough
    if (camera.position.distanceTo(targetCamPos) < 0.05 && controls.target.distanceTo(targetLookAt) < 0.05) {
      isTransitioning = false;
    }
  }

  if (userPin && userPin.visible) userPin.rotation.y += 0.03;   // spin the pin
  updateRoute(performance.now() / 1000);                        // animate the route dots (time in seconds)
  controls.update();                                            // required when damping is on
  renderer.render(scene, camera);                               // draw the frame
}
animate();


/* ------------------------------------------------------------------
   21. WINDOW RESIZE HANDLING
   Debounced (waits 100 ms after the LAST event) because mobile address
   bars fire many resize events while animating.
------------------------------------------------------------------- */
let resizeTimeout = null;
function handleResize() {
  const { w, h } = getViewportSize();
  const aspect = w / h;

  camera.fov = getResponsiveFovDeg(aspect);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();   // must be called after changing fov/aspect

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
