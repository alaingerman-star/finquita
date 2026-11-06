// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
   // For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = 
{apiKey: "AIzaSyAv06T4Kkww3Ezph9mPUIPCxPg8hyNSm2E",
  authDomain: "finquitas-gloria.firebaseapp.com",
  projectId: "finquitas-gloria",
  storageBucket: "finquitas-gloria.firebasestorage.app",
  messagingSenderId: "14798500087",
  appId: "1:14798500087:web:455727c4521678eaf2a3f2",
  measurementId: "G-GS3WT1P3GX"};


// Conectar con la base de datos de la nube
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Elementos de la pantalla
const video = document.getElementById('webcam');
const placeholder = document.getElementById('placeholder');
const overlay = document.getElementById('overlay');
const actionBtn = document.getElementById('actionBtn');
const btnText = document.getElementById('btnText');
const confirmBtn = document.getElementById('confirmBtn');
const statusBanner = document.getElementById('statusBanner');
const statusText = document.getElementById('statusText');

let streamInstance = null;
let currentAppMode = "START"; // MODOS: START, READY_TO_SNAP, CONFIRM
let lastParsedData = null;

// 1. ABRIR LA CÁMARA CON UN TOQUE
async function startAccessCamera() {
    try {
        streamInstance = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        video.srcObject = streamInstance;
        video.classList.remove('hidden');
        placeholder.classList.add('hidden');
        overlay.classList.remove('hidden');
        
        btnText.innerText = "¡TOMAR FOTO!";
        actionBtn.classList.replace('bg-emerald-500', 'bg-yellow-500');
        actionBtn.classList.replace('border-emerald-700', 'border-yellow-700');
        currentAppMode = "READY_TO_SNAP";
    } catch (err) {
        alert("Error al abrir la cámara. Verifica los permisos.");
    }
}

// 2. TOMAR LA FOTO Y LEER LA CÉDULA
async function captureAndScanID() {
    statusBanner.classList.remove('hidden');
    statusText.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Leyendo Cédula...`;
    actionBtn.classList.add('opacity-50', 'pointer-events-none');

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Lector gratis en español
    Tesseract.recognize(canvas, 'spa')
        .then(({ data: { text } }) => {
            parseDominicanIDText(text);
        })
        .catch(err => {
            statusText.innerText = "Error al escanear. Intenta de nuevo.";
            resetInterfaceState();
        });
}

// 3. BUSCAR EL NÚMERO DE CÉDULA DOMINICANA (000-0000000-0)
function parseDominicanIDText(rawText) {
    const cedulaRegex = /\d{3}-\d{7}-\d{1}/;
    const foundCedula = rawText.match(cedulaRegex);

    lastParsedData = {
        cedula: foundCedula ? foundCedula[0] : "No detectada (Ingreso manual)",
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    statusText.innerText = `Cédula: ${lastParsedData.cedula}`;
    
    actionBtn.classList.add('hidden');
    confirmBtn.classList.remove('hidden');
    currentAppMode = "CONFIRM";
}

// 4. GUARDAR EN LA NUBE
async function saveEntryToCloud() {
    confirmBtn.classList.add('opacity-50', 'pointer-events-none');
    statusText.innerHTML = `<i class="fa-solid fa-cloud animate-bounce"></i> Guardando...`;

    try {
        await db.collection("accesos_gloria").add(lastParsedData);
        statusText.innerHTML = "🎉 ¡BIENVENIDO! Acceso Guardado.";
        setTimeout(() => {
            resetInterfaceState();
        }, 3000); 
    } catch (error) {
        alert("Error al guardar en la nube.");
        confirmBtn.classList.remove('opacity-50', 'pointer-events-none');
    }
}

function resetInterfaceState() {
    confirmBtn.classList.add('hidden');
    confirmBtn.classList.remove('opacity-50', 'pointer-events-none');
    actionBtn.classList.remove('hidden', 'opacity-50', 'pointer-events-none');
    actionBtn.classList.replace('bg-yellow-500', 'bg-emerald-500');
    actionBtn.classList.replace('border-yellow-700', 'border-emerald-700');
    statusBanner.classList.add('hidden');
    btnText.innerText = "¡FOTO AQUÍ!";
    currentAppMode = "READY_TO_SNAP";
}

actionBtn.addEventListener('click', () => {
    if (currentAppMode === "START") {
        startAccessCamera();
    } else if (currentAppMode === "READY_TO_SNAP") {
        captureAndScanID();
    }
});

confirmBtn.addEventListener('click', () => {
    if (currentAppMode === "CONFIRM") {
        saveEntryToCloud();
    }
});
