"use strict";

const URL = "https://wuftzyeajmsxdrbwaawl.supabase.co";
const KEY = "sb_publishable_7AKtP6jh9xg8CdrK8F53xA_q4yZskPJ";
const RPC = `${URL}/rest/v1/rpc/student_departure_admin_read_api`;
const STORE = "wts_attendance_admin_connection";

const labels = {
  jss1: "JSS 1", jss2: "JSS 2", jss3: "JSS 3",
  "ss1-general": "SS 1", "ss2-arts": "SS 2 Arts",
  "ss2-business": "SS 2 Business", "ss2-science": "SS 2 Science",
  "ss3-arts": "SS 3 Arts", "ss3-science": "SS 3 Science"
};

let records = [];
const $ = (selector) => document.querySelector(selector);

function toast(message, type = "default") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  $("#toastContainer").appendChild(node);
  setTimeout(() => node.remove(), 4500);
}

function credentials() {
  try { return JSON.parse(localStorage.getItem(STORE) || "null"); }
  catch { return null; }
}

function time(value) {
  return value ? new Date(value).toLocaleTimeString("en-NG", {
    hour: "2-digit", minute: "2-digit"
  }) : "—";
}

function duration(value) {
  const minutes = Number(value || 0);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

async function requestReport() {
  const auth = credentials();
  if (!auth?.adminCode || !auth?.adminSecret) {
    throw new Error("Administrator connection is not configured.");
  }

  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: KEY },
    body: JSON.stringify({
      p_client_code: auth.adminCode,
      p_client_secret: auth.adminSecret,
      p_action: "departureReport",
      p_payload: {
        from: $("#fromDate").value,
        to: $("#toDate").value,
        classKey: $("#classFilter").value,
        session: "2026/2027"
      }
    })
  });

  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.code || "Departure report failed.");
  }
  return data;
}

function render(data) {
  records = data.records || [];
  const summary = data.summary || {};
  $("#checkedOut").textContent = summary.checked_out || 0;
  $("#afterClosing").textContent = summary.stayed_after_closing || 0;
  $("#totalExcess").textContent = summary.total_excess_minutes || 0;
  $("#averageExcess").textContent = `${summary.average_excess_minutes || 0} min`;
  $("#reportTitle").textContent = `${data.from} to ${data.to} • ${records.length} records`;
  $("#emptyState").hidden = records.length > 0;
  $("#tableWrap").classList.toggle("hidden", !records.length);

  const body = $("#reportBody");
  body.innerHTML = "";
  records.forEach((record) => {
    const row = document.createElement("tr");
    const excess = Number(record.departure_excess_minutes || 0);
    row.innerHTML = `
      <td>${record.attendance_date}</td>
      <td><strong>${record.name}</strong>${record.admno ? `<br><small>${record.admno}</small>` : ""}</td>
      <td>${labels[record.class_key] || record.class_key}</td>
      <td>${time(record.first_check_in)}</td>
      <td>${time(record.last_check_out)}</td>
      <td>${record.daily_status}</td>
      <td>${duration(record.total_minutes_on_premises)}</td>
      <td class="${excess > 0 ? "excess" : "zero"}">${excess} min</td>`;
    body.appendChild(row);
  });
}

async function loadReport() {
  try {
    render(await requestReport());
    toast("Departure report loaded.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

function exportCsv() {
  if (!records.length) return toast("Load a report first.", "error");
  const rows = [[
    "Date", "Student", "Admission No.", "Class", "Arrival", "Departure",
    "Status", "Total minutes", "Excess minutes after 3:30"
  ]];
  records.forEach((r) => rows.push([
    r.attendance_date, r.name, r.admno || "", labels[r.class_key] || r.class_key,
    r.first_check_in || "", r.last_check_out || "", r.daily_status,
    r.total_minutes_on_premises, r.departure_excess_minutes
  ]));
  const csv = rows.map((row) => row.map((value) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`
  ).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `WTS_student_departures_${$("#fromDate").value}_${$("#toDate").value}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function initializeDates() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
  $("#fromDate").value = local;
  $("#toDate").value = local;
}

$("#connectButton").addEventListener("click", () => {
  const auth = credentials();
  $("#adminCode").value = auth?.adminCode || "";
  $("#adminSecret").value = auth?.adminSecret || "";
  $("#connectionDialog").showModal();
});

$("#connectionForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const adminCode = $("#adminCode").value.trim();
  const adminSecret = $("#adminSecret").value.trim();
  if (!adminCode || !adminSecret) return toast("Administrator code and secret are required.", "error");
  localStorage.setItem(STORE, JSON.stringify({ adminCode, adminSecret }));
  $("#connectionDialog").close();
  loadReport();
});

$("#loadButton").addEventListener("click", loadReport);
$("#exportButton").addEventListener("click", exportCsv);
initializeDates();
if (credentials()) loadReport();
