import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// [MOBILE] Deteksi perangkat sentuh/HP
const IS_MOBILE =
  /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
  matchMedia("(pointer: coarse)").matches;

const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_TIP: 20,
  MIDDLE_MCP: 9,
  RING_MCP: 13,
  PINKY_MCP: 17,
};

const PINCH_THRESHOLD = 0.055;
const FRAME_PADDING = 28;
const FREEZE_HOLD_MS = 250;
// [MOBILE] waktu lebih lama di HP agar sempat mundur dari layar setelah menekan tombol
const COUNTDOWN_SECONDS = IS_MOBILE ? 5 : 3;
const FIST_HOLD_FRAMES = 12;
// [MOBILE] area snap lebih longgar di HP
const SNAP_DISTANCE_RATIO = IS_MOBILE ? 0.6 : 0.45;
let GRID = 3;
const LOAD_TIMEOUT_MS = 60000;

const PHOTOBOOTH_CONTRAST_ALPHA = 1.3;
const PHOTOBOOTH_BRIGHTNESS_BETA = 10;
const PHOTOBOOTH_NOISE_STD = 15;

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const videoEl = document.getElementById("webcam");
const canvas = document.getElementById("sceneCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const loadingOverlay = document.getElementById("loadingOverlay");
const loaderText = document.getElementById("loaderText");
const loaderRetry = document.getElementById("loaderRetry");
const errorBanner = document.getElementById("errorBanner");
const progressBadge = document.getElementById("progressBadge");
const progressText = document.getElementById("progressText");

const galleryStrip = document.getElementById("galleryStrip");
const galleryEmpty = document.getElementById("galleryEmpty");
const galleryCount = document.getElementById("galleryCount");
const downloadStripBtn = document.getElementById("downloadStripBtn");
const resetAllBtn = document.getElementById("resetAllBtn");
const stripCompleteMsg = document.getElementById("stripCompleteMsg");

let appState = "welcome";

const puzzle = {
  boardBox: null,
  pieces: [],
  solved: false,
  tileW: 0,
  tileH: 0,
};

let SHATTER_COLS = 6;
let SHATTER_ROWS = 6;
const SHATTER_DURATION_MS = 850;
const shatter = {
  active: false,
  startedAt: 0,
  fragments: [],
  pendingCanvas: null,
};

let STRIP_MAX_PHOTOS = 3;
const galleryEntries = [];

function addToGallery(snapshotCanvas) {
  if (galleryEntries.length >= STRIP_MAX_PHOTOS) return;

  galleryEntries.push({ canvas: snapshotCanvas, time: Date.now() });
  renderGalleryThumb(snapshotCanvas, galleryEntries.length);
  galleryCount.textContent = `${galleryEntries.length} / ${STRIP_MAX_PHOTOS}`;
  if (galleryEmpty) galleryEmpty.style.display = "none";

  if (galleryEntries.length >= STRIP_MAX_PHOTOS) {
    showStripComplete();

    // Auto-transition to edit photo screen
    const stripCanvas = createPhotoStripCanvas();
    if (stripCanvas) {
      currentEditCanvas = stripCanvas;
      appState = "edit_photo";
      const progressOverlay = document.getElementById("progressOverlay");
      if (progressOverlay) progressOverlay.style.display = "none";
      document.getElementById("app").style.display = "none";

      // Show printing animation
      const printingScreen = document.getElementById("printingScreen");
      const printingImage = document.getElementById("printingImage");

      if (printingScreen && printingImage) {
        printingImage.src = currentEditCanvas.toDataURL("image/png");
        printingImage.classList.remove("translate-y-0");
        printingImage.classList.add("-translate-y-[120%]");
        if (window.navigateToScreen) window.navigateToScreen('printingScreen');

        // Trigger animation
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            printingImage.classList.remove("-translate-y-[120%]");
            printingImage.classList.add("translate-y-0");
          });
        });

        // Wait for animation to finish, then go to edit screen
        setTimeout(() => {
          if (window.navigateToScreen) window.navigateToScreen('editPhotoScreen');
          const editCanvas = document.getElementById("editCanvas");
          editCanvas.width = currentEditCanvas.width;
          editCanvas.height = currentEditCanvas.height;
          editCanvas.style.boxSizing = "border-box";
          redrawEditCanvas();
        }, 3500);
      } else {
        // Fallback if elements not found
        if (window.navigateToScreen) window.navigateToScreen('editPhotoScreen');
        const editCanvas = document.getElementById("editCanvas");
        editCanvas.width = currentEditCanvas.width;
        editCanvas.height = currentEditCanvas.height;
        editCanvas.style.boxSizing = "border-box";
        redrawEditCanvas();
      }
    }

  }
}

function isStripFull() {
  return galleryEntries.length >= STRIP_MAX_PHOTOS;
}

function showStripComplete() {
  if (stripCompleteMsg) stripCompleteMsg.classList.add("visible");
  updateStripDownloadAvailability();
}

function hideStripComplete() {
  if (stripCompleteMsg) stripCompleteMsg.classList.remove("visible");
}

function updateStripDownloadAvailability() {
  if (!downloadStripBtn) return;
  downloadStripBtn.disabled = galleryEntries.length === 0;
}

const STRIP_FILE_BORDER = 36; // sebelumnya 24: bingkai lebih tebal agar motif terlihat
const STRIP_BOTTOM_PADDING = 120; // Extra padding for text
const STRIP_FILE_GAP = 16;
const STRIP_FILE_BG = "#ffffff";

function createPhotoStripCanvas() {
  if (galleryEntries.length === 0) return null;

  const entries = galleryEntries;
  const targetW = entries[0].canvas.width;
  const scaledHeights = entries.map((entry) =>
    Math.round(entry.canvas.height * (targetW / entry.canvas.width))
  );

  const totalH =
    STRIP_FILE_BORDER + STRIP_BOTTOM_PADDING +
    scaledHeights.reduce((sum, h) => sum + h, 0) +
    STRIP_FILE_GAP * (entries.length - 1);
  const totalW = targetW + STRIP_FILE_BORDER * 2;

  const stripCanvas = document.createElement("canvas");
  stripCanvas.width = totalW;
  stripCanvas.height = totalH;
  const stripCtx = stripCanvas.getContext("2d");

  let cursorY = STRIP_FILE_BORDER;
  entries.forEach((entry, i) => {
    const h = scaledHeights[i];
    stripCtx.drawImage(entry.canvas, STRIP_FILE_BORDER, cursorY, targetW, h);
    cursorY += h + STRIP_FILE_GAP;
  });

  return stripCanvas;
}

function downloadPhotoStrip() {
  const stripCanvas = createPhotoStripCanvas();
  if (!stripCanvas) return;

  stripCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    // Mengubah penamaan file unduhan agar default ID
    link.download = `puzzlecam_gallery_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
}

function resetEverything() {
  galleryEntries.length = 0;
  galleryStrip.innerHTML = "";
  galleryCount.textContent = `0 / ${STRIP_MAX_PHOTOS}`;
  if (galleryEmpty) {
    galleryEmpty.style.display = "block";
    galleryStrip.appendChild(galleryEmpty);
  }
  hideStripComplete();
  updateStripDownloadAvailability();
  resetPuzzleOnly();
  statusText.textContent = "all reset";
}

function renderGalleryThumb(snapshotCanvas, index) {
  const print = document.createElement("div");
  print.className = "print";

  const thumbCanvas = document.createElement("canvas");
  const THUMB_W = 220;
  const scale = THUMB_W / snapshotCanvas.width;
  thumbCanvas.width = THUMB_W;
  thumbCanvas.height = Math.round(snapshotCanvas.height * scale);
  thumbCanvas.getContext("2d").drawImage(snapshotCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);

  const label = document.createElement("div");
  label.className = "print-label";
  label.textContent = `#${String(index).padStart(2, "0")}`;

  print.appendChild(thumbCanvas);
  print.appendChild(label);
  galleryStrip.insertBefore(print, galleryStrip.firstChild);
}

function resetPuzzleOnly() {
  puzzle.boardBox = null;
  puzzle.pieces = [];
  puzzle.solved = false;
  puzzle.fullPhotoboothCanvas = null;
  appState = "tracking";
  countdown.active = false;
  drag.activeHand = null;
  drag.piece = null;
  shatter.active = false;
  shatter.fragments = [];
  shatter.pendingCanvas = null;
  fistHoldCounter = 0;
  lastSeenFrame.box = null;
  lastSeenFrame.at = 0;
  updateProgressBadge();
  const progressOverlay = document.getElementById("progressOverlay");
  if (progressOverlay) progressOverlay.style.display = "flex";
}

function fitCanvasToWindow() {
  // Let Tailwind CSS class 'w-full h-full object-cover' handle the canvas sizing natively.
}

window.addEventListener("resize", fitCanvasToWindow);

async function initWebcam() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support camera access (getUserMedia).");
  }
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: isMobile ? 1280 : 1920 },
      height: { ideal: isMobile ? 720 : 1080 },
      facingMode: "user"
    },
    audio: false,
  });
  videoEl.srcObject = stream;

  await new Promise((resolve) => {
    videoEl.onloadedmetadata = () => {
      videoEl.play();
      resolve();
    };
  });

  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  fitCanvasToWindow();
}

function withTimeout(promise, ms, timeoutMessage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let handLandmarkerPreloadPromise = null;

function initHandLandmarker() {
  if (!handLandmarkerPreloadPromise) {
    handLandmarkerPreloadPromise = (async () => {
      let vision;
      try {
        vision = await withTimeout(
          FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
          ),
          LOAD_TIMEOUT_MS,
          "Timeout loading MediaPipe (WASM) runtime. Check your internet connection or ensure cdn.jsdelivr.net is not blocked."
        );
        visionInstance = vision;
      } catch (err) {
        throw err;
      }

      // Early WebGL check to prevent activeTexture undefined crashes
      let useGPU = false;
      try {
        const testCanvas = document.createElement("canvas");
        const gl = testCanvas.getContext("webgl") || testCanvas.getContext("experimental-webgl");
        if (gl) {
          useGPU = true;
          const loseContextExt = gl.getExtension('WEBGL_lose_context');
          if (loseContextExt) loseContextExt.loseContext();
        }
      } catch (e) {
        useGPU = false;
      }

      if (useGPU) {
        try {
          const handLandmarker = await withTimeout(
            HandLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath:
                  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate: "GPU",
              },
              runningMode: "video",
              numHands: 2,
              minHandDetectionConfidence: 0.6,
              minHandPresenceConfidence: 0.6,
              minTrackingConfidence: 0.6,
            }),
            LOAD_TIMEOUT_MS,
            "Timeout downloading HandLandmarker model (~10MB) using GPU."
          );
          return handLandmarker;
        } catch (gpuErr) {
          console.warn("[PuzzleCam] Failed using GPU delegate, retrying with CPU...", gpuErr);
        }
      }

      try {
        const handLandmarker = await withTimeout(
          HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
              delegate: "CPU",
            },
            runningMode: "video",
            numHands: 2,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.6,
            minTrackingConfidence: 0.6,
          }),
          LOAD_TIMEOUT_MS,
          "Timeout downloading HandLandmarker model (~10MB) using CPU. Check your connection or ensure storage.googleapis.com is not blocked."
        );
        return handLandmarker;
      } catch (cpuErr) {
        throw cpuErr;
      }
    })();
  }
  return handLandmarkerPreloadPromise;
}

window.preloadHandLandmarker = () => { initHandLandmarker().catch(console.error); };

let isFallbackActive = false;
async function fallbackToCPU() {
  if (isFallbackActive) return;
  isFallbackActive = true;
  console.warn("[PuzzleCam] WebGL error detected. Falling back to CPU...");
  statusText.textContent = "WebGL error, switching to CPU...";

  try {
    const oldLandmarker = handLandmarker;
    handLandmarker = null;
    if (oldLandmarker) {
      console.log("[PuzzleCam] Discarding broken WebGL landmarker instance without calling close() to prevent deadlocks.");
    }

    const vision = visionInstance || await withTimeout(
      FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      ),
      LOAD_TIMEOUT_MS,
      "Timeout loading MediaPipe (WASM) runtime for CPU fallback."
    );

    handLandmarker = await withTimeout(
      HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "video",
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      }),
      LOAD_TIMEOUT_MS,
      "Timeout initializing HandLandmarker model for CPU fallback."
    );
    console.log("[PuzzleCam] CPU Fallback successfully initialized.");
    statusText.textContent = "Connected (CPU Fallback)";
  } catch (err) {
    console.error("[PuzzleCam] Failed to fall back to CPU:", err);
    showError("WebGL crashed, and CPU fallback failed. Please refresh the page.");
    statusText.textContent = "Fallback Failed";
  } finally {
    isFallbackActive = false;
  }
}

function dist2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// [MOBILE] Cubitan yang lebih stabil di HP:
// jarak diukur dalam piksel, relatif terhadap ukuran telapak, dengan hysteresis
// (mulai mencubit lebih ketat, melepas lebih longgar). Di desktop perilaku tidak berubah.
const PINCH_ON_RATIO = 0.3;
const PINCH_OFF_RATIO = 0.45;
const pinchState = {};

function isPinching(landmarks, key = "default") {
  if (!IS_MOBILE) {
    return dist2D(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) < PINCH_THRESHOLD;
  }
  const palm =
    Math.hypot(
      (landmarks[LM.WRIST].x - landmarks[LM.MIDDLE_MCP].x) * canvas.width,
      (landmarks[LM.WRIST].y - landmarks[LM.MIDDLE_MCP].y) * canvas.height
    ) || 1;
  const gap = Math.hypot(
    (landmarks[LM.THUMB_TIP].x - landmarks[LM.INDEX_TIP].x) * canvas.width,
    (landmarks[LM.THUMB_TIP].y - landmarks[LM.INDEX_TIP].y) * canvas.height
  );
  const ratio = gap / palm;
  const was = pinchState[key] === true;
  const now = was ? ratio < PINCH_OFF_RATIO : ratio < PINCH_ON_RATIO;
  pinchState[key] = now;
  return now;
}

function isFist(landmarks) {
  const wrist = landmarks[LM.WRIST];
  const pairs = [
    [LM.INDEX_TIP, LM.INDEX_MCP],
    [LM.MIDDLE_TIP, LM.MIDDLE_MCP],
    [LM.RING_TIP, LM.RING_MCP],
    [LM.PINKY_TIP, LM.PINKY_MCP],
  ];
  let curled = 0;
  for (const [tipIdx, mcpIdx] of pairs) {
    if (dist2D(landmarks[tipIdx], wrist) < dist2D(landmarks[mcpIdx], wrist)) curled++;
  }
  return curled >= 4;
}

function toPixel(landmarkNorm) {
  return { x: landmarkNorm.x * canvas.width, y: landmarkNorm.y * canvas.height };
}

function mirrorLandmarkX(landmark) {
  return { x: 1 - landmark.x, y: landmark.y };
}

function computeHandFrame(indexTipA, indexTipB) {
  const a = toPixel(indexTipA);
  const b = toPixel(indexTipB);

  const minX = Math.min(a.x, b.x) - FRAME_PADDING;
  const maxX = Math.max(a.x, b.x) + FRAME_PADDING;
  const minY = Math.min(a.y, b.y) - FRAME_PADDING;
  const maxY = Math.max(a.y, b.y) + FRAME_PADDING;

  const x = Math.max(0, minX);
  const y = Math.max(0, minY);
  const width = Math.min(canvas.width, maxX) - x;
  const height = Math.min(canvas.height, maxY) - y;

  return { x, y, width, height };
}

const freezeGate = { holding: false, since: 0 };

const FRAME_GRACE_MS = 450;
const lastSeenFrame = { box: null, at: 0 };

const countdown = {
  active: false,
  startedAt: 0,
};

function startCountdown(frameBox) {
  puzzle.boardBox = { ...frameBox };
  appState = "countdown";
  countdown.active = true;
  countdown.startedAt = performance.now();
}

function drawCountdownOverlay(box) {
  const elapsed = (performance.now() - countdown.startedAt) / 1000;
  const remaining = COUNTDOWN_SECONDS - elapsed;

  if (remaining <= 0) {
    finishCountdownAndCapture(box);
    return;
  }

  applyBWInsideBox(box);

  ctx.save();
  ctx.strokeStyle = "#f5c518";
  ctx.lineWidth = 3;
  ctx.strokeRect(box.x, box.y, box.width, box.height);

  const n = Math.ceil(remaining);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  ctx.fillStyle = "rgba(10,10,8,0.45)";
  ctx.fillRect(box.x, box.y, box.width, box.height);

  ctx.font = `${Math.max(48, Math.min(box.width, box.height) * 0.4)}px 'IBM Plex Mono', monospace`;
  ctx.fillStyle = "#f5c518";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), cx, cy);
  ctx.restore();

  statusText.textContent = `mengambil gambar dalam ${n}…`;
}

function gaussianNoise(std) {
  const u1 = Math.random() || 1e-6;
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * std;
}

function applyPhotoboothEffect(imageData) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    let v = gray * PHOTOBOOTH_CONTRAST_ALPHA + PHOTOBOOTH_BRIGHTNESS_BETA;
    v += gaussianNoise(PHOTOBOOTH_NOISE_STD);
    v = Math.max(0, Math.min(255, v));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return imageData;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function finishCountdownAndCapture(box) {
  countdown.active = false;

  const mirroredFrame = document.createElement("canvas");
  mirroredFrame.width = canvas.width;
  mirroredFrame.height = canvas.height;
  const mirroredCtx = mirroredFrame.getContext("2d");
  mirroredCtx.save();
  mirroredCtx.translate(mirroredFrame.width, 0);
  mirroredCtx.scale(-1, 1);
  mirroredCtx.filter = getFilterString(); // APPLY FILTER TO THE SNAPSHOT
  mirroredCtx.drawImage(videoEl, 0, 0, mirroredFrame.width, mirroredFrame.height);
  mirroredCtx.filter = 'none'; // RESET
  mirroredCtx.restore();

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.max(1, Math.round(box.width));
  cropCanvas.height = Math.max(1, Math.round(box.height));
  const cropCtx = cropCanvas.getContext("2d");
  cropCtx.drawImage(
    mirroredFrame,
    box.x, box.y, box.width, box.height,
    0, 0, cropCanvas.width, cropCanvas.height
  );

  puzzle.fullPhotoboothCanvas = cropCanvas;

  const tileW = Math.floor(cropCanvas.width / GRID);
  const tileH = Math.floor(cropCanvas.height / GRID);
  const pieces = [];

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const sx = col * tileW;
      const sy = row * tileH;
      const w = col === GRID - 1 ? cropCanvas.width - sx : tileW;
      const h = row === GRID - 1 ? cropCanvas.height - sy : tileH;

      const pieceCanvas = document.createElement("canvas");
      pieceCanvas.width = w;
      pieceCanvas.height = h;
      pieceCanvas.getContext("2d").drawImage(cropCanvas, sx, sy, w, h, 0, 0, w, h);

      pieces.push({
        row, col,
        canvas: pieceCanvas,
        w, h,
        x: 0, y: 0,
        placed: false,
        dragging: false,
      });
    }
  }

  const slots = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      slots.push({ x: box.x + col * tileW, y: box.y + row * tileH });
    }
  }
  shuffle(slots);

  pieces.forEach((piece, i) => {
    piece.x = slots[i].x;
    piece.y = slots[i].y;
    if (isNearOwnCell(piece, box, tileW, tileH)) {
      snapPieceToCell(piece, box, tileW, tileH);
    }
  });

  puzzle.boardBox = box;
  puzzle.pieces = pieces;
  puzzle.tileW = tileW;
  puzzle.tileH = tileH;
  puzzle.solved = pieces.every((p) => p.placed);
  appState = "puzzle";
  fistHoldCounter = 0;
  updateProgressBadge();
}

const drag = {
  activeHand: null,
  piece: null,
  offsetX: 0,
  offsetY: 0,
};

function isNearOwnCell(piece, box, tileW, tileH) {
  const correctX = box.x + piece.col * tileW;
  const correctY = box.y + piece.row * tileH;
  const dx = piece.x - correctX;
  const dy = piece.y - correctY;
  const tolerance = Math.min(tileW, tileH) * SNAP_DISTANCE_RATIO;
  return Math.sqrt(dx * dx + dy * dy) < tolerance;
}

function reconcilePlacedState(box, tileW, tileH) {
  if (!box || !puzzle.pieces.length) return false;
  for (const piece of puzzle.pieces) {
    if (piece.displacing || piece.dragging) continue;
    piece.placed = isNearOwnCell(piece, box, tileW, tileH);
  }
  return puzzle.pieces.every((p) => p.placed);
}

function snapPieceToCell(piece, box, tileW, tileH) {
  displaceCellOccupant(piece, piece.row, piece.col, box, tileW, tileH);
  piece.x = box.x + piece.col * tileW;
  piece.y = box.y + piece.row * tileH;
  piece.placed = true;
}

function displaceCellOccupant(piece, targetRow, targetCol, box, tileW, tileH) {
  const cellX = box.x + targetCol * tileW;
  const cellY = box.y + targetRow * tileH;

  const occupant = puzzle.pieces.find((p) => {
    if (p === piece || p.displacing) return false;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    return (
      cx >= cellX && cx < cellX + tileW &&
      cy >= cellY && cy < cellY + tileH
    );
  });
  if (!occupant) return;

  if (occupant.row === targetRow && occupant.col === targetCol && occupant.placed) {
    return;
  }

  occupant.placed = false;

  const freeCells = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      if (row === targetRow && col === targetCol) continue;
      const cx0 = box.x + col * tileW;
      const cy0 = box.y + row * tileH;
      const taken = puzzle.pieces.some((p) => {
        if (p === occupant || p === piece || p.displacing) return false;
        const cx = p.x + p.w / 2;
        const cy = p.y + p.h / 2;
        return cx >= cx0 && cx < cx0 + tileW && cy >= cy0 && cy < cy0 + tileH;
      });
      if (!taken) freeCells.push({ row, col });
    }
  }

  let targetSlot;
  if (freeCells.length > 0) {
    targetSlot = freeCells[Math.floor(Math.random() * freeCells.length)];
  } else {
    targetSlot = { row: occupant.row, col: occupant.col };
  }

  const targetX = box.x + targetSlot.col * tileW;
  const targetY = box.y + targetSlot.row * tileH;

  animateDisplacement(occupant, targetX, targetY, box);
}

const DISPLACE_ANIM_MS = 220;

function animateDisplacement(piece, targetX, targetY, box) {
  const startX = piece.x;
  const startY = piece.y;
  const startedAt = performance.now();

  piece.displacing = true;

  function step() {
    const t = Math.min(1, (performance.now() - startedAt) / DISPLACE_ANIM_MS);
    const eased = 1 - Math.pow(1 - t, 3);

    piece.x = startX + (targetX - startX) * eased;
    piece.y = startY + (targetY - startY) * eased;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      piece.x = targetX;
      piece.y = targetY;
      piece.displacing = false;
      clampPieceToBoard(piece);
    }
  }

  requestAnimationFrame(step);
}

function findNearestPiece(px, py) {
  let best = null;
  let bestDist = Infinity;
  for (const piece of puzzle.pieces) {
    if (piece.displacing) continue;
    const cx = piece.x + piece.w / 2;
    const cy = piece.y + piece.h / 2;
    const d = Math.hypot(px - cx, py - cy);
    // [MOBILE] area ambil lebih luas di HP
    if (d < Math.max(piece.w, piece.h) * (IS_MOBILE ? 1.0 : 0.75) && d < bestDist) {
      best = piece;
      bestDist = d;
    }
  }
  return best;
}

function handleDragForHand(handLabel, pinching, indexPx) {
  if (pinching) {
    if (drag.activeHand === null) {
      const candidate = findNearestPiece(indexPx.x, indexPx.y);
      if (candidate) {
        drag.activeHand = handLabel;
        drag.piece = candidate;
        drag.offsetX = indexPx.x - candidate.x;
        drag.offsetY = indexPx.y - candidate.y;
        candidate.dragging = true;
        candidate.placed = false;
      }
    } else if (drag.activeHand === handLabel && drag.piece) {
      drag.piece.x = indexPx.x - drag.offsetX;
      drag.piece.y = indexPx.y - drag.offsetY;
    }
  } else {
    if (drag.activeHand === handLabel && drag.piece) {
      const piece = drag.piece;
      piece.dragging = false;
      if (isNearOwnCell(piece, puzzle.boardBox, puzzle.tileW, puzzle.tileH)) {
        snapPieceToCell(piece, puzzle.boardBox, puzzle.tileW, puzzle.tileH);
      } else {
        const box = puzzle.boardBox;
        const cx = piece.x + piece.w / 2;
        const cy = piece.y + piece.h / 2;
        const dropCol = Math.min(
          GRID - 1,
          Math.max(0, Math.floor((cx - box.x) / puzzle.tileW))
        );
        const dropRow = Math.min(
          GRID - 1,
          Math.max(0, Math.floor((cy - box.y) / puzzle.tileH))
        );

        piece.x = box.x + dropCol * puzzle.tileW;
        piece.y = box.y + dropRow * puzzle.tileH;
        piece.placed = (dropCol === piece.col && dropRow === piece.row);

        displaceCellOccupant(piece, dropRow, dropCol, box, puzzle.tileW, puzzle.tileH);
      }
      drag.activeHand = null;
      drag.piece = null;
      puzzle.solved = reconcilePlacedState(puzzle.boardBox, puzzle.tileW, puzzle.tileH);
      updateProgressBadge();
    }
  }
}

function clampPieceToBoard(piece) {
  const box = puzzle.boardBox;
  piece.x = Math.min(Math.max(piece.x, box.x), box.x + box.width - piece.w);
  piece.y = Math.min(Math.max(piece.y, box.y), box.y + box.height - piece.h);
}

function drawBoardAndPieces() {
  const box = puzzle.boardBox;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
  ctx.fillRect(box.x, box.y, box.width, box.height);

  ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      ctx.strokeRect(box.x + col * puzzle.tileW, box.y + row * puzzle.tileH, puzzle.tileW, puzzle.tileH);
    }
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(245,197,24,0.18)";
  ctx.lineWidth = 1;
  for (let i = 1; i < GRID; i++) {
    ctx.beginPath();
    ctx.moveTo(box.x + i * puzzle.tileW, box.y);
    ctx.lineTo(box.x + i * puzzle.tileW, box.y + box.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + i * puzzle.tileH);
    ctx.lineTo(box.x + box.width, box.y + i * puzzle.tileH);
    ctx.stroke();
  }
  ctx.restore();

  const sorted = [...puzzle.pieces].sort((a, b) => (a.dragging ? 1 : 0) - (b.dragging ? 1 : 0));

  for (const piece of sorted) {
    ctx.save();
    if (piece.dragging) {
      ctx.shadowColor = "rgba(245,197,24,0.9)";
      ctx.shadowBlur = 14;
    }
    ctx.drawImage(piece.canvas, piece.x, piece.y, piece.w, piece.h);
    ctx.strokeStyle = piece.placed ? "#5fae6e" : "rgba(234,229,214,0.5)";
    ctx.lineWidth = piece.dragging ? 3 : 1.5;
    ctx.strokeRect(piece.x, piece.y, piece.w, piece.h);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = puzzle.solved ? "#5fae6e" : "#f5c518";
  ctx.lineWidth = 3;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.restore();

  if (puzzle.solved) {
    ctx.save();
    ctx.fillStyle = "rgba(95,174,110,0.15)";
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.restore();
  }
}

function updateProgressBadge() {
  const puzzleSolvedBanner = document.getElementById("puzzleSolvedBanner");
  if (appState !== "puzzle") {
    progressBadge.classList.remove("visible", "solved");
    puzzleSolvedBanner.classList.add("hidden");
    return;
  }
  const placedCount = puzzle.pieces.filter((p) => p.placed).length;
  progressText.textContent = `${placedCount} / ${puzzle.pieces.length} pieces placed`;
  progressBadge.classList.add("visible");
  progressBadge.classList.toggle("solved", puzzle.solved);

  if (puzzle.solved) {
    puzzleSolvedBanner.classList.remove("hidden");
  } else {
    puzzleSolvedBanner.classList.add("hidden");
  }
}

function drawVideoFrame() {
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function applyBWInsideBox(box) {
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.min(canvas.width - x, Math.round(box.width));
  const h = Math.min(canvas.height - y, Math.round(box.height));
  if (w <= 0 || h <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.filter = getFilterString();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

  ctx.restore();
}

function drawLiveFrameOverlay(box) {
  ctx.save();
  ctx.strokeStyle = "#f5c518";
  ctx.lineWidth = 3;
  ctx.strokeRect(box.x, box.y, box.width, box.height);

  const cornerLen = 18;
  ctx.lineWidth = 4;
  const corners = [
    [box.x, box.y, 1, 1],
    [box.x + box.width, box.y, -1, 1],
    [box.x, box.y + box.height, 1, -1],
    [box.x + box.width, box.y + box.height, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + cornerLen * dy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + cornerLen * dx, cy);
    ctx.stroke();
  }
  ctx.restore();
}

function isPointInBoard(px, py, box) {
  if (!box) return false;
  return (
    px >= box.x &&
    px <= box.x + box.width &&
    py >= box.y &&
    py <= box.y + box.height
  );
}

function drawHandSkeleton(landmarksPx) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(255,255,255,0.85)";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = "white";
  ctx.lineWidth = 3;

  for (const [iA, iB] of HAND_CONNECTIONS) {
    const a = landmarksPx[iA];
    const b = landmarksPx[iB];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.shadowBlur = 6;
  ctx.fillStyle = "white";
  for (const p of landmarksPx) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawHandSkeletonsOverBoard(handsLandmarks, box) {
  if (!box || !handsLandmarks || handsLandmarks.length === 0) return;

  for (const lm of handsLandmarks) {
    const landmarksPx = lm.map((pt) => toPixel(mirrorLandmarkX(pt)));
    const overBoard = landmarksPx.some((p) => isPointInBoard(p.x, p.y, box));
    if (overBoard) {
      drawHandSkeleton(landmarksPx);
    }
  }
}

function startShatter(sourceCanvas, box) {
  const cols = SHATTER_COLS;
  const rows = SHATTER_ROWS;
  const fragW = sourceCanvas.width / cols;
  const fragH = sourceCanvas.height / rows;
  const fragments = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sx = col * fragW;
      const sy = row * fragH;

      const fragCanvas = document.createElement("canvas");
      fragCanvas.width = Math.ceil(fragW);
      fragCanvas.height = Math.ceil(fragH);
      fragCanvas.getContext("2d").drawImage(
        sourceCanvas,
        sx, sy, fragW, fragH,
        0, 0, fragCanvas.width, fragCanvas.height
      );

      const cx = box.x + sx + fragW / 2;
      const cy = box.y + sy + fragH / 2;

      const boardCx = box.x + box.width / 2;
      const boardCy = box.y + box.height / 2;
      const dirX = cx - boardCx;
      const dirY = cy - boardCy;
      const dirLen = Math.max(1, Math.hypot(dirX, dirY));
      const speed = 90 + Math.random() * 160;

      fragments.push({
        canvas: fragCanvas,
        x: cx,
        y: cy,
        w: fragW,
        h: fragH,
        vx: (dirX / dirLen) * speed + (Math.random() - 0.5) * 40,
        vy: (dirY / dirLen) * speed + (Math.random() - 0.5) * 40 - 60,
        rotation: 0,
        rotationSpeed: (Math.random() - 0.5) * 6,
        gravity: 220 + Math.random() * 80,
      });
    }
  }

  shatter.fragments = fragments;
  shatter.active = true;
  shatter.startedAt = performance.now();
  appState = "shattering";
}

function updateAndDrawShatter() {
  const elapsedMs = performance.now() - shatter.startedAt;
  const t = Math.min(1, elapsedMs / SHATTER_DURATION_MS);

  if (t >= 1) {
    finishShatter();
    return;
  }

  const dt = 1 / 60;
  const fadeStart = 0.45;

  ctx.save();
  for (const frag of shatter.fragments) {
    frag.x += frag.vx * dt;
    frag.y += frag.vy * dt;
    frag.vy += frag.gravity * dt;
    frag.rotation += frag.rotationSpeed * dt;

    const alpha = t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / (1 - fadeStart));
    const scale = 1 - t * 0.25;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(frag.x, frag.y);
    ctx.rotate(frag.rotation);
    ctx.scale(scale, scale);
    ctx.drawImage(frag.canvas, -frag.w / 2, -frag.h / 2, frag.w, frag.h);
    ctx.restore();
  }
  ctx.restore();
}

function finishShatter() {
  shatter.active = false;
  shatter.fragments = [];
  if (shatter.pendingCanvas) {
    addToGallery(shatter.pendingCanvas);
    shatter.pendingCanvas = null;
  }

  if (appState !== "edit_photo") {
    resetPuzzleOnly();
  }
}

function handleFistReset() {
  if (appState !== "puzzle") {
    statusText.textContent = "reset (fist)";
    resetPuzzleOnly();
    return;
  }

  const reallySolved = reconcilePlacedState(puzzle.boardBox, puzzle.tileW, puzzle.tileH);
  puzzle.solved = reallySolved;

  if (reallySolved && puzzle.fullPhotoboothCanvas) {
    shatter.pendingCanvas = puzzle.fullPhotoboothCanvas;
    startShatter(puzzle.fullPhotoboothCanvas, puzzle.boardBox);
  } else {
    statusText.textContent = "reset (fist)";
    resetPuzzleOnly();
  }
}

let handLandmarker = null;
let visionInstance = null;
let fistHoldCounter = 0;

function processResults(result) {
  if (appState === "edit_photo" || appState === "welcome") {
    return;
  }

  if (appState === "shattering") {
    updateAndDrawShatter();
    statusText.textContent = "saving…";
    return;
  }

  const handsLandmarks = result.landmarks || [];
  const noHands = handsLandmarks.length === 0;

  if (noHands) {
    statusDot.className = puzzle.solved ? "status-dot solved" : "status-dot";
    fistHoldCounter = 0;
    freezeGate.holding = false;

    // [MOBILE] jangan lepas kepingan yang sedang digeser dengan jari/mouse
    if (drag.activeHand && drag.activeHand !== "touch" && drag.piece) {
      handleDragForHand(drag.activeHand, false, { x: drag.piece.x, y: drag.piece.y });
    }

    if (appState === "tracking") {
      const sinceLastSeen = performance.now() - lastSeenFrame.at;
      if (lastSeenFrame.box && sinceLastSeen < FRAME_GRACE_MS) {
        applyBWInsideBox(lastSeenFrame.box);
        drawLiveFrameOverlay(lastSeenFrame.box);
      }
      statusText.textContent = isStripFull()
        ? "gallery full - download or reset to continue"
        : "searching for hands…";
      return;
    }

    if (appState === "countdown") {
      drawCountdownOverlay(puzzle.boardBox);
      return;
    }

    if (appState === "puzzle") {
      puzzle.solved = reconcilePlacedState(puzzle.boardBox, puzzle.tileW, puzzle.tileH);
      updateProgressBadge();
      drawBoardAndPieces();
      statusText.textContent = puzzle.solved
        ? "puzzle selesai! kepalkan tangan untuk menyimpan"
        : "susun puzzle menggunakan gestur pinch";
      return;
    }

    return;
  }

  statusDot.className = puzzle.solved ? "status-dot solved" : "status-dot live";

  const anyFist = handsLandmarks.some((lm) => isFist(lm));
  const draggingNow = drag.activeHand !== null && drag.piece !== null;
  if (anyFist && !draggingNow && appState !== "tracking") {
    fistHoldCounter++;
    if (fistHoldCounter >= FIST_HOLD_FRAMES) {
      fistHoldCounter = 0;
      handleFistReset();
      return;
    }
  } else {
    fistHoldCounter = 0;
  }

  if (appState === "tracking") {
    if (isStripFull()) {
      statusText.textContent = "galeri penuh — unduh atau reset untuk lanjut";
      return;
    }
    if (handsLandmarks.length === 2) {
      const [handA, handB] = handsLandmarks;
      const indexA = mirrorLandmarkX(handA[LM.INDEX_TIP]);
      const indexB = mirrorLandmarkX(handB[LM.INDEX_TIP]);
      const frameBox = computeHandFrame(indexA, indexB);

      if (frameBox.width > 4 && frameBox.height > 4) {
        applyBWInsideBox(frameBox);
        drawLiveFrameOverlay(frameBox);
        lastSeenFrame.box = frameBox;
        lastSeenFrame.at = performance.now();
      }

      const bothPinching = isPinching(handA, "A") && isPinching(handB, "B");
      if (bothPinching && frameBox.width > 40 && frameBox.height > 40) {
        if (!freezeGate.holding) {
          freezeGate.holding = true;
          freezeGate.since = performance.now();
        }
        statusDot.className = "status-dot armed";
        statusText.textContent = "tahan gestur pinch…";

        if (performance.now() - freezeGate.since > FREEZE_HOLD_MS) {
          freezeGate.holding = false;
          startCountdown(frameBox);
        }
      } else {
        freezeGate.holding = false;
        statusText.textContent = "tangan terdeteksi";
      }
    } else {
      freezeGate.holding = false;
      const sinceLastSeen = performance.now() - lastSeenFrame.at;
      if (lastSeenFrame.box && sinceLastSeen < FRAME_GRACE_MS) {
        applyBWInsideBox(lastSeenFrame.box);
        drawLiveFrameOverlay(lastSeenFrame.box);
        statusText.textContent = "tangan terdeteksi";
      } else {
        statusText.textContent = "tangan terdeteksi";
      }
    }
    return;
  }

  if (appState === "countdown") {
    drawCountdownOverlay(puzzle.boardBox);
    return;
  }

  if (appState === "puzzle") {
    const labelsPresent = new Set();
    const handedness = result.handedness || [];

    handsLandmarks.forEach((lm, i) => {
      const label = handedness[i] && handedness[i][0] ? handedness[i][0].categoryName : (i === 0 ? "Left" : "Right");
      labelsPresent.add(label);
      const pinching = isPinching(lm, label);
      const indexPx = toPixel(mirrorLandmarkX(lm[LM.INDEX_TIP]));
      handleDragForHand(label, pinching, smoothPoint(label, indexPx, pinching));
    });

    // [MOBILE] jangan lepas kepingan yang sedang digeser dengan jari/mouse
    if (drag.activeHand && drag.activeHand !== "touch" && !labelsPresent.has(drag.activeHand) && drag.piece) {
      handleDragForHand(drag.activeHand, false, { x: drag.piece.x, y: drag.piece.y });
    }

    if (!drag.piece) {
      puzzle.solved = reconcilePlacedState(puzzle.boardBox, puzzle.tileW, puzzle.tileH);
      updateProgressBadge();
    }

    drawBoardAndPieces();
    drawHandSkeletonsOverBoard(handsLandmarks, puzzle.boardBox);

    statusText.textContent = puzzle.solved
      ? (fistHoldCounter > 0
        ? `menyimpan… tahan kepalan tangan (${fistHoldCounter}/${FIST_HOLD_FRAMES})`
        : "puzzle selesai! kepalkan tangan untuk menyimpan")
      : "susun puzzle menggunakan gestur pinch";
  }
}

let lastDetectTime = 0;
let loopRunning = false;
let currentLandmarks = [];
let currentHandedness = [];

function renderLoop() {
  if (!loopRunning) return;
  const activeStates = ["tracking", "countdown", "freeze", "puzzle", "shattering"];

  if (activeStates.includes(appState) && videoEl.readyState >= 2) {
    // Always draw the video frame so the camera preview never freezes
    drawVideoFrame();

    if (handLandmarker) {
      const nowMs = performance.now();

      // Throttle AI detection to ~30 FPS (every 30ms) for ultra smooth mobile performance
      if (nowMs - lastDetectTime >= 30) {
        lastDetectTime = nowMs;
        try {
          const result = handLandmarker.detectForVideo(videoEl, nowMs);
          currentLandmarks = result.landmarks || [];
          currentHandedness = result.handedness || [];
        } catch (detectErr) {
          console.error("[PuzzleCam] Detection error:", detectErr);
          if (detectErr.message && (detectErr.message.includes("activeTexture") || detectErr.message.includes("WebGL"))) {
            fallbackToCPU();
          }
        }
      }

      // Always run game logic & rendering every frame using the latest landmarks
      // This prevents the canvas from flickering when the AI detection is throttled
      processResults({ landmarks: currentLandmarks, handedness: currentHandedness });
    }
  }

  requestAnimationFrame(renderLoop);
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.style.display = "block";
}

function showLoaderError(message) {
  loaderText.textContent = message;
  loaderText.style.color = "#e0533d";
  loaderRetry.classList.remove("hidden");
}

function resetLoaderUI() {
  loadingOverlay.classList.remove("hidden");
  loaderText.style.color = "";
  loaderText.textContent = "memuat model HandLandmarker…";
  loaderRetry.classList.add("hidden");
  errorBanner.style.display = "none";
}

async function boot() {
  resetLoaderUI();

  let settled = false;
  const watchdogMs = (LOAD_TIMEOUT_MS * 2) + 5000;
  const watchdog = setTimeout(() => {
    if (!settled) {
      showLoaderError("Loading process took too long. Click try again or check your connection.");
    }
  }, watchdogMs);

  try {
    if (!videoEl.srcObject) {
      await initWebcam();
    }

    if (!handLandmarker) {
      handLandmarker = await initHandLandmarker();
    }

    settled = true;
    clearTimeout(watchdog);
    loadingOverlay.classList.add("hidden");
    const progressOverlay = document.getElementById("progressOverlay");
    if (progressOverlay) progressOverlay.style.display = "flex";
    statusText.textContent = "siap";
    setupMobileUI(); // [MOBILE]

    if (!loopRunning) {
      loopRunning = true;
      requestAnimationFrame(renderLoop);
    }
  } catch (err) {
    settled = true;
    clearTimeout(watchdog);
    if (err && err.name === "NotAllowedError") {
      showLoaderError("Camera permission denied. Enable it in browser settings and click try again.");
    } else if (err && err.name === "NotFoundError") {
      showLoaderError("No webcam found.");
    } else {
      showLoaderError((err && err.message) || "Failed to start application.");
    }
  }
}

loaderRetry.addEventListener("click", () => {
  boot();
});

if (downloadStripBtn) {
  downloadStripBtn.addEventListener("click", downloadPhotoStrip);
  updateStripDownloadAvailability();
}

if (resetAllBtn) {
  resetAllBtn.addEventListener("click", () => {
    const confirmed = window.confirm(
      "Are you sure you want to delete all photos in the gallery and start over?"
    );
    if (confirmed) resetEverything();
  });
}

// ================= WELCOME SCREEN LOGIC =================
let selectedFilter = 'none';
let currentLayout = '3';

const filterBtns = document.querySelectorAll('.filter-btn');
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => {
      b.classList.remove('bg-on-surface-variant', 'text-white', 'border-transparent');
      b.classList.add('bg-surface-container-highest', 'text-on-surface', 'border-outline/20');
    });
    btn.classList.add('bg-on-surface-variant', 'text-white', 'border-transparent');
    btn.classList.remove('bg-surface-container-highest', 'text-on-surface', 'border-outline/20');
    selectedFilter = btn.getAttribute('data-filter');
  });
});

const gridBtns = document.querySelectorAll('.grid-btn');
gridBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    gridBtns.forEach(b => {
      b.classList.remove('border-primary', 'shadow-lg');
      b.classList.add('border-outline-variant/20', 'shadow-sm');
      b.querySelector('.active-indicator').classList.add('opacity-0');
      b.querySelector('.active-indicator').classList.remove('opacity-100');
    });
    btn.classList.add('border-primary', 'shadow-lg');
    btn.classList.remove('border-outline-variant/20', 'shadow-sm');
    btn.querySelector('.active-indicator').classList.remove('opacity-0');
    btn.querySelector('.active-indicator').classList.add('opacity-100');
    GRID = parseInt(btn.getAttribute('data-grid'));
    SHATTER_COLS = GRID * 2;
    SHATTER_ROWS = GRID * 2;
  });
});

const layoutBtns = document.querySelectorAll('.layout-btn');
layoutBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    layoutBtns.forEach(b => {
      b.classList.remove('border-primary', 'shadow-lg');
      b.classList.add('border-outline-variant/20', 'shadow-sm');
      b.querySelector('.active-indicator').classList.add('opacity-0');
      b.querySelector('.active-indicator').classList.remove('opacity-100');
    });
    btn.classList.add('border-primary', 'shadow-lg');
    btn.classList.remove('border-outline-variant/20', 'shadow-sm');
    btn.querySelector('.active-indicator').classList.remove('opacity-0');
    btn.querySelector('.active-indicator').classList.add('opacity-100');
    currentLayout = btn.getAttribute('data-layout');
    STRIP_MAX_PHOTOS = parseInt(currentLayout);
    galleryCount.textContent = `0 / ${STRIP_MAX_PHOTOS}`;
  });
});

// ================= PANDUAN GESTUR TANGAN (popup saat START) =================
// Popup ini selalu muncul sebelum kamera menyala dan hanya membahas gestur tangan.
// Cara bermain lengkap (komputer & HP) ada di panduan "Rules" / ikon "?" (lihat openRules).
function updateTutorialText() {
  const root = document.getElementById('tutorialScreen');
  if (!root) return;

  const texts = [
    'Buat bingkai dengan kedua telunjuk, lalu cubit (Pinch) dengan kedua tangan dan tahan sebentar. Foto diambil setelah hitung mundur.',
    'Cubit (Pinch) kepingan lalu geser tanganmu untuk memindahkannya ke posisi yang benar. Lepas cubitan untuk menaruhnya.',
    'Kepalkan tangan (Fist) dan tahan sebentar untuk menyimpan hasil karyamu ke galeri.',
  ];

  root.querySelectorAll('.gap-6 > div').forEach((row, i) => {
    const p = row.querySelector('p');
    if (p && texts[i]) p.textContent = texts[i];
  });

  // Di HP gestur bersifat opsional: arahkan ke panduan bermain
  if (IS_MOBILE && !document.getElementById('tutorialMobileNote')) {
    const stepsBox = root.querySelector('.gap-6');
    if (stepsBox) {
      const note = document.createElement('p');
      note.id = 'tutorialMobileNote';
      note.style.cssText =
        "margin-top:20px;font:600 12px 'Nunito Sans',sans-serif;color:#504444;opacity:.85;";
      note.textContent =
        'Di HP, gestur ini opsional. Kamu juga bisa memakai tombol dan sentuhan layar. Ketuk ikon ? untuk panduan bermain.';
      stepsBox.insertAdjacentElement('afterend', note);
    }
  }
}

function startCameraFlow() {
  document.getElementById('tutorialScreen').style.display = 'none';

  if (window.navigateToScreen) {
    window.navigateToScreen('app');
  } else {
    document.getElementById('welcomeScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
  }

  appState = 'tracking';
  boot();
}

// ---- Popup gestur selalu tampil saat START; Rules / ikon "?" membuka panduan bermain lengkap ----
let tutorialMode = 'start'; // 'start' = lanjut menyalakan kamera, 'info' = hanya membaca
const tutorialGotItBtn = document.getElementById('tutorialGotItBtn');
const tutorialScreenEl = document.getElementById('tutorialScreen');
const tutorialStartLabel = tutorialGotItBtn
  ? tutorialGotItBtn.textContent.trim()
  : 'Got it, Start Camera!';
let rulesScreenEl = null;

function isTutorialOpen() {
  const isOpen = (el) => !!el && el.style.display === 'flex';
  return isOpen(tutorialScreenEl) || isOpen(rulesScreenEl);
}

function openTutorial(mode) {
  tutorialMode = mode;
  updateTutorialText();
  if (tutorialGotItBtn) {
    tutorialGotItBtn.textContent = mode === 'start' ? tutorialStartLabel : 'Mengerti';
  }
  tutorialScreenEl.style.display = 'flex';
}

document.getElementById('startBtn').addEventListener('click', () => {
  openTutorial('start'); // selalu tampil sebelum kamera menyala
});

if (tutorialGotItBtn) {
  tutorialGotItBtn.addEventListener('click', () => {
    if (tutorialMode === 'start') {
      startCameraFlow();
    } else {
      tutorialScreenEl.style.display = 'none';
    }
  });
}

// Mode baca saja: mengetuk latar gelap juga menutup popup gestur
if (tutorialScreenEl) {
  tutorialScreenEl.addEventListener('click', (e) => {
    if (e.target === tutorialScreenEl && tutorialMode === 'info') {
      tutorialScreenEl.style.display = 'none';
    }
  });
}

// ---- Panduan Bermain (Rules): cara bermain lengkap untuk komputer dan HP ----
function closeRules() {
  if (rulesScreenEl) rulesScreenEl.style.display = 'none';
}

function buildRulesScreen() {
  if (rulesScreenEl) return rulesScreenEl;

  const el = document.createElement('div');
  el.id = 'rulesScreen';
  el.style.cssText =
    'position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,.8);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:16px;';
  el.innerHTML = `
    <div id="rulesCard" style="position:relative;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;
      background:rgba(251,249,245,.97);border:1px solid rgba(130,116,115,.25);border-radius:24px;
      padding:28px 24px 22px;box-shadow:0 20px 50px rgba(0,0,0,.35);">
      <button id="rulesCloseX" type="button" title="Tutup"
        style="position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:9999px;border:none;
        background:#efeeea;cursor:pointer;display:flex;align-items:center;justify-content:center;">
        <span class="material-symbols-outlined" style="font-size:20px;color:#504444;">close</span>
      </button>
      <h2 style="margin:0 0 4px;font:700 24px 'Courier Prime',monospace;color:#7b5455;text-align:center;">Panduan Bermain</h2>
      <p style="margin:0 0 22px;font:400 13px 'Nunito Sans',sans-serif;color:#504444;text-align:center;">Dari memotret sampai menyimpan hasilnya.</p>
      <div id="rulesBody"></div>
      <button id="rulesOkBtn" type="button"
        style="width:100%;padding:12px 0;border:none;border-radius:9999px;background:#446279;color:#fff;
        font:700 15px 'Courier Prime',monospace;cursor:pointer;touch-action:manipulation;">Mengerti</button>
      <button id="rulesGestureBtn" type="button"
        style="display:block;margin:12px auto 0;padding:6px 10px;border:none;background:none;color:#7b5455;
        font:600 12px 'Nunito Sans',sans-serif;text-decoration:underline;cursor:pointer;">Lihat panduan gestur tangan</button>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener('click', (e) => {
    if (e.target === el) closeRules();
  });
  el.querySelector('#rulesCloseX').addEventListener('click', closeRules);
  el.querySelector('#rulesOkBtn').addEventListener('click', closeRules);
  el.querySelector('#rulesGestureBtn').addEventListener('click', () => {
    closeRules();
    openTutorial('info');
  });

  rulesScreenEl = el;
  return el;
}

function openRules() {
  const el = buildRulesScreen();
  const n = STRIP_MAX_PHOTOS;

  const lbl = (t) => `<b style="color:#446279;">${t}</b>`;
  // Urutan menyesuaikan perangkat yang sedang dipakai
  const pair = (komputer, hp) =>
    IS_MOBILE
      ? `${lbl('HP:')} ${hp}<br>${lbl('Komputer:')} ${komputer}`
      : `${lbl('Komputer:')} ${komputer}<br>${lbl('HP:')} ${hp}`;
  const step = (num, title, body) => `
    <div style="display:flex;gap:14px;margin-bottom:18px;">
      <div style="flex:0 0 28px;height:28px;border-radius:9999px;background:#7b5455;color:#fff;
        font:700 14px 'Courier Prime',monospace;display:flex;align-items:center;justify-content:center;">${num}</div>
      <div style="flex:1;min-width:0;">
        <div style="font:700 15px 'Nunito Sans',sans-serif;color:#1b1c1a;margin-bottom:4px;">${title}</div>
        <div style="font:400 13px/1.6 'Nunito Sans',sans-serif;color:#504444;">${body}</div>
      </div>
    </div>`;

  const tips =
    `<div style="margin:4px 0 20px;padding:12px 14px;border-radius:12px;background:#efeeea;
      font:400 12px/1.5 'Nunito Sans',sans-serif;color:#504444;">
      <b>Tips:</b> pastikan cahaya cukup. Di komputer, pastikan seluruh tangan terlihat oleh kamera.
      Di HP, sandarkan perangkat agar kedua tangan bebas.</div>`;

  el.querySelector('#rulesBody').innerHTML =
    [
      step(1, 'Atur sesi',
        'Pilih layout (2, 3, atau 4 foto), ukuran puzzle (3 x 3 atau 4 x 4), dan filter, lalu tekan START CREATING.'),
      step(2, 'Ambil foto',
        pair('buat bingkai dengan kedua telunjuk, lalu cubit dengan kedua tangan dan tahan sebentar.',
          'ketuk tombol Ambil Foto, lalu bergaya selama hitung mundur 5 detik.')),
      step(3, 'Susun puzzle',
        'Foto dipecah dan diacak. Kepingan yang tepat akan terkunci dengan bingkai hijau.<br>' +
        pair('cubit lalu geser kepingan, atau seret dengan mouse.', 'geser kepingan dengan jari.')),
      step(4, 'Simpan atau ulang',
        'Setelah puzzle selesai:<br>' +
        pair('kepalkan tangan dan tahan untuk menyimpan.', 'ketuk Simpan.') +
        '<br>Ingin mengambil ulang foto?<br>' +
        pair('kepalkan tangan sebelum puzzle selesai.', 'ketuk Ulang.')),
      step(5, 'Ulangi sampai penuh',
        `Ulangi langkah 2 sampai 4 sampai ${n} foto terkumpul. Di HP, ketuk penghitung foto di atas layar untuk melihat foto sebelumnya.`),
      step(6, 'Hias dan simpan',
        'Di editor: pilih warna dan gaya bingkai (polkadot, gingham, hati, dan lainnya), tempel stiker (ketuk stiker di foto lalu pilih warnanya), tulis memory log, ' +
        'dan seret stiker ke tempat sampah untuk menghapusnya. Tekan Save Photo untuk mengunduh.'),
    ].join('') + tips;

  el.style.display = 'flex';
  const card = el.querySelector('#rulesCard');
  if (card) card.scrollTop = 0;
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeRules();
  if (tutorialMode === 'info' && tutorialScreenEl) tutorialScreenEl.style.display = 'none';
});

// Tombol untuk membuka panduan bermain kapan saja
function setupHelpButtons() {
  // 1. Tombol "Rules" di header layar pemilihan (sebelumnya belum berfungsi)
  const rulesBtn = document.querySelector('#welcomeScreen nav button');
  if (rulesBtn) rulesBtn.addEventListener('click', openRules);

  // 2. Ikon "?" di header layar pemilihan, khusus HP (menu "Rules" disembunyikan di layar kecil)
  const headerRow = document.querySelector('#welcomeScreen header > div');
  if (headerRow) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = 'Panduan bermain';
    b.className =
      'md:hidden flex items-center justify-center w-10 h-10 rounded-full bg-surface-container-highest text-on-surface-variant';
    b.innerHTML = '<span class="material-symbols-outlined">help_outline</span>';
    b.addEventListener('click', openRules);
    headerRow.appendChild(b);
  }

  // 3. Ikon "?" di layar permainan, di samping tombol fullscreen
  const fsBtn = document.getElementById('fullscreenBtn');
  if (fsBtn) {
    const h = document.createElement('button');
    h.type = 'button';
    h.title = 'Panduan bermain';
    h.className =
      'pointer-events-auto bg-white/90 h-7 w-7 rounded-full shadow-sm flex items-center justify-center text-primary hover:bg-white transition-transform hover:scale-105 active:scale-95';
    h.innerHTML = '<span class="material-symbols-outlined text-[14px]">help_outline</span>';
    h.addEventListener('click', openRules);
    fsBtn.insertAdjacentElement('afterend', h);
  }
}
setupHelpButtons();

// ---- Landing page: "How it Works" disesuaikan dengan cara kerja aplikasi yang sebenarnya ----
// (teks bawaan di index.html membahas unggah foto dan ekspor PDF, yang tidak ada di aplikasi ini)
function updateHowItWorks() {
  const sec = document.getElementById('how-it-works');
  if (!sec) return;

  const title = sec.querySelector('h2');
  if (title && title.nextElementSibling) {
    title.nextElementSibling.textContent = 'Three simple steps from camera to keepsake.';
  }

  const steps = [
    {
      icon: 'photo_camera',
      title: 'Capture the Moment',
      text: 'Frame your shot with both hands in front of the camera and pinch to snap, or just tap the capture button on your phone. Hold still for the countdown.',
    },
    {
      icon: 'extension',
      title: 'Solve the Puzzle',
      text: 'Your photo breaks into shuffled pieces. Drag them back into place with a hand pinch, or simply slide them with your finger.',
    },
    {
      icon: 'auto_fix_high',
      title: 'Decorate & Save',
      text: 'Pick a frame color and style, add stickers in any color, write a little memory log, then download your finished photo strip.',
    },
  ];

  sec.querySelectorAll('.space-y-24 > div').forEach((row, i) => {
    const step = steps[i];
    if (!step) return;
    const h3 = row.querySelector('h3');
    const p = row.querySelector('p');
    const icon = row.querySelector('.material-symbols-outlined');
    if (h3) h3.textContent = step.title;
    if (p) p.textContent = step.text;
    if (icon) icon.textContent = step.icon;
  });
}
updateHowItWorks();

function getFilterString() {
  if (selectedFilter === 'bw') {
    return 'grayscale(100%) contrast(120%)';
  } else if (selectedFilter === 'vintage') {
    return 'sepia(50%) contrast(120%) saturate(80%)';
  } else if (selectedFilter === 'korean') {
    return 'brightness(110%) contrast(90%) saturate(110%) sepia(10%)';
  } else if (selectedFilter === 'warm') {
    return 'sepia(30%) saturate(140%) hue-rotate(-10deg)';
  } else if (selectedFilter === 'cool') {
    return 'saturate(110%) contrast(100%) hue-rotate(180deg) brightness(105%)';
  } else {
    return 'none';
  }
}

// ================= EDIT PHOTO SCREEN LOGIC =================
let currentEditCanvas = null;
let currentBorderColor = '#ffffff';
let placedStickers = [];

// Tambahan warna bingkai pastel (HTML hanya punya 5 warna); ditambahkan sebelum tombol dikumpulkan
(function addExtraBorderColors() {
  const container = document.getElementById('borderOptions');
  if (!container) return;
  [
    ['#cfe8d5', 'Mint'],
    ['#d9ccf0', 'Lavender'],
    ['#fbe9a6', 'Butter'],
    ['#ffd2b8', 'Peach'],
    ['#e8a6c4', 'Bubblegum'],
  ].forEach(([color, name]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className =
      'border-btn w-10 h-10 rounded-full border-2 border-transparent shadow-sm hover:scale-110 transition-transform active:scale-95';
    b.style.backgroundColor = color;
    b.setAttribute('data-border', color);
    b.title = name;
    container.appendChild(b);
  });
})();

const borderBtns = document.querySelectorAll('.border-btn');
borderBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    borderBtns.forEach(b => b.classList.remove('border-primary'));
    borderBtns.forEach(b => b.classList.add('border-transparent'));

    if (btn.getAttribute('data-border') === '#ffffff') {
      btn.classList.add('border-primary');
      btn.classList.remove('border-transparent');
    } else {
      btn.classList.remove('border-transparent');
      btn.classList.add('border-primary');
    }

    currentBorderColor = btn.getAttribute('data-border');
    renderFrameStylePreviews();
    redrawEditCanvas();
  });
});

const stickerBtns = document.querySelectorAll('.sticker-btn');
stickerBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!currentEditCanvas) return;
    const emoji = btn.textContent.trim();
    const x = currentEditCanvas.width / 2 + (Math.random() - 0.5) * 200;
    const y = currentEditCanvas.height / 2 + (Math.random() - 0.5) * 200;

    // Tiap stiker punya warna sendiri: warna pilihan di palet, atau warna asli tombolnya
    const iconEl = btn.querySelector('.material-symbols-outlined');
    const baseColor = iconEl ? getComputedStyle(iconEl).color : '#7b5455';
    placedStickers.push({ emoji, x, y, size: 80, baseColor, color: currentStickerColor || baseColor });
    setSelectedSticker(placedStickers.length - 1);
  });
});

// ================= WARNA STIKER =================
// Warna stiker tidak lagi mengikuti warna bingkai. Setiap stiker punya warna sendiri,
// bisa diganti lewat palet: ketuk stiker di foto untuk memilihnya, lalu pilih warna.
let selectedStickerIndex = -1;
let currentStickerColor = null; // null = pakai warna asli tombol stiker ("Auto")
const STICKER_COLORS = [
  '#7b5455', '#446279', '#5e604d', '#ff9800', '#e0533d',
  '#5fae6e', '#f4c2c2', '#f5c518', '#ffffff', '#1b1c1a',
];

function syncStickerColorUI() {
  const bar = document.getElementById('stickerColorBar');
  if (!bar) return;
  const s = placedStickers[selectedStickerIndex];
  let active;
  if (s) {
    active = s.color === s.baseColor ? 'auto' : String(s.color).toLowerCase();
  } else {
    active = currentStickerColor ? currentStickerColor.toLowerCase() : 'auto';
  }
  bar.querySelectorAll('[data-color]').forEach((el) => {
    el.style.boxShadow = el.dataset.color === active
      ? '0 0 0 2px #fbf9f5, 0 0 0 4px #446279'
      : 'none';
  });
  const hint = document.getElementById('stickerColorHint');
  if (hint) hint.textContent = s ? '(stiker terpilih)' : '(untuk stiker berikutnya)';
}

function setSelectedSticker(i) {
  selectedStickerIndex = i;
  syncStickerColorUI();
  redrawEditCanvas();
}

// color = string warna, atau null untuk kembali ke warna asli stiker
function applyStickerColor(color) {
  currentStickerColor = color;
  const s = placedStickers[selectedStickerIndex];
  if (s) s.color = color || s.baseColor;
  syncStickerColorUI();
  redrawEditCanvas();
}

function setupStickerColorPicker() {
  const firstBtn = document.querySelector('.sticker-btn');
  const grid = firstBtn && firstBtn.parentElement;
  if (!grid || document.getElementById('stickerColorBar')) return;

  const bar = document.createElement('div');
  bar.id = 'stickerColorBar';
  bar.style.cssText = 'margin-top:16px;padding-top:14px;border-top:1px dashed #d4c2c2;';

  const title = document.createElement('div');
  title.style.cssText = "font:700 13px 'Nunito Sans',sans-serif;color:#7b5455;margin-bottom:10px;";
  title.innerHTML =
    'Sticker Color <span id="stickerColorHint" style="font-weight:400;font-size:11px;opacity:.65;"></span>';
  bar.appendChild(title);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-items:center;';
  bar.appendChild(row);

  const autoBtn = document.createElement('button');
  autoBtn.type = 'button';
  autoBtn.dataset.color = 'auto';
  autoBtn.title = 'Warna asli stiker';
  autoBtn.textContent = 'Auto';
  autoBtn.style.cssText =
    "height:30px;padding:0 12px;border-radius:9999px;border:1px solid rgba(0,0,0,.25);" +
    "background:#fff;color:#504444;font:700 12px 'Nunito Sans',sans-serif;cursor:pointer;touch-action:manipulation;";
  autoBtn.addEventListener('click', () => applyStickerColor(null));
  row.appendChild(autoBtn);

  STICKER_COLORS.forEach((color) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.color = color;
    b.title = color;
    b.style.cssText =
      `width:30px;height:30px;border-radius:9999px;background:${color};` +
      'border:1px solid rgba(0,0,0,.25);cursor:pointer;touch-action:manipulation;';
    b.addEventListener('click', () => applyStickerColor(color));
    row.appendChild(b);
  });

  // Pemilih warna bebas
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.value = '#7b5455';
  custom.title = 'Warna lain';
  custom.style.cssText =
    'width:34px;height:30px;padding:0;border:1px solid rgba(0,0,0,.25);border-radius:6px;background:none;cursor:pointer;';
  custom.addEventListener('input', () => applyStickerColor(custom.value));
  row.appendChild(custom);

  grid.insertAdjacentElement('afterend', bar);
  syncStickerColorUI();
}
setupStickerColorPicker();

// ================= BINGKAI (FRAME) AESTHETIC =================
// Selain warna, bingkai punya gaya (polkadot, gingham, hati, bintang, bunga, ...) dan hiasan
// (jahitan, pita). Semuanya digambar dengan path kanvas, tanpa gambar eksternal.
let currentFrameStyle = 'solid';
let frameStitch = false;
let frameTape = false;

function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// t = 0 -> warna asli, t = 1 -> warna "other"
function mixHex(hex, other, t) {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  const m = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${m(a.r, b.r)},${m(a.g, b.g)},${m(a.b, b.b)})`;
}

function colorLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Warna motif: lebih gelap di bingkai terang, lebih terang di bingkai gelap
function frameAccent(base) {
  return colorLuminance(base) > 0.75 ? mixHex(base, '#7b5455', 0.4) : mixHex(base, '#ffffff', 0.55);
}

function pathHeart(ctx, cx, cy, size) {
  const s = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.4, cy + s * 0.1, cx - s * 1.0, cy - s * 1.0, cx, cy - s * 0.35);
  ctx.bezierCurveTo(cx + s * 1.0, cy - s * 1.0, cx + s * 1.4, cy + s * 0.1, cx, cy + s * 0.9);
  ctx.closePath();
}

function pathStar(ctx, cx, cy, r, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inner;
    const ang = -Math.PI / 2 + (i * Math.PI) / points;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawDaisy(ctx, cx, cy, r, petalColor, centerColor) {
  ctx.fillStyle = petalColor;
  for (let i = 0; i < 5; i++) {
    const ang = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * r * 0.6, cy + Math.sin(ang) * r * 0.6, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = centerColor;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function pathRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Menjalankan fn(x, y) di titik-titik berselang-seling (susunan batu bata) yang menutupi kanvas
function eachStaggered(w, h, step, fn) {
  for (let row = 0, y = step / 2; y < h + step; row++, y += step) {
    const off = row % 2 ? step / 2 : 0;
    for (let x = off + step / 2; x < w + step; x += step) fn(x, y);
  }
}

// Menggambar motif bingkai di seluruh kanvas (foto digambar di atasnya, jadi motif tampak di tepi)
function drawFramePattern(ctx, w, h, base, style, scale = 1) {
  if (!style || style === 'solid') return;
  const s = scale;
  const accent = frameAccent(base);
  ctx.save();
  switch (style) {
    case 'dots': {
      ctx.fillStyle = accent;
      eachStaggered(w, h, 34 * s, (x, y) => {
        ctx.beginPath();
        ctx.arc(x, y, 7 * s, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    case 'gingham': {
      const cell = 26 * s;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.35;
      for (let y = 0, i = 0; y < h; y += cell, i++) {
        if (i % 2 === 0) ctx.fillRect(0, y, w, cell);
      }
      for (let x = 0, i = 0; x < w; x += cell, i++) {
        if (i % 2 === 0) ctx.fillRect(x, 0, cell, h);
      }
      break;
    }
    case 'stripes': {
      const band = 20 * s;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.45;
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 4);
      const len = Math.hypot(w, h);
      for (let x = -len; x < len; x += band * 2) ctx.fillRect(x, -len, band, len * 2);
      break;
    }
    case 'hearts': {
      ctx.fillStyle = accent;
      eachStaggered(w, h, 46 * s, (x, y) => {
        pathHeart(ctx, x, y, 18 * s);
        ctx.fill();
      });
      break;
    }
    case 'stars': {
      const step = 54 * s;
      eachStaggered(w, h, step, (x, y) => {
        ctx.fillStyle = accent;
        pathStar(ctx, x, y, 12 * s);
        ctx.fill();
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(x + step / 2, y, 3 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      });
      break;
    }
    case 'flowers': {
      eachStaggered(w, h, 58 * s, (x, y) => {
        drawDaisy(ctx, x, y, 14 * s, accent, '#f5c518');
      });
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

// Pita memilih warna yang kontras dengan bingkai agar selalu terlihat
const TAPE_CANDIDATES = ['#f4a6b8', '#abcae5', '#f7d774', '#a8d8b9', '#c3b1e1', '#ffbf9b', '#7b5455', '#446279'];

function colorDistance(h1, h2) {
  const a = hexToRgb(h1);
  const b = hexToRgb(h2);
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function pickTapeColors(base) {
  const MIN_DIST = 70;
  const visible = TAPE_CANDIDATES.filter((c) => colorDistance(c, base) >= MIN_DIST);
  // Jika tak ada yang cukup kontras, pakai yang paling berbeda
  const pool = visible.length >= 2
    ? visible
    : [...TAPE_CANDIDATES].sort((a, b) => colorDistance(b, base) - colorDistance(a, base));
  const first = pool[0];
  const second = pool.find((c) => c !== first && colorDistance(c, first) >= 45) || pool[1] || first;
  return [first, second];
}

// Hiasan di atas foto: garis jahitan di tepi dan potongan pita (washi tape) di sudut
function drawFrameExtras(ctx, w, h, base, scale = 1, opts = {}) {
  const s = scale;
  if (opts.stitch) {
    ctx.save();
    ctx.setLineDash([10 * s, 7 * s]);
    ctx.lineWidth = Math.max(1.5, 2.5 * s);
    ctx.strokeStyle = colorLuminance(base) > 0.6 ? 'rgba(80,68,68,0.55)' : 'rgba(255,255,255,0.85)';
    const m = 12 * s;
    ctx.strokeRect(m, m, w - m * 2, h - m * 2);
    ctx.restore();
  }
  if (opts.tape) {
    const tw = 130 * s;
    const th = 36 * s;
    const piece = (cx, cy, ang, color) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.85;
      // Bayangan tipis agar pita tetap terpisah dari bingkai
      ctx.shadowColor = 'rgba(0,0,0,0.22)';
      ctx.shadowBlur = 5 * s;
      ctx.shadowOffsetY = 2 * s;
      ctx.fillStyle = color;
      ctx.fillRect(-tw / 2, -th / 2, tw, th);
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#ffffff';
      for (let x = -tw / 2 + 8 * s; x < tw / 2; x += 16 * s) ctx.fillRect(x, -th / 2, 6 * s, th);
      ctx.restore();
    };
    const [tapeA, tapeB] = pickTapeColors(base);
    piece(34 * s, 34 * s, -Math.PI / 4, tapeA);
    piece(w - 34 * s, h - 34 * s, -Math.PI / 4, tapeB);
  }
}

const FRAME_STYLES = [
  { id: 'solid', label: 'Polos' },
  { id: 'dots', label: 'Polkadot' },
  { id: 'gingham', label: 'Gingham' },
  { id: 'stripes', label: 'Garis' },
  { id: 'hearts', label: 'Hati' },
  { id: 'stars', label: 'Bintang' },
  { id: 'flowers', label: 'Bunga' },
];

// Pratinjau kecil tiap gaya memakai warna bingkai yang sedang dipilih
function renderFrameStylePreviews() {
  const bar = document.getElementById('frameStyleBar');
  if (!bar) return;
  const base = currentBorderColor || '#ffffff';
  bar.querySelectorAll('canvas[data-style]').forEach((c) => {
    const pctx = c.getContext('2d');
    pctx.clearRect(0, 0, c.width, c.height);
    pctx.fillStyle = base;
    pctx.fillRect(0, 0, c.width, c.height);
    drawFramePattern(pctx, c.width, c.height, base, c.dataset.style, 0.6);
    // kotak abu-abu di tengah mewakili foto
    pctx.fillStyle = '#e4e2de';
    pctx.fillRect(c.width * 0.28, c.height * 0.28, c.width * 0.44, c.height * 0.44);
  });
}

function syncFrameStyleUI() {
  const bar = document.getElementById('frameStyleBar');
  if (!bar) return;
  bar.querySelectorAll('button[data-style]').forEach((chip) => {
    const cv = chip.querySelector('canvas');
    if (cv) {
      cv.style.boxShadow = chip.dataset.style === currentFrameStyle
        ? '0 0 0 2px #fbf9f5, 0 0 0 4px #446279'
        : 'none';
    }
  });
  bar.querySelectorAll('button[data-toggle]').forEach((pill) => {
    const on = pill.dataset.toggle === 'stitch' ? frameStitch : frameTape;
    pill.style.background = on ? '#446279' : '#ffffff';
    pill.style.color = on ? '#ffffff' : '#504444';
  });
}

function setupFrameStylePicker() {
  const colors = document.getElementById('borderOptions');
  if (!colors || document.getElementById('frameStyleBar')) return;

  const bar = document.createElement('div');
  bar.id = 'frameStyleBar';
  bar.style.cssText = 'margin-top:16px;padding-top:14px;border-top:1px dashed #d4c2c2;';

  const title = document.createElement('div');
  title.style.cssText = "font:700 13px 'Nunito Sans',sans-serif;color:#7b5455;margin-bottom:10px;";
  title.textContent = 'Frame Style';
  bar.appendChild(title);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:10px;';
  FRAME_STYLES.forEach((st) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.dataset.style = st.id;
    chip.style.cssText = 'padding:0;border:none;background:none;cursor:pointer;text-align:center;touch-action:manipulation;';
    chip.innerHTML =
      `<canvas width="64" height="64" data-style="${st.id}" ` +
      'style="width:100%;aspect-ratio:1/1;border-radius:10px;display:block;border:1px solid rgba(0,0,0,.15);"></canvas>' +
      `<span style="display:block;margin-top:4px;font:600 10px 'Nunito Sans',sans-serif;color:#504444;">${st.label}</span>`;
    chip.addEventListener('click', () => {
      currentFrameStyle = st.id;
      syncFrameStyleUI();
      redrawEditCanvas();
    });
    grid.appendChild(chip);
  });
  bar.appendChild(grid);

  const extras = document.createElement('div');
  extras.style.cssText = 'margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;';
  const extrasLabel = document.createElement('span');
  extrasLabel.textContent = 'Hiasan';
  extrasLabel.style.cssText = "font:600 11px 'Nunito Sans',sans-serif;color:#504444;margin-right:2px;";
  extras.appendChild(extrasLabel);

  [['stitch', 'Jahitan'], ['tape', 'Pita']].forEach(([key, label]) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.dataset.toggle = key;
    pill.textContent = label;
    pill.style.cssText =
      "height:30px;padding:0 14px;border-radius:9999px;border:1px solid rgba(0,0,0,.25);" +
      "font:700 12px 'Nunito Sans',sans-serif;cursor:pointer;touch-action:manipulation;";
    pill.addEventListener('click', () => {
      if (key === 'stitch') frameStitch = !frameStitch;
      else frameTape = !frameTape;
      syncFrameStyleUI();
      redrawEditCanvas();
    });
    extras.appendChild(pill);
  });
  bar.appendChild(extras);

  colors.insertAdjacentElement('afterend', bar);
  renderFrameStylePreviews();
  syncFrameStyleUI();
}
setupFrameStylePicker();

// ================= CATATAN (MEMORY LOG) =================
// Gaya catatan: otomatis | teks saja | label | panel. Warna teks: otomatis | putih | hitam.
// Teks saja memakai putih/hitam menyesuaikan bingkai; label dan panel memakai latar kebalikannya.
// Catatan panjang otomatis dipecah menjadi beberapa baris (paragraf), maksimal 4 baris.
let captionStyle = 'auto';
let captionInk = 'auto';
const CAPTION_MAX_LINES = 4;
const CAPTION_BASE_PANEL_H = STRIP_BOTTOM_PADDING - STRIP_FILE_GAP - 20; // tinggi area catatan untuk 1 baris
const CAPTION_PANEL_RADIUS = 0; // 0 = persegi panjang bersudut lurus; isi mis. 16 untuk sudut membulat

// Memecah teks menjadi baris-baris yang tidak melebihi maxW (huruf dipatahkan jika satu kata terlalu panjang)
function wrapCaption(ctx, text, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  const breakLongWord = (word) => {
    let chunk = '';
    for (const ch of word) {
      if (chunk && ctx.measureText(chunk + ch).width > maxW) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    return chunk;
  };

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxW) {
      line = test;
      continue;
    }
    if (line) {
      lines.push(line);
      line = '';
    }
    line = ctx.measureText(word).width <= maxW ? word : breakLongWord(word);
  }
  if (line) lines.push(line);
  return lines;
}

// Menghitung baris, ukuran huruf, dan tambahan tinggi kanvas yang dibutuhkan catatan
function layoutCaption(ctx, w, text) {
  const maxW = w - STRIP_FILE_BORDER * 2 - 48;
  let size = 22;
  let lines;
  for (;;) {
    ctx.font = `bold ${size}px 'Courier Prime', monospace`;
    lines = wrapCaption(ctx, text, maxW);
    if (lines.length <= CAPTION_MAX_LINES || size <= 14) break;
    size -= 2;
  }
  if (lines.length > CAPTION_MAX_LINES) {
    lines = lines.slice(0, CAPTION_MAX_LINES);
    let last = lines[CAPTION_MAX_LINES - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[CAPTION_MAX_LINES - 1] = `${last}…`;
  }
  const lineH = Math.round(size * 1.35);
  const blockH = lines.length * lineH;
  const panelH = Math.max(CAPTION_BASE_PANEL_H, blockH + 28);
  return { lines, size, lineH, blockH, panelH, extra: panelH - CAPTION_BASE_PANEL_H };
}

function drawCaption(ctx, w, h, base, layout) {
  let mode = captionStyle;
  if (mode === 'auto') mode = currentFrameStyle === 'solid' ? 'text' : 'label';

  const frameIsLight = colorLuminance(base) >= 0.55;
  let ink;
  if (captionInk === 'white') ink = '#ffffff';
  else if (captionInk === 'black') ink = '#1b1c1a';
  else ink = mode === 'text' && !frameIsLight ? '#ffffff' : '#1b1c1a';
  const plate = ink === '#ffffff' ? '#1b1c1a' : '#ffffff';

  const { lines, size, lineH, blockH, panelH, extra } = layout;
  const py = h - STRIP_BOTTOM_PADDING - extra + STRIP_FILE_GAP; // tepi atas area catatan
  const cy = py + panelH / 2;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${size}px 'Courier Prime', monospace`;

  if (mode === 'panel') {
    // Persegi panjang selebar foto, di area bawah strip
    const px = STRIP_FILE_BORDER;
    const pw = w - STRIP_FILE_BORDER * 2;
    if (CAPTION_PANEL_RADIUS > 0) {
      pathRoundRect(ctx, px, py, pw, panelH, CAPTION_PANEL_RADIUS);
    } else {
      ctx.beginPath();
      ctx.rect(px, py, pw, panelH);
    }
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = plate;
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (mode === 'label') {
    // Label selebar teks
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const pw = Math.min(textW + 40, w - 24);
    const ph = blockH + 20;
    pathRoundRect(ctx, (w - pw) / 2, cy - ph / 2, pw, ph, Math.min(ph / 2, 22));
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = plate;
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    // Teks saja: garis tepi tipis agar tetap terbaca di atas motif
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = ink === '#ffffff' ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.5)';
  }

  const top = cy - blockH / 2;
  ctx.fillStyle = ink;
  lines.forEach((line, i) => {
    const y = top + lineH * (i + 0.5);
    if (mode === 'text') ctx.strokeText(line, w / 2, y);
    ctx.fillText(line, w / 2, y);
  });
  ctx.restore();
}

function setPillActive(btn, on) {
  btn.style.background = on ? '#446279' : '#ffffff';
  btn.style.color = on ? '#ffffff' : '#504444';
}

function syncCaptionUI() {
  const bar = document.getElementById('captionStyleBar');
  if (!bar) return;
  bar.querySelectorAll('button[data-cap-style]').forEach((b) => {
    setPillActive(b, b.dataset.capStyle === captionStyle);
  });
  bar.querySelectorAll('button[data-cap-ink]').forEach((b) => {
    setPillActive(b, b.dataset.capInk === captionInk);
  });
}

function setupCaptionControls() {
  const input = document.querySelector('.typewriter-input');
  if (!input || document.getElementById('captionStyleBar')) return;
  input.maxLength = 140; // catatan sangat panjang tidak muat di strip

  const bar = document.createElement('div');
  bar.id = 'captionStyleBar';
  bar.style.cssText = 'margin-top:12px;display:flex;flex-direction:column;gap:10px;';

  const makeRow = (labelText, items, dataAttr, onPick) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;';
    const label = document.createElement('span');
    label.textContent = labelText;
    label.style.cssText = "flex:0 0 100%;font:600 11px 'Nunito Sans',sans-serif;color:#504444;";
    row.appendChild(label);
    items.forEach(([value, text]) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.dataset[dataAttr] = value;
      pill.textContent = text;
      pill.style.cssText =
        "height:28px;padding:0 12px;border-radius:9999px;border:1px solid rgba(0,0,0,.25);" +
        "font:700 11px 'Nunito Sans',sans-serif;cursor:pointer;touch-action:manipulation;";
      pill.addEventListener('click', () => {
        onPick(value);
        syncCaptionUI();
        redrawEditCanvas();
      });
      row.appendChild(pill);
    });
    return row;
  };

  bar.appendChild(makeRow('Gaya catatan', [
    ['auto', 'Otomatis'], ['text', 'Teks'], ['label', 'Label'], ['panel', 'Panel'],
  ], 'capStyle', (v) => { captionStyle = v; }));
  bar.appendChild(makeRow('Warna teks', [
    ['auto', 'Auto'], ['white', 'Putih'], ['black', 'Hitam'],
  ], 'capInk', (v) => { captionInk = v; }));

  input.insertAdjacentElement('afterend', bar);
  syncCaptionUI();
}
setupCaptionControls();

function redrawEditCanvas() {
  if (!currentEditCanvas) return;
  const editCanvas = document.getElementById("editCanvas");
  const eCtx = editCanvas.getContext("2d");

  // Catatan panjang ditulis ke bawah (beberapa baris): tambah tinggi kanvas bila perlu
  const captionInput = document.querySelector('.typewriter-input');
  const captionText = captionInput ? captionInput.value.trim() : '';
  const captionLayout = captionText ? layoutCaption(eCtx, currentEditCanvas.width, captionText) : null;
  const targetH = currentEditCanvas.height + (captionLayout ? captionLayout.extra : 0);
  if (editCanvas.height !== targetH) editCanvas.height = targetH; // mengubah tinggi mengosongkan kanvas; digambar ulang di bawah

  eCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);

  // Draw the full background frame
  eCtx.fillStyle = currentBorderColor || "#ffffff";
  eCtx.fillRect(0, 0, editCanvas.width, editCanvas.height);

  // Motif bingkai (polkadot, gingham, hati, dst.) di balik foto
  drawFramePattern(eCtx, editCanvas.width, editCanvas.height, currentBorderColor || "#ffffff", currentFrameStyle, 1);

  // Draw photos and stickers
  eCtx.drawImage(currentEditCanvas, 0, 0);

  // Catatan (memory log) digambar lebih dulu agar pita tidak tertutup panel, dan stiker tetap di atasnya
  if (captionLayout) {
    drawCaption(eCtx, editCanvas.width, editCanvas.height, currentBorderColor || "#ffffff", captionLayout);
  }

  // Hiasan di atas foto dan catatan: jahitan dan pita
  drawFrameExtras(eCtx, editCanvas.width, editCanvas.height, currentBorderColor || "#ffffff", 1, {
    stitch: frameStitch,
    tape: frameTape,
  });

  eCtx.textAlign = "center";
  eCtx.textBaseline = "middle";
  placedStickers.forEach((sticker, i) => {
    // If it's a material icon string (e.g. "star", "favorite"), use Material Symbols font.
    // If it's a native emoji, sans-serif is fine, but Material Symbols works well if we only use icons.
    eCtx.font = `${sticker.size}px "Material Symbols Outlined"`;
    // Sebelumnya stiker memakai fillStyle terakhir (warna bingkai); sekarang warna sendiri
    eCtx.fillStyle = sticker.color || sticker.baseColor || '#7b5455';
    eCtx.fillText(sticker.emoji, sticker.x, sticker.y);

    // Garis putus-putus penanda stiker terpilih (disembunyikan saat menyimpan)
    if (i === selectedStickerIndex) {
      const half = sticker.size * 0.6;
      eCtx.save();
      eCtx.strokeStyle = '#446279';
      eCtx.lineWidth = 3;
      eCtx.setLineDash([10, 8]);
      eCtx.strokeRect(sticker.x - half, sticker.y - half, half * 2, half * 2);
      eCtx.restore();
    }
  });
}

// Live redraw on memory log typing
const memoryLogInput = document.querySelector('.typewriter-input');
if (memoryLogInput) {
  memoryLogInput.addEventListener('input', () => {
    redrawEditCanvas();
  });
}

let draggingStickerIndex = -1;
let dragOffsetX = 0;
let dragOffsetY = 0;

const editCanvasElement = document.getElementById("editCanvas");
const trashBin = document.getElementById("trashBin");

function getCanvasPointer(e) {
  const rect = editCanvasElement.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  // We use a fallback of 1 for object scale to avoid divide by zero if not rendered
  const scaleX = rect.width ? editCanvasElement.width / rect.width : 1;
  const scaleY = rect.height ? editCanvasElement.height / rect.height : 1;

  // When using object-contain, the canvas drawing buffer might be letterboxed inside the DOM element.
  // To be perfectly accurate we'd calculate the letterbox, but a simple scaling is usually sufficient
  // if the flex layout constrains the canvas tightly.
  // Let's calculate the real displayed size to account for object-contain:
  const canvasRatio = editCanvasElement.width / editCanvasElement.height;
  const rectRatio = rect.width / rect.height;

  let drawWidth = rect.width;
  let drawHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (canvasRatio > rectRatio) {
    // Limited by width
    drawHeight = rect.width / canvasRatio;
    offsetY = (rect.height - drawHeight) / 2;
  } else {
    // Limited by height
    drawWidth = rect.height * canvasRatio;
    offsetX = (rect.width - drawWidth) / 2;
  }

  const trueScaleX = editCanvasElement.width / drawWidth;
  const trueScaleY = editCanvasElement.height / drawHeight;

  return {
    x: (clientX - rect.left - offsetX) * trueScaleX,
    y: (clientY - rect.top - offsetY) * trueScaleY,
    clientX,
    clientY
  };
}

editCanvasElement.addEventListener("mousedown", handleDragStart);
editCanvasElement.addEventListener("touchstart", handleDragStart, { passive: false });
window.addEventListener("mousemove", handleDragMove);
window.addEventListener("touchmove", handleDragMove, { passive: false });
window.addEventListener("mouseup", handleDragEnd);
window.addEventListener("touchend", handleDragEnd);

function handleDragStart(e) {
  if (appState !== "edit_photo") return;
  const ptr = getCanvasPointer(e);

  for (let i = placedStickers.length - 1; i >= 0; i--) {
    const s = placedStickers[i];
    const hitZone = s.size * 0.6;
    if (Math.abs(ptr.x - s.x) < hitZone && Math.abs(ptr.y - s.y) < hitZone) {
      draggingStickerIndex = i;
      setSelectedSticker(i);
      dragOffsetX = s.x - ptr.x;
      dragOffsetY = s.y - ptr.y;
      trashBin.classList.remove('opacity-70');
      trashBin.classList.add('opacity-100', 'scale-105');
      e.preventDefault();
      return;
    }
  }

  // Mengetuk area kosong membatalkan pilihan stiker
  if (selectedStickerIndex !== -1) setSelectedSticker(-1);
}

function handleDragMove(e) {
  if (draggingStickerIndex === -1) return;
  e.preventDefault();
  const ptr = getCanvasPointer(e);

  const s = placedStickers[draggingStickerIndex];
  s.x = ptr.x + dragOffsetX;
  s.y = ptr.y + dragOffsetY;

  const trashRect = trashBin.getBoundingClientRect();
  if (ptr.clientX >= trashRect.left && ptr.clientX <= trashRect.right &&
    ptr.clientY >= trashRect.top && ptr.clientY <= trashRect.bottom) {
    trashBin.classList.add('bg-error', 'text-white', 'border-error');
    trashBin.classList.remove('bg-error-container', 'text-on-error-container', 'border-error/50');
  } else {
    trashBin.classList.add('bg-error-container', 'text-on-error-container', 'border-error/50');
    trashBin.classList.remove('bg-error', 'text-white', 'border-error');
  }

  redrawEditCanvas();
}

function handleDragEnd(e) {
  if (draggingStickerIndex === -1) return;

  let clientX, clientY;
  if (e.changedTouches) {
    clientX = e.changedTouches[0].clientX;
    clientY = e.changedTouches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  const trashRect = trashBin.getBoundingClientRect();
  if (clientX >= trashRect.left && clientX <= trashRect.right &&
    clientY >= trashRect.top && clientY <= trashRect.bottom) {
    placedStickers.splice(draggingStickerIndex, 1);
    selectedStickerIndex = -1;
    syncStickerColorUI();
    redrawEditCanvas();
  }

  draggingStickerIndex = -1;
  trashBin.classList.add('opacity-70', 'bg-error-container', 'text-on-error-container', 'border-error/50');
  trashBin.classList.remove('opacity-100', 'scale-105', 'bg-error', 'text-white', 'border-error');
}

window.onScreenChange = (screenId) => {
  if (screenId === 'landingPage' || screenId === 'welcomeScreen') {
    appState = 'welcome';
    loopRunning = false;

    // Matikan kamera untuk menghemat resource dan mencegah freeze
    if (videoEl && videoEl.srcObject) {
      const tracks = videoEl.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoEl.srcObject = null;
    }
  }
};

function finishEditAndReturn(save) {
  // Sembunyikan garis seleksi stiker agar tidak ikut tersimpan di gambar
  selectedStickerIndex = -1;
  if (save && currentEditCanvas) redrawEditCanvas();

  if (save && currentEditCanvas) {
    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = editCanvas.width;
    finalCanvas.height = editCanvas.height;

    const fCtx = finalCanvas.getContext("2d");
    fCtx.drawImage(editCanvas, 0, 0);

    const link = document.createElement("a");
    link.download = `scrapbook-photo-${Date.now()}.png`;
    link.href = finalCanvas.toDataURL("image/png");
    link.click();
  }

  placedStickers = [];
  currentEditCanvas = null;
  document.getElementById("editPhotoScreen").classList.add("hidden");

  // Kembali ke beranda
  document.getElementById("app").style.display = "none";
  document.getElementById("welcomeScreen").style.display = "flex";
  document.getElementById("welcomeScreen").classList.remove("hidden");

  resetEverything();
  appState = "welcome";
}

document.getElementById('savePhotoBtn').addEventListener('click', () => finishEditAndReturn(true));
// Ikon simpan di bar bawah (HP) sebelumnya hanya melewati tanpa menyimpan
document.getElementById('skipEditBtn').addEventListener('click', () => finishEditAndReturn(true));

// Label tombol simpan di editor (HTML masih memakai teks lama "Next: Assemble Puzzle")
const savePhotoLabel = document.querySelector('#savePhotoBtn span:first-child');
if (savePhotoLabel) savePhotoLabel.textContent = 'Save Photo';
const savePhotoIcon = document.querySelector('#savePhotoBtn .material-symbols-outlined');
if (savePhotoIcon) savePhotoIcon.textContent = 'download';

const skipEditBtnTop = document.getElementById('skipEditBtnTop');
if (skipEditBtnTop) {
  skipEditBtnTop.addEventListener('click', () => finishEditAndReturn(false));
}

const fullscreenBtn = document.getElementById('fullscreenBtn');
const fullscreenIcon = document.getElementById('fullscreenIcon');
if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    } else {
      document.exitFullscreen();
    }
  });
}
window.addEventListener('fullscreenchange', () => {
  if (fullscreenIcon) {
    fullscreenIcon.textContent = document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen';
  }
});

// Removed beforeunload listener to prevent refresh freezing.


// ============================================================
// [MOBILE] BLOK TAMBAHAN UNTUK KEMUDAHAN DI HP
// ============================================================

// Perbaikan CSS untuk layar sentuh (disuntikkan lewat JS, index.html tidak perlu diubah)
(function injectMobileStyles() {
  const style = document.createElement("style");
  style.id = "mobile-fixes";
  style.textContent = `
    /* 0. css/styles.css: .animate-page memakai animation "forwards" yang meninggalkan
          transform pada elemennya. Transform membuat anak ber-position:fixed (header,
          bar bawah, tempat sampah) ikut ter-scroll bersama konten, bukan menempel di layar. */
    .animate-page {
      animation-fill-mode: none !important;
    }
    /* css/styles.css memberi #stage tinggi 100vh, lebih tinggi dari area terlihat
       di browser HP (bar alamat). #app sudah 100dvh, jadi samakan. */
    #stage {
      height: 100dvh !important;
    }

    /* 1. Pilihan filter: di layar sentuh efek :hover menempel setelah diketuk dan
          menimpa gaya "terpilih" (bg-surface-dim lebih spesifik dari bg-on-surface-variant),
          sehingga filter yang sudah terpilih tampak belum terpilih. */
    .filter-btn.bg-on-surface-variant,
    .filter-btn.bg-on-surface-variant:hover {
      background-color: #504444 !important;
      color: #ffffff !important;
    }
    .filter-btn, .grid-btn, .layout-btn, .sticker-btn, .border-btn {
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    @media (hover: none) {
      .filter-btn:hover { transform: none !important; }
    }

    @media (max-width: 767px) {
      /* 2. Bar bawah di editor terlalu besar dan menutupi foto:
            ubah menjadi tombol simpan bulat kecil di kiri bawah. */
      #editPhotoScreen > nav {
        width: 56px !important;
        max-width: 56px !important;
        height: 56px !important;
        left: 16px !important;
        right: auto !important;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 16px) !important;
        margin: 0 !important;
        padding: 0 !important;
        transform: none !important;
        border-radius: 9999px !important;
        border: 2px dashed rgba(255, 255, 255, 0.45) !important;
        justify-content: center !important;
      }
      /* 3. Tempat sampah hanya muncul saat stiker sedang diseret. */
      #trashBin:not(.opacity-100) {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    }
  `;
  document.head.appendChild(style);
})();

// iPhone: video harus inline dan muted agar play() tidak ditolak
videoEl.setAttribute("playsinline", "");
videoEl.muted = true;

// Haluskan gerakan jari agar kepingan tidak bergetar
const smoothState = {};
function smoothPoint(key, p, active, alpha = 0.45) {
  const s = smoothState[key];
  if (!active || !s) {
    smoothState[key] = { x: p.x, y: p.y };
    return p;
  }
  s.x += (p.x - s.x) * alpha;
  s.y += (p.y - s.y) * alpha;
  return { x: s.x, y: s.y };
}

// Konversi koordinat layar <-> koordinat kanvas (cover / contain / fill)
function getCanvasFit() {
  const r = canvas.getBoundingClientRect();
  const sx = r.width / canvas.width;
  const sy = r.height / canvas.height;
  const fit = getComputedStyle(canvas).objectFit;
  if (fit !== "cover" && fit !== "contain") {
    return { r, scaleX: sx, scaleY: sy, offX: 0, offY: 0 };
  }
  const scale = fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  return {
    r,
    scaleX: scale,
    scaleY: scale,
    offX: (r.width - canvas.width * scale) / 2,
    offY: (r.height - canvas.height * scale) / 2,
  };
}

function clientToCanvas(e) {
  const f = getCanvasFit();
  return {
    x: (e.clientX - f.r.left - f.offX) / f.scaleX,
    y: (e.clientY - f.r.top - f.offY) / f.scaleY,
  };
}

// Bagian kanvas yang benar-benar terlihat di layar (koordinat kanvas)
function getVisibleCanvasRect() {
  const f = getCanvasFit();
  const x0 = Math.max(0, -f.offX / f.scaleX);
  const y0 = Math.max(0, -f.offY / f.scaleY);
  const x1 = Math.min(canvas.width, (f.r.width - f.offX) / f.scaleX);
  const y1 = Math.min(canvas.height, (f.r.height - f.offY) / f.scaleY);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Geser kepingan dengan jari (atau mouse). Memakai ulang handleDragForHand(),
// jadi snap & tukar kepingan tetap sama seperti gestur tangan.
function pointerInCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return (
    e.clientX >= r.left && e.clientX <= r.right &&
    e.clientY >= r.top && e.clientY <= r.bottom
  );
}

window.addEventListener("pointerdown", (e) => {
  if (!e.isPrimary || appState !== "puzzle" || shatter.active || isTutorialOpen()) return;
  if (e.target.closest?.("button, a, input, select, textarea")) return;
  if (!pointerInCanvas(e)) return;
  handleDragForHand("touch", true, clientToCanvas(e));
});

window.addEventListener("pointermove", (e) => {
  if (!e.isPrimary || drag.activeHand !== "touch") return;
  handleDragForHand("touch", true, clientToCanvas(e));
});

function endTouchDrag(e) {
  if (!e.isPrimary || drag.activeHand !== "touch") return;
  handleDragForHand("touch", false, clientToCanvas(e));
}
window.addEventListener("pointerup", endTouchDrag);
window.addEventListener("pointercancel", endTouchDrag);

// Ambil foto dengan tombol: bingkai tetap di tengah area yang terlihat
function startTapCapture() {
  if (appState !== "tracking" || isStripFull()) return;
  const v = getVisibleCanvasRect();
  const w = v.w * 0.8;
  const h = Math.min(v.h * 0.8, (w * 4) / 3);
  startCountdown({
    x: v.x + (v.w - w) / 2,
    y: v.y + (v.h - h) / 2,
    width: w,
    height: h,
  });
}

// Layar tetap menyala selama bermain
let wakeLock = null;
async function keepScreenAwake() {
  try {
    if (!("wakeLock" in navigator) || wakeLock) return;
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch (_) {
    /* tidak didukung atau ditolak: abaikan */
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && loopRunning) keepScreenAwake();
});

// Tombol mengambang (dibuat lewat JS, hanya di HP)
const mobileBtns = {};

function makeMobileBtn(label, position, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.style.cssText =
    "position:fixed;z-index:9000;display:none;padding:14px 26px;" +
    "border-radius:9999px;border:2px dashed rgba(255,255,255,.55);" +
    "background:#446279;color:#fff;font:700 16px 'Nunito Sans',sans-serif;" +
    "box-shadow:0 6px 18px rgba(0,0,0,.35);touch-action:manipulation;" +
    "bottom:calc(env(safe-area-inset-bottom,0px) + 24px);" +
    position;
  b.addEventListener("click", onClick);
  document.body.appendChild(b);
  return b;
}

function showBtn(b, on) {
  b.style.display = on ? "block" : "none";
}

function updateMobileButtons() {
  const ready = loopRunning && !!handLandmarker && !isTutorialOpen();
  showBtn(mobileBtns.capture, ready && appState === "tracking" && !isStripFull());
  showBtn(mobileBtns.save, ready && appState === "puzzle" && puzzle.solved);
  showBtn(mobileBtns.redo, ready && appState === "puzzle");
}

// Galeri foto sebelumnya (pojok kanan bawah) menutupi puzzle di layar kecil.
// Di HP galeri disembunyikan; ketuk penghitung foto ("1 / 3") untuk mengintipnya
// saat tidak sedang menyusun puzzle. Otomatis tertutup lagi begitu puzzle dimulai.
let galleryPeek = false;

function updateMobileGallery() {
  if (!galleryStrip) return;
  if (appState !== "tracking") galleryPeek = false;
  galleryStrip.style.display = galleryPeek ? "" : "none";
}

// Dipanggil dari boot(). Aman dipanggil berulang.
let mobileUIReady = false;
function setupMobileUI() {
  keepScreenAwake();
  if (mobileUIReady) return;
  mobileUIReady = true;

  canvas.style.touchAction = "none"; // cegah layar ikut ter-scroll saat menggeser
  document.documentElement.style.overscrollBehavior = "none"; // cegah pull-to-refresh
  document.body.style.overscrollBehavior = "none";

  if (!IS_MOBILE) return;

  // Tampilkan seluruh frame kamera agar semua kepingan terjangkau jari.
  // Kalau ingin layar penuh (tepi terpotong), ganti jadi "cover".
  canvas.style.objectFit = "contain";

  const center = "left:50%;transform:translateX(-50%);";
  mobileBtns.capture = makeMobileBtn("Ambil Foto", center, startTapCapture);
  mobileBtns.save = makeMobileBtn("Simpan", center, () => handleFistReset());
  // Dinaikkan agar tidak menutupi #progressBadge ("x / 9 pieces placed") di kiri bawah
  mobileBtns.redo = makeMobileBtn(
    "Ulang",
    "left:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 72px);background:#7b5455;",
    () => resetPuzzleOnly()
  );

  // Penghitung foto bisa diketuk untuk melihat/menyembunyikan galeri
  const countPill = galleryCount && galleryCount.parentElement;
  if (countPill) {
    countPill.style.cursor = "pointer";
    countPill.addEventListener("click", () => {
      if (appState === "tracking") galleryPeek = !galleryPeek;
      updateMobileGallery();
    });
  }
  updateMobileGallery();

  setInterval(() => {
    updateMobileButtons();
    updateMobileGallery();
  }, 150);
}