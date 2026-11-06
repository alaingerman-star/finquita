// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyAv06T4Kkww3Ezph9mPUIPCxPg8hyNSm2E",
  authDomain: "://firebaseapp.com",
  projectId: "finquitas-gloria",
  storageBucket: "finquitas-gloria.firebasestorage.app",
  messagingSenderId: "14798500087",
  appId: "1:14798500087:web:455727c4521678eaf2a3f2",
  measurementId: "G-GS3WT1P3GX"
};

// Conectar con la base de datos de la nube
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Elementos de la interfaz recuperados del DOM
const video = document.getElementById('webcam');
const placeholder = document.getElementById('placeholder');
const overlay = document.getElementById('overlay');
const actionBtn = document.getElementById('actionBtn');
const btnText = document.getElementById('btnText');
const confirmBtn = document.getElementById('confirmBtn');
const statusBanner = document.getElementById('statusBanner');
const statusText = document.getElementById('statusText');

let streamInstance = null;
let currentAppMode = "START"; // MODOS DEL SISTEMA: START, READY_TO_SNAP, CONFIRM
let lastParsedData = null;

// 1. INICIALIZAR Y ACTIVAR LA CÁMARA TRAS EL PRIMER CLIC
async function startAccessCamera() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Su navegador bloquea el acceso a la cámara o requiere conexión segura HTTPS.");
        }

        streamInstance = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: "environment", // Prioriza el uso de la cámara trasera en móviles/tabletas
                width: { ideal: 1280 }, 
                height: { ideal: 720 } 
            }
        });
        
        video.srcObject = streamInstance;
        video.classList.remove('hidden');
        if (placeholder) placeholder.classList.add('hidden');
        if (overlay) overlay.classList.remove('hidden');
        
        // Modifica la apariencia del botón para preparar la captura
        btnText.innerText = "¡TOMAR FOTO!";
        actionBtn.classList.replace('bg-[#035151]', 'bg-amber-600');
        actionBtn.classList.replace('border-[#013535]', 'border-amber-800');
        
        currentAppMode = "READY_TO_SNAP";
    } catch (err) {
        console.error("Camera Error: ", err);
        alert("Fallo de cámara: " + err.message + "\n\nPor favor verifique los permisos de su navegador.");
    }
}

// 2. CAPTURAR EL FOTOGRAMA ACTUAL E INICIAR EL RECONOCIMIENTO ÓPTICO (OCR)
async function captureAndScanID() {
    statusBanner.classList.remove('hidden');
    statusText.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Procesando Imagen...`;
    actionBtn.classList.add('opacity-50', 'pointer-events-none');

    try {
        const canvas = document.createElement('canvas');
        // Fallback a dimensiones estándar si el feed de video no ha cargado completamente la metadata
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        
        const ctx = canvas.getContext('2d');
        // Dibuja el fotograma de video exacto dentro del elemento canvas en memoria
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Envía el canvas generado a Tesseract con paquete de idioma configurado en Español
        Tesseract.recognize(canvas, 'spa')
            .then(({ data: { text } }) => {
                parseDominicanIDText(text);
            })
            .catch(err => {
                console.error("OCR Error: ", err);
                statusText.innerText = "Error leyendo datos. Reintente el escaneo.";
                resetInterfaceState();
            });
    } catch (err) {
        console.error("Capture Error: ", err);
        statusText.innerText = "Fallo crítico al capturar el flujo de video.";
        resetInterfaceState();
    }
}

// 3. EXTRACCIÓN MEDIANTE EXPRESIONES REGULARES PARA BUSCAR CÉDULAS DOMINICANAS
function parseDominicanIDText(rawText) {
    // Busca el formato estándar de cédula dominicana: 3 dígitos - 7 dígitos - 1 dígito
    const cedulaRegex = /\d{3}-\d{7}-\d{1}/;
    const foundCedula = rawText.match(cedulaRegex);

    lastParsedData = {
        cedula: foundCedula ? foundCedula[0] : "No detectada (Ingreso manual)",
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    statusText.innerText = `Identificación: ${lastParsedData.cedula}`;
    
    // Oculta el control primario de la cámara y despliega el botón "Entrar" naranja
    actionBtn.classList.add('hidden');
    confirmBtn.classList.remove('hidden');
    currentAppMode = "CONFIRM";
}

// 4. ALMACENAMIENTO DE DATOS EN LA COLECCIÓN DE FIRESTORE
async function saveEntryToCloud() {
    confirmBtn.classList.add('opacity-50', 'pointer-events-none');
    statusText.innerHTML = `<i class="fa-solid fa-cloud-arrow-up animate-bounce"></i> Registrando Acceso...`;

    try {
        await db.collection("accesos_gloria").add(lastParsedData);
        statusText.innerHTML = "🎉 ¡BIENVENIDO! Acceso Guardado con Éxito.";
        
        // Pausa de 3 segundos para confirmación visual antes de restablecer
        setTimeout(() => {
            resetInterfaceState();
        }, 3000); 
    } catch (error) {
        console.error("Database Error: ", error);
        alert("Error de red: No se pudo subir el registro de entrada a Firebase.");
        confirmBtn.classList.remove('opacity-50', 'pointer-events-none');
    }
}

// RESTABLECIMIENTO TOTAL DEL FLUJO Y RE-ESTILIZACIÓN DE BOTONES
function resetInterfaceState() {
    confirmBtn.classList.add('hidden');
    confirmBtn.classList.remove('opacity-50', 'pointer-events-none');
    
    actionBtn.classList.remove('hidden', 'opacity-50', 'pointer-events-none');
    // Devuelve los estilos originales de Tailwind al estado de carga inicial
    actionBtn.className = "w-full bg-[#035151] hover:bg-[#023e3e] active:scale-[0.98] text-white font-bold text-xl py-4 px-6 rounded-2xl shadow-lg border-b-4 border-[#013535] flex items-center justify-center gap-3 transition-all duration-150";
    
    statusBanner.classList.add('hidden');
    btnText.innerText = "Foto de cédula";
    currentAppMode = "START"; 
    
    // Apaga el flujo de hardware para liberar recursos si el usuario sale de la pantalla
    if (streamInstance) {
        streamInstance.getTracks().forEach(track => track.stop());
        video.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
        if (overlay) overlay.classList.add('hidden');
    }
}

// ENLACES DE EVENTOS DE ACCIÓN DEL USUARIO
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
