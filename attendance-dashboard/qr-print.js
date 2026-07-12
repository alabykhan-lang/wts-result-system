"use strict";

const SAMPLE_DATA = [
  {
    "name": "DEVELOPMENT TEST STUDENT",
    "class_key": "jss1",
    "admno": "WTS/DEV/001",
    "session": "2026/2027",
    "photo": "",
    "credential_token": "WTS-DEMO-QR-7f4db3903bd74820a6e0b568b23ef771"
  },
  {
    "name": "SECOND TEST STUDENT",
    "class_key": "jss2",
    "admno": "WTS/DEV/002",
    "session": "2026/2027",
    "photo": "",
    "credential_token": "WTS-DEMO-QR-4816cf5d8bc54816a89abac734469c12"
  }
];

const CLASS_LABELS = {
  "jss1": "JSS 1",
  "jss2": "JSS 2",
  "jss3": "JSS 3",
  "ss1-general": "SS 1",
  "ss2-arts": "SS 2 Arts",
  "ss2-business": "SS 2 Business",
  "ss2-science": "SS 2 Science",
  "ss3-arts": "SS 3 Arts",
  "ss3-science": "SS 3 Science"
};

const dataInput = document.getElementById("dataInput");
const pagesContainer = document.getElementById("pagesContainer");
const cardCount = document.getElementById("cardCount");
const pageCount = document.getElementById("pageCount");
const messageBox = document.getElementById("messageBox");
const cardsPerPage = document.getElementById("cardsPerPage");
const showCutMarks = document.getElementById("showCutMarks");
const showPhoto = document.getElementById("showPhoto");
const cardTemplate = document.getElementById("cardTemplate");

let preparedStudents = [];

function classLabel(value) {
  const key = String(value || "").trim();
  return CLASS_LABELS[key] || key.replaceAll("-", " ").toUpperCase() || "UNASSIGNED";
}

function initials(name) {
  return String(name || "STUDENT")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function normaliseStudent(record, index) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Record ${index + 1} must be an object.`);
  }

  const name = String(record.name || record.student_name || "").trim();
  const token = String(record.credential_token || record.token || record.raw_token || "").trim();
  if (!name) throw new Error(`Record ${index + 1} has no student name.`);
  if (token.length < 16) throw new Error(`Record ${index + 1} has no valid credential token.`);

  return {
    name,
    classKey: String(record.class_key || record.class || "").trim(),
    admno: String(record.admno || record.admission_number || record.admission_no || "").trim(),
    session: String(record.session || "2026/2027").trim(),
    photo: String(record.photo || record.photo_url || "").trim(),
    token
  };
}

function showMessage(message, error = false) {
  messageBox.textContent = message;
  messageBox.classList.toggle("error", error);
}

function updateCounts() {
  const perPage = Number(cardsPerPage.value) || 8;
  const pages = preparedStudents.length ? Math.ceil(preparedStudents.length / perPage) : 0;
  cardCount.textContent = `${preparedStudents.length} card${preparedStudents.length === 1 ? "" : "s"} prepared`;
  pageCount.textContent = `${pages} A4 page${pages === 1 ? "" : "s"}`;
}

function emptyPreview() {
  pagesContainer.innerHTML = `
    <div class="empty-preview">
      <strong>No cards generated</strong>
      Paste credential data or load the development sample, then select “Generate cards”.
    </div>
  `;
  updateCounts();
}

async function renderQr(canvas, token) {
  if (!window.QRCode || typeof window.QRCode.toCanvas !== "function") {
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#1a2a4a";
    context.font = "bold 15px sans-serif";
    context.textAlign = "center";
    context.fillText("QR library", canvas.width / 2, canvas.height / 2 - 8);
    context.fillText("unavailable", canvas.width / 2, canvas.height / 2 + 14);
    return;
  }

  await window.QRCode.toCanvas(canvas, token, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: 160,
    color: { dark: "#101828", light: "#ffffff" }
  });
}

function buildCard(student) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.classList.toggle("cut-marks", showCutMarks.checked);
  card.querySelector(".student-name").textContent = student.name;
  card.querySelector(".student-class").textContent = classLabel(student.classKey);
  card.querySelector(".student-admno").textContent = student.admno || "Not assigned";
  card.querySelector(".student-session").textContent = student.session || "2026/2027";
  card.querySelector(".credential-ending").textContent = `Ending ${student.token.slice(-4).toUpperCase()}`;
  card.querySelector(".photo-initials").textContent = initials(student.name);

  const image = card.querySelector(".photo-frame img");
  const initialsNode = card.querySelector(".photo-initials");
  if (showPhoto.checked && student.photo) {
    image.src = student.photo;
    image.style.display = "block";
    image.addEventListener("load", () => { initialsNode.style.display = "none"; }, { once: true });
    image.addEventListener("error", () => {
      image.style.display = "none";
      initialsNode.style.display = "block";
    }, { once: true });
  } else if (!showPhoto.checked) {
    image.style.display = "none";
    initialsNode.style.display = "none";
  }

  return card;
}

async function renderCards() {
  pagesContainer.innerHTML = "";
  updateCounts();

  if (!preparedStudents.length) {
    emptyPreview();
    return;
  }

  const perPage = Number(cardsPerPage.value) || 8;
  const layoutClass = `layout-${perPage}`;
  const renderJobs = [];

  for (let start = 0; start < preparedStudents.length; start += perPage) {
    const page = document.createElement("section");
    page.className = `print-page ${layoutClass}`;

    preparedStudents.slice(start, start + perPage).forEach((student) => {
      const card = buildCard(student);
      page.appendChild(card);
      const canvas = card.querySelector(".qr-canvas");
      renderJobs.push(renderQr(canvas, student.token));
    });

    pagesContainer.appendChild(page);
  }

  await Promise.allSettled(renderJobs);
  showMessage(`${preparedStudents.length} secure QR card${preparedStudents.length === 1 ? "" : "s"} prepared for printing.`);
}

async function generateFromInput() {
  let parsed;
  try {
    parsed = JSON.parse(dataInput.value);
  } catch (error) {
    showMessage(`Invalid JSON: ${error.message}`, true);
    return;
  }

  if (!Array.isArray(parsed)) {
    showMessage("The pasted data must be a JSON array of student records.", true);
    return;
  }

  try {
    preparedStudents = parsed.map(normaliseStudent);
  } catch (error) {
    showMessage(error.message, true);
    return;
  }

  await renderCards();
}

function loadSample() {
  dataInput.value = JSON.stringify(SAMPLE_DATA, null, 2);
  preparedStudents = SAMPLE_DATA.map(normaliseStudent);
  renderCards();
}

function clearStudio() {
  dataInput.value = "";
  preparedStudents = [];
  emptyPreview();
  showMessage("Card data cleared. No credential tokens remain in the print studio.");
}

function printCards() {
  if (!preparedStudents.length) {
    showMessage("Generate at least one card before printing.", true);
    return;
  }
  window.print();
}

document.getElementById("generateButton").addEventListener("click", generateFromInput);
document.getElementById("loadSampleButton").addEventListener("click", loadSample);
document.getElementById("clearButton").addEventListener("click", clearStudio);
document.getElementById("printButton").addEventListener("click", printCards);
cardsPerPage.addEventListener("change", renderCards);
showCutMarks.addEventListener("change", renderCards);
showPhoto.addEventListener("change", renderCards);

emptyPreview();
