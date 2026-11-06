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
const rotateGuideBtn = byId("rotateGuideBtn");
const guide = byId("overlay");
const saveBtn = byId("saveBtn");
const cancelReviewBtn = byId("cancelReviewBtn");
const cameraStatus = byId("cameraStatus");
const reviewStatus = byId("reviewStatus");
const welcomeStatus = byId("welcomeStatus");

let auth;
let db;
let authReady;
let cameraStream;
let cameraSession = 0;
let saving = false;
let entryRef = null;

try {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();

  // Conserva la sesión anónima solo mientras la pestaña esté abierta.
  authReady = auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
  authReady.catch(() => {});
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

function openReview(cedula = "", hint = "Ingrese los datos de la cédula.", names = {}) {
  welcomeStatus.textContent = "";
  reviewForm.reset();
  reviewStatus.textContent = "";
  entryRef = null;
  byId("cedula").value = cedula;
  byId("reviewHint").textContent = hint;
  reviewDialog.showModal();
  byId("guestNames").value = names.nombres ?? "";
  byId("guestSurnames").value = names.apellidos ?? "";
  byId(cedula ? "guestNames" : "cedula").focus();
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

function extractNames(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const fields = {};
  const nameLabel = /\b(APELLIDOS?|NOMBRES?|SURNAMES?|GIVEN NAMES?)\b(?:\s*\/\s*(?:SURNAMES?|GIVEN NAMES?))?\s*[:.–-]?\s*/gi;
  const cardLabel = /\b(?:FECHA|LUGAR|NACIMIENTO|NACIONALIDAD|SEXO|ESTADO CIVIL|OCUPACI[ÓO]N|VENCIMIENTO|SANGRE|C[ÉE]DULA|REPUBLICA|REPÚBLICA|ELECTORAL|FIRMA)\b/i;

  for (const [index, line] of lines.entries()) {
    const labels = [...line.matchAll(nameLabel)];
    for (const [position, label] of labels.entries()) {
      const next = labels[position + 1];
      const inline = line.slice(label.index + label[0].length, next?.index).trim();
      const value = inline || (!next ? lines[index + 1] : "");
      if (!value || cardLabel.test(value) || [...value.matchAll(nameLabel)].length ||
          !/^[\p{L}][\p{L} '\u2019-]{1,119}$/u.test(value)) continue;

      const field = /APELLIDO|SURNAME/i.test(label[1]) ? "apellidos" : "nombres";
      fields[field] ??= value;
    }
  }

  if (!fields.nombres && !fields.apellidos && extractCedula(text)) {
    const isNameLine = (line) =>
      /^[\p{L}][\p{L} ’'-]{1,119}$/u.test(line) &&
      line.split(/\s+/).length >= 2 &&
      !cardLabel.test(line) &&
      ![...line.matchAll(nameLabel)].length &&
      !/\b(?:JUNTA|CENTRAL|IDENTIDAD|DOMINICAN[AO]|SANTO DOMINGO|NO FIRMA)\b/i.test(line);
    const pairs = lines.flatMap((line, index) => {
      const bottom = lines[index + 1];
      return bottom && isNameLine(line) && isNameLine(bottom) ? [[line, bottom]] : [];
    });
    if (pairs.length === 1) {
      [fields.nombres, fields.apellidos] = pairs[0];
    }
  }

  return fields;
}

async function readCedula(worker, photo, session) {
  const rotated = document.createElement("canvas");
  let best = {};
  let bestScore = 0;
  let bestDegrees = 0;

  function record(text, degrees, previous = {}) {
    const result = { cedula: extractCedula(text), ...extractNames(text) };
    if (!result.cedula || result.cedula === previous.cedula) {
      for (const field of ["cedula", "nombres", "apellidos"]) {
        result[field] ||= previous[field];
      }
    }
    const score = (result.cedula ? 4 : 0) +
      Number(Boolean(result.nombres)) + Number(Boolean(result.apellidos));
    if (score > bestScore) {
      best = result;
      bestScore = score;
      bestDegrees = degrees;
    }
  }

  function orient(degrees) {
    if (!degrees) return photo;
    const sideways = degrees !== 180;
    rotated.width = sideways ? photo.height : photo.width;
    rotated.height = sideways ? photo.width : photo.height;
    const context = rotated.getContext("2d");
    context.translate(rotated.width / 2, rotated.height / 2);
    context.rotate(degrees * Math.PI / 180);
    context.drawImage(photo, -photo.width / 2, -photo.height / 2);
    return rotated;
  }

  try {
    for (const degrees of [0, 90, 270, 180]) {
      if (session !== cameraSession) return {};
      if (degrees) cameraStatus.textContent = "Buscando datos en otra orientación…";
      const { data } = await worker.recognize(orient(degrees));
      record(data.text, degrees);
      if (bestScore === 6) return best;
    }

    if (session !== cameraSession) return {};
    cameraStatus.textContent = "Buscando nombres y apellidos…";
    await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
    if (session !== cameraSession) return {};
    const image = orient(bestDegrees);
    const enhanced = document.createElement("canvas");
    enhanced.width = image.width;
    enhanced.height = image.height;
    try {
      const context = enhanced.getContext("2d");
      context.filter = "grayscale(1) contrast(1.35)";
      context.drawImage(image, 0, 0);
      const { data } = await worker.recognize(enhanced);
      record(data.text, bestDegrees, best);
    } finally {
      enhanced.width = 0;
      enhanced.height = 0;
    }

    return best;
  } finally {
    rotated.width = 0;
    rotated.height = 0;
  }
}

async function captureAndScan() {
  if (!cameraStream || !video.videoWidth || !video.videoHeight ||
      !video.clientWidth || !video.clientHeight) {
    cameraStatus.textContent = "Espere a que aparezca la imagen de la cámara.";
    return;
  }

  const session = cameraSession;
  const canvas = document.createElement("canvas");
  const preview = video.getBoundingClientRect();
  const frame = guide.getBoundingClientRect();
  const scale = Math.max(preview.width / video.videoWidth, preview.height / video.videoHeight);
  const visibleWidth = preview.width / scale;
  const visibleHeight = preview.height / scale;
  const margin = Math.min(frame.width, frame.height) * 0.08;
  const left = Math.max(0, frame.left - preview.left - margin);
  const top = Math.max(0, frame.top - preview.top - margin);
  const right = Math.min(preview.width, frame.right - preview.left + margin);
  const bottom = Math.min(preview.height, frame.bottom - preview.top + margin);
  const cropWidth = (right - left) / scale;
  const cropHeight = (bottom - top) / scale;
  const enlargement = Math.max(1, 1400 / Math.max(cropWidth, cropHeight));
  canvas.width = Math.round(cropWidth * enlargement);
  canvas.height = Math.round(cropHeight * enlargement);
  captureBtn.disabled = true;
  cameraStatus.textContent = "Leyendo la cédula…";

  let worker;

  try {
    canvas.getContext("2d").drawImage(
      video,
      (video.videoWidth - visibleWidth) / 2 + left / scale,
      (video.videoHeight - visibleHeight) / 2 + top / scale,
      cropWidth,
      cropHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );
    stopCamera();

    if (!window.Tesseract) throw new Error("OCR no disponible");

    worker = await Tesseract.createWorker("spa");
    if (session !== cameraSession) return;

    const result = await readCedula(worker, canvas, session);
    if (session !== cameraSession) return;
    closeCamera();
    openReview(
      result.cedula,
      "Compare los datos con la cédula. Si falta algo, puede corregirlo o repetir la foto.",
      result
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
  const nombres = byId("guestNames").value.trim();
  const apellidos = byId("guestSurnames").value.trim();
  const guardName = byId("guardName").value.trim();
  const guardNumber = byId("guardNumber").value;

  if (!/^\d{11}$/.test(digits) || !nombres || !apellidos) {
    reviewStatus.textContent = "Ingrese los 11 dígitos de la cédula y el nombre completo.";
    return;
  }

  if (!guardName || !["1", "2"].includes(guardNumber)) {
    reviewStatus.textContent = "Ingrese el nombre del guardia y seleccione su número.";
    return;
  }

  if (!auth || !db) {
    reviewStatus.textContent = "Firebase no está disponible. La entrada sigue pendiente.";
    return;
  }

  saving = true;
  saveBtn.disabled = true;
  cancelReviewBtn.disabled = true;
  byId("retakeBtn").disabled = true;
  reviewStatus.textContent = "Guardando entrada…";

  try {
    await authReady;

    const user = auth.currentUser ?? (await auth.signInAnonymously()).user;

    // Reutiliza el ID del registro si el personal vuelve a intentar guardar.
    entryRef ??= db.collection("accesos_gloria").doc();

    await entryRef.set({
      cedula: formatCedula(digits),
      nombre: `${nombres} ${apellidos}`,
      nombres,
      apellidos,
      guardName,
      guardNumber,
      submitterUid: user.uid,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    reviewDialog.close();
    welcomeStatus.textContent = "¡Bienvenido! Entrada guardada.";
  } catch (error) {
    if (error.code === "permission-denied") {
      reviewStatus.textContent = "Firebase rechazó el registro. Las reglas deben permitir crear entradas desde el enlace.";
    } else if (error.code?.startsWith("auth/")) {
      reviewStatus.textContent = "No se pudo conectar con Firebase. Verifique que el acceso anónimo esté habilitado.";
    } else {
      reviewStatus.textContent = "No se pudo confirmar el registro. Revise la conexión e intente de nuevo.";
    }
  } finally {
    saving = false;
    saveBtn.disabled = false;
    cancelReviewBtn.disabled = false;
    byId("retakeBtn").disabled = false;
  }
}

byId("actionBtn").addEventListener("click", openCamera);
byId("confirmBtn").addEventListener("click", () => openReview());
captureBtn.addEventListener("click", captureAndScan);
rotateGuideBtn.addEventListener("click", () => {
  const vertical = guide.toggleAttribute("data-vertical");
  rotateGuideBtn.setAttribute("aria-pressed", String(vertical));
  rotateGuideBtn.textContent = vertical ? "Marco horizontal" : "Marco vertical";
});
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
byId("retakeBtn").addEventListener("click", () => {
  reviewDialog.close();
  openCamera();
});
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
