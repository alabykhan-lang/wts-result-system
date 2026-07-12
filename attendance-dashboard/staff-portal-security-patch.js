"use strict";
(() => {
  const PHOTO_BUCKET = "staff-profile-photos";
  const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Crect width='128' height='128' rx='22' fill='%23e8eef6'/%3E%3Ccircle cx='64' cy='47' r='22' fill='%230f7c5c' opacity='.25'/%3E%3Cpath d='M25 112c5-27 23-41 39-41s34 14 39 41' fill='%230f7c5c' opacity='.25'/%3E%3Ctext x='64' y='69' text-anchor='middle' font-size='22' font-family='Arial' font-weight='700' fill='%230b1f3a'%3EST%3C/text%3E%3C/svg%3E";

  async function validatePhoto(file) {
    if (!file) return;
    if (!PHOTO_TYPES.has(file.type)) throw new Error("Use a JPEG, PNG or WebP photograph.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Photograph must not exceed 5 MB.");
    if ("createImageBitmap" in window) {
      const bitmap = await createImageBitmap(file);
      const valid = bitmap.width >= 250 && bitmap.height >= 250;
      bitmap.close();
      if (!valid) throw new Error("Use a photograph of at least 250 × 250 pixels.");
    }
  }

  uploadPhoto = async function secureUploadPhoto(file, userId) {
    if (!file) return currentAccount?.photo_url || null;
    await validatePhoto(file);
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${userId}/profile.${extension}`;
    const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: "3600"
    });
    if (error) throw error;
    return path;
  };

  const originalRenderAccount = renderAccount;
  renderAccount = function secureRenderAccount(result) {
    originalRenderAccount(result);
    const path = result?.account?.photo_url;
    const image = $("#profileImage");
    image.src = DEFAULT_AVATAR;
    if (!path) return;
    if (/^https?:\/\//i.test(path)) {
      image.src = path;
      return;
    }
    client.storage.from(PHOTO_BUCKET).createSignedUrl(path, 900).then(({ data, error }) => {
      if (!error && data?.signedUrl) image.src = data.signedUrl;
    });
  };

  const registerForm = $("#registerForm");
  registerForm.addEventListener("submit", (event) => {
    const password = $("#regPassword").value;
    let message = "";
    if (password.length < 8) message = "Password must contain at least 8 characters.";
    else if (!/[A-Z]/.test(password)) message = "Add at least one uppercase letter.";
    else if (!/[a-z]/.test(password)) message = "Add at least one lowercase letter.";
    else if (!/[0-9]/.test(password)) message = "Add at least one number.";
    if (!message) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toast(message, "error");
  }, true);

  const photoInput = $("#profilePhoto");
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files[0];
    if (!file) return;
    try {
      await validatePhoto(file);
      const preview = URL.createObjectURL(file);
      $("#profileImage").src = preview;
      window.setTimeout(() => URL.revokeObjectURL(preview), 10000);
    } catch (error) {
      photoInput.value = "";
      toast(error.message, "error");
    }
  });

  const privacy = document.createElement("div");
  privacy.className = "status-box active";
  privacy.style.marginTop = "12px";
  privacy.innerHTML = "<strong>Private photograph storage</strong><br>Your image is stored in your own protected folder and displayed through a temporary signed link.";
  photoInput.closest(".field").insertAdjacentElement("afterend", privacy);
})();
