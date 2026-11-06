const firebaseConfig = {
  apiKey: "AIzaSyAv06T4Kkww3Ezph9mPUIPCxPg8hyNSm2E",
  authDomain: "finquitas-gloria.firebaseapp.com",
  projectId: "finquitas-gloria",
  storageBucket: "finquitas-gloria.firebasestorage.app",
  messagingSenderId: "14798500087",
  appId: "1:14798500087:web:455727c4521678eaf2a3f2",
  measurementId: "G-GS3WT1P3GX"
};

const byId = (id) => document.getElementById(id);
const cameraDialog = byId("cameraDialog");
const reviewDialog = byId("reviewDialog");
const reviewForm = byId("reviewForm");
const video = byId("webcam");
const captureBtn = byId("captureBtn");
const saveBtn = byId("saveBtn");
const cancelReviewBtn = byId("cancelReviewBtn");
const cameraStatus = byId("cameraStatus");
const reviewStatus = byId("reviewStatus");
const welcomeStatus = byId("welcomeStatus");
const staffFields = byId("staffFields");

let auth;
let db;
let staffReady;
let cameraStream;
let cameraSession = 0;
let saving = false;
let entryRef = null;

try {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();

  // Conserva la sesión del personal solo mientras la pestaña esté abierta.
  staffReady = auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
  staffReady.catch(() => {});
} catch {
  welcomeStatus.textContent = "Firebase no está disponible. Puede revisar los datos sin guardarlos.";
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  video.srcObject = null;
}

function closeCamera() {
  cameraSession += 1;
  stopCamera();
  cameraDialog.close();
}

function updateStaffFields() {
  const needsLogin = !auth?.currentUser;
  staffFields.hidden = !needsLogin;
  staffFields.disabled = !needsLogin;
}

function openReview(cedula = "", hint = "Ingrese los datos de la cédula.") {
  welcomeStatus.textContent = "";
  reviewForm.reset();
  reviewStatus.textContent = "";
  entryRef = null;
  byId("cedula").value = cedula;
  byId("reviewHint").textContent = hint;
  updateStaffFields();
  reviewDialog.showModal();
  byId(cedula ? "guestName" : "cedula").focus();
}

async function openCamera() {
  welcomeStatus.textContent = "";
  captureBtn.disabled = true;
  cameraStatus.textContent = "Abriendo la cámara…";
  cameraDialog.showModal();
  const session = ++cameraSession;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("La cámara requiere una página HTTPS y un navegador compatible.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });

    if (session !== cameraSession) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    cameraStream = stream;
    video.srcObject = stream;
    await video.play();

    if (session === cameraSession) {
      captureBtn.disabled = false;
      cameraStatus.textContent = "Evite reflejos y mantenga la cédula fija.";
    }
  } catch {
    if (session !== cameraSession) return;
    stopCamera();
    cameraStatus.textContent =
      "No se pudo abrir la cámara. Revise los permisos o ingrese los datos manualmente.";
  }
}

function formatCedula(digits) {
  return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`;
}

function extractCedula(text) {
  const candidates = text.matchAll(
    /(?<!\d)(\d{3})[ \t\-–—]*(\d{7})[ \t\-–—]*(\d)(?!\d)/g
  );
  const numbers = new Set(
    Array.from(candidates, (match) => match.slice(1).join(""))
  );

  return numbers.size === 1 ? formatCedula([...numbers][0]) : "";
}

async function captureAndScan() {
  if (!cameraStream || !video.videoWidth || !video.videoHeight) {
    cameraStatus.textContent = "Espere a que aparezca la imagen de la cámara.";
    return;
  }

  const session = cameraSession;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  captureBtn.disabled = true;
  cameraStatus.textContent = "Leyendo la cédula…";

  let worker;

  try {
    canvas.getContext("2d").drawImage(video, 0, 0);
    stopCamera();

    if (!window.Tesseract) throw new Error("OCR no disponible");

    worker = await Tesseract.createWorker("spa");
    if (session !== cameraSession) return;

    const { data } = await worker.recognize(canvas);
    if (session !== cameraSession) return;

    const cedula = extractCedula(data.text);
    closeCamera();
    openReview(
      cedula,
      cedula
        ? "Compare el número con la cédula y escriba el nombre completo."
        : "No se pudo identificar un número con claridad. Ingréselo manualmente."
    );
  } catch {
    if (session !== cameraSession) return;
    closeCamera();
    openReview("", "No se pudo leer la foto. Ingrese los datos manualmente.");
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    await worker?.terminate().catch(() => {});
  }
}

async function saveEntry(event) {
  event.preventDefault();
  if (saving) return;

  const cedulaInput = byId("cedula").value.trim();
  const digits = cedulaInput.replace(/[\s-]/g, "");
  const nombre = byId("guestName").value.trim();

  if (!/^\d{11}$/.test(digits) || !nombre) {
    reviewStatus.textContent = "Ingrese los 11 dígitos de la cédula y el nombre completo.";
    return;
  }

  if (!auth || !db) {
    reviewStatus.textContent = "Firebase no está disponible. La entrada sigue pendiente.";
    return;
  }

  saving = true;
  saveBtn.disabled = true;
  cancelReviewBtn.disabled = true;
  reviewStatus.textContent = "Guardando entrada…";

  try {
    await staffReady;

    if (!auth.currentUser) {
      await auth.signInWithEmailAndPassword(
        byId("staffEmail").value.trim(),
        byId("staffPassword").value
      );
    }

    updateStaffFields();

    // Reutiliza el ID del registro si el personal vuelve a intentar guardar.
    entryRef ??= db.collection("accesos_gloria").doc();

    await entryRef.set({
      cedula: formatCedula(digits),
      nombre,
      staffUid: auth.currentUser.uid,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    reviewDialog.close();
    welcomeStatus.textContent = "¡Bienvenido! Entrada guardada.";
  } catch (error) {
    if (error.code === "permission-denied") {
      reviewStatus.textContent = "Esta cuenta no tiene permiso para registrar entradas.";
    } else if (error.code?.startsWith("auth/")) {
      reviewStatus.textContent = "No se pudo iniciar sesión. Revise la cuenta del personal.";
    } else {
      reviewStatus.textContent = "No se pudo confirmar el registro. Revise la conexión e intente de nuevo.";
    }
  } finally {
    byId("staffPassword").value = "";
    saving = false;
    saveBtn.disabled = false;
    cancelReviewBtn.disabled = false;
  }
}

byId("actionBtn").addEventListener("click", openCamera);
byId("confirmBtn").addEventListener("click", () => openReview());
captureBtn.addEventListener("click", captureAndScan);
byId("cancelCameraBtn").addEventListener("click", closeCamera);
byId("manualBtn").addEventListener("click", () => {
  closeCamera();
  openReview();
});

cameraDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeCamera();
});

reviewForm.addEventListener("submit", saveEntry);
byId("cancelReviewBtn").addEventListener("click", () => reviewDialog.close());
reviewDialog.addEventListener("cancel", (event) => {
  if (saving) event.preventDefault();
});
reviewDialog.addEventListener("close", () => {
  reviewForm.reset();
  entryRef = null;
});

window.addEventListener("pagehide", () => {
  cameraSession += 1;
  stopCamera();
});
