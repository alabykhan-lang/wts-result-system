"use strict";

const client = window.supabase.createClient(
  "https://wuftzyeajmsxdrbwaawl.supabase.co",
  "sb_publishable_7AKtP6jh9xg8CdrK8F53xA_q4yZskPJ"
);

const $ = (selector) => document.querySelector(selector);
let currentAccount = null;

function toast(message, type = "default") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  $("#toastContainer").appendChild(item);
  setTimeout(() => item.remove(), 4500);
}

function setDefaultDates() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
  $("#attendanceFrom").value = `${local.slice(0, 8)}01`;
  $("#attendanceTo").value = local;
}

async function registerStaff(event) {
  event.preventDefault();
  const metadata = {
    portal: "staff_attendance",
    full_name: $("#regName").value.trim(),
    phone: $("#regPhone").value.trim(),
    address: $("#regAddress").value.trim(),
    staff_category: $("#regCategory").value,
    department: $("#regDepartment").value.trim(),
    designation: $("#regDesignation").value.trim()
  };

  const { data, error } = await client.auth.signUp({
    email: $("#regEmail").value.trim(),
    password: $("#regPassword").value,
    options: { data: metadata }
  });

  if (error) return toast(error.message, "error");
  if (data.session) {
    toast("Account created. Complete your profile and await approval.", "success");
    await loadAccount();
  } else {
    toast("Registration received. Confirm your email, then sign in.", "success");
  }
}

async function signIn(event) {
  event.preventDefault();
  const { error } = await client.auth.signInWithPassword({
    email: $("#loginEmail").value.trim(),
    password: $("#loginPassword").value
  });
  if (error) return toast(error.message, "error");
  await loadAccount();
}

async function requestPasswordReset() {
  const email = $("#loginEmail").value.trim();
  if (!email) return toast("Enter your email address first.", "error");
  const { error } = await client.auth.resetPasswordForEmail(email);
  toast(error ? error.message : "Password-reset instructions sent.", error ? "error" : "success");
}

async function uploadPhoto(file, userId) {
  if (!file) return currentAccount?.photo_url || null;
  if (file.size > 5 * 1024 * 1024) throw new Error("Photograph must not exceed 5 MB.");
  const extension = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${userId}/profile.${extension}`;
  const { error } = await client.storage.from("staff-profile-photos").upload(path, file, {
    upsert: true,
    contentType: file.type
  });
  if (error) throw error;
  const publicUrl = client.storage.from("staff-profile-photos").getPublicUrl(path).data.publicUrl;
  return `${publicUrl}?v=${Date.now()}`;
}

async function saveProfile(event) {
  event.preventDefault();
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) return toast("Please sign in again.", "error");

  try {
    const photoUrl = await uploadPhoto($("#profilePhoto").files[0], userData.user.id);
    const { data, error } = await client.rpc("staff_portal_update_my_application", {
      p_full_name: $("#profileFullName").value.trim(),
      p_phone: $("#profilePhone").value.trim(),
      p_address: $("#profileAddress").value.trim(),
      p_requested_category: $("#profileCategory").value,
      p_requested_department: $("#profileDepartment").value.trim(),
      p_requested_designation: $("#profileDesignation").value.trim(),
      p_photo_url: photoUrl
    });
    if (error) throw error;
    if (data?.ok === false) throw new Error(data.code);
    toast("Staff profile saved.", "success");
    await loadAccount();
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderAccount(result) {
  currentAccount = result.account;
  const profile = result.staff_profile || {};
  $("#authArea").classList.add("hidden");
  $("#accountArea").classList.remove("hidden");
  $("#profileName").textContent = currentAccount.full_name;
  $("#profileEmail").textContent = currentAccount.email;
  $("#profileFullName").value = currentAccount.full_name || "";
  $("#profilePhone").value = currentAccount.phone || "";
  $("#profileAddress").value = currentAccount.address || "";
  $("#profileCategory").value = currentAccount.requested_category || "teaching";
  $("#profileDepartment").value = currentAccount.requested_department || "";
  $("#profileDesignation").value = currentAccount.requested_designation || "";
  $("#profileImage").src = currentAccount.photo_url || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='92' height='92'%3E%3Crect width='100%25' height='100%25' fill='%23e8eef6'/%3E%3Ctext x='50%25' y='56%25' text-anchor='middle' font-size='28' fill='%230b1f3a'%3EST%3C/text%3E%3C/svg%3E";

  const status = currentAccount.application_status;
  const box = $("#accountStatus");
  box.className = `status-box ${status}`;
  if (status === "active") {
    box.innerHTML = `<strong>Account active</strong><br>Attendance Staff ID: ${profile.staff_number || "Pending assignment"} • ${profile.designation || profile.staff_category || "Staff"}`;
    $("#attendanceMessage").classList.add("hidden");
  } else if (status === "rejected") {
    box.innerHTML = `<strong>Application rejected</strong><br>${currentAccount.rejection_reason || "Contact school management."}`;
  } else {
    box.innerHTML = `<strong>${status === "pending" ? "Pending management approval" : `Account ${status}`}</strong><br>Your submitted profile remains separate from the result portal.`;
  }
}

async function loadAccount() {
  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    $("#authArea").classList.remove("hidden");
    $("#accountArea").classList.add("hidden");
    return;
  }
  const { data, error } = await client.rpc("staff_portal_get_my_account");
  if (error) return toast(error.message, "error");
  if (data?.ok === false) return toast(data.code, "error");
  renderAccount(data);
}

function formatTime(value) {
  return value ? new Date(value).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }) : "—";
}

async function loadAttendance() {
  if (currentAccount?.application_status !== "active") {
    return toast("Management approval is required.", "error");
  }
  const { data, error } = await client.rpc("staff_portal_get_my_attendance", {
    p_from: $("#attendanceFrom").value || null,
    p_to: $("#attendanceTo").value || null
  });
  if (error) return toast(error.message, "error");
  if (data?.ok === false) return toast(data.code, "error");

  const records = data.records || [];
  const list = $("#attendanceList");
  list.innerHTML = "";
  $("#attendanceMessage").classList.toggle("hidden", records.length > 0);
  if (!records.length) {
    $("#attendanceMessage").innerHTML = "<h4>No attendance records</h4><p>No check-in or checkout exists for this period.</p>";
    return;
  }
  records.forEach((record) => {
    const minutes = Number(record.worked_minutes || 0);
    const row = document.createElement("div");
    row.className = "record";
    row.innerHTML = `<strong>${record.attendance_date}</strong><span>In ${formatTime(record.first_check_in)} • Out ${formatTime(record.last_check_out)}</span><span>${record.daily_status} • ${Math.floor(minutes / 60)}h ${minutes % 60}m</span>`;
    list.appendChild(row);
  });
}

async function signOut() {
  await client.auth.signOut();
  currentAccount = null;
  await loadAccount();
}

$("#registerForm").addEventListener("submit", registerStaff);
$("#loginForm").addEventListener("submit", signIn);
$("#resetPassword").addEventListener("click", requestPasswordReset);
$("#profileForm").addEventListener("submit", saveProfile);
$("#loadAttendance").addEventListener("click", loadAttendance);
$("#logoutButton").addEventListener("click", signOut);
client.auth.onAuthStateChange(() => loadAccount());
setDefaultDates();
loadAccount();
