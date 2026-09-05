import { db, auth, storage } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const form = document.getElementById("listItemForm");
const submitBtn = document.getElementById("submitBtn");
const statusMsgBox = document.getElementById("statusMsgBox");
const authBanner = document.getElementById("authBanner");
const authBannerText = document.getElementById("authBannerText");
const authActionBtn = document.getElementById("authActionBtn");
const itemPhotosInput = document.getElementById("itemPhotos");
const previewsContainer = document.getElementById("previewsContainer");
const ownerContactInput = document.getElementById("ownerContact");

let activeUser = null;
let selectedImagesBase64 = [];

// 1. Detect Logged-in User (from Local Storage or Firebase Auth)
function checkUserSession() {
  const savedUser = localStorage.getItem("laundry_current_user");
  if (savedUser) {
    try {
      activeUser = JSON.parse(savedUser);
    } catch (e) {
      activeUser = null;
    }
  }

  // Also check Firebase Auth state
  auth.onAuthStateChanged((user) => {
    if (user) {
      if (!activeUser) {
        activeUser = {
          name: user.displayName || "User",
          email: user.email || "",
          phone: user.phoneNumber || "",
          uid: user.uid
        };
      } else {
        activeUser.uid = user.uid;
      }
    }
    updateUserBanner();
  });

  updateUserBanner();
}

function updateUserBanner() {
  if (activeUser) {
    authBanner.className = "auth-banner logged-in";
    const displayName = activeUser.name || "Customer";
    const displayContact = activeUser.email || activeUser.phone || "";
    authBannerText.innerHTML = `<span>👤 <strong>लॉग इन:</strong> ${displayName} (${displayContact})</span>`;
    authActionBtn.textContent = "Switch Account";
    authActionBtn.href = "../index.html";

    if (ownerContactInput && !ownerContactInput.value && activeUser.phone) {
      ownerContactInput.value = activeUser.phone;
    }
  } else {
    authBanner.className = "auth-banner not-logged";
    authBannerText.innerHTML = `<span>⚠️ आप लॉग इन नहीं हैं। कपड़े लिस्ट करने के लिए लॉग इन करें।</span>`;
    authActionBtn.textContent = "Log In Here";
    authActionBtn.href = "../index.html";
  }
}

// 2. Live Image Previews & Conversion to Base64
itemPhotosInput.addEventListener("change", (e) => {
  previewsContainer.innerHTML = "";
  selectedImagesBase64 = [];
  const files = e.target.files;

  if (!files || files.length === 0) return;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const reader = new FileReader();

    reader.onload = (event) => {
      const base64Data = event.target.result;
      selectedImagesBase64.push(base64Data);

      const img = document.createElement("img");
      img.src = base64Data;
      img.className = "preview-thumb";
      img.alt = `Photo ${i + 1}`;
      previewsContainer.appendChild(img);
    };

    reader.readAsDataURL(file);
  }
});

// Helper: Compress/Upload Images (Firebase Storage with Base64 fallback)
async function processPhotos(files) {
  let imageUrls = [];

  // If Storage upload works, upload. If not, use Base64 data URLs directly!
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const storageRef = ref(storage, `rental-images/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);
      imageUrls.push(downloadUrl);
    } catch (storageErr) {
      console.warn("Storage upload notice (using high-res Base64 fallback):", storageErr);
      if (selectedImagesBase64[i]) {
        imageUrls.push(selectedImagesBase64[i]);
      }
    }
  }

  // Fallback if array empty
  if (imageUrls.length === 0 && selectedImagesBase64.length > 0) {
    imageUrls = selectedImagesBase64;
  }

  // Default placeholder if none
  if (imageUrls.length === 0) {
    imageUrls.push("https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=600&q=80");
  }

  return imageUrls;
}

// 3. Form Submission Handler
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!activeUser) {
    alert("⚠️ कपड़े लिस्ट करने से पहले कृपया लॉगिन करें (Please log in first)!");
    window.location.href = "../index.html";
    return;
  }

  const files = itemPhotosInput.files;
  if (!files || files.length === 0) {
    alert("⚠️ कृपया कपड़ों की कम से कम 1 फ़ोटो ज़रूर अपलोड करें!");
    return;
  }

  // Disable submit button & show loading
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<ion-icon name="sync-outline" class="spin-icon"></ion-icon> <span>फ़ोटो अपलोड और लिस्टिंग हो रही है...</span>`;
  statusMsgBox.style.display = "none";

  try {
    // 1. Process Photos
    const imageUrls = await processPhotos(files);

    const title = document.getElementById("title").value.trim();
    const category = document.getElementById("category").value;
    const size = document.getElementById("size").value;
    const condition = document.getElementById("condition").value;
    const city = document.getElementById("city").value.trim();
    const pricePerDay = Number(document.getElementById("pricePerDay").value);
    const securityDeposit = Number(document.getElementById("securityDeposit").value);
    const ownerContact = document.getElementById("ownerContact").value.trim();

    // 2. Save Item to Firestore Collection 'rental_items'
    // Status is "approved" so it IMMEDIATELY appears in "Rent Clothes" (browse.html) for all users!
    const docRef = await addDoc(collection(db, "rental_items"), {
      ownerId: activeUser.uid || activeUser.email || "owner",
      ownerName: activeUser.name || "Valued Owner",
      ownerEmail: activeUser.email || "",
      ownerPhone: ownerContact || activeUser.phone || "",
      title: title,
      category: category,
      size: size,
      condition: condition,
      city: city || "India",
      pricePerDay: pricePerDay,
      securityDeposit: securityDeposit,
      images: imageUrls,
      status: "approved", // Live on marketplace instantly!
      consentGiven: true,
      verifiedByAdmin: true,
      createdAt: serverTimestamp()
    });

    console.log("✅ Item listed with ID:", docRef.id);

    // 3. Show Success Celebration Message
    statusMsgBox.className = "status-msg-box success";
    statusMsgBox.innerHTML = `
      <div style="font-size: 28px; margin-bottom: 8px;">🎉</div>
      <div style="font-size: 18px; font-weight: 700;">बधाई हो! आपके कपड़े सफलतापूर्वक लाइव लिस्ट हो गए हैं!</div>
      <p style="margin: 8px 0; font-size: 14px; color: #166534;">
        अब यह आइटम 'Rent Clothes' मार्केटप्लेस में सभी ग्राहकों को तुरंत दिखाई दे रहा है।
      </p>
      <a href="browse.html" class="view-market-btn">👗 'Rent Clothes' में अभी देखें (View in Marketplace)</a>
    `;
    statusMsgBox.style.display = "block";

    form.reset();
    previewsContainer.innerHTML = "";
    selectedImagesBase64 = [];

  } catch (err) {
    console.error("Listing Error:", err);
    statusMsgBox.className = "status-msg-box error";
    statusMsgBox.innerHTML = `❌ लिस्टिंग में कोई समस्या आई: ${err.message || "कृपया दोबारा प्रयास करें।"}`;
    statusMsgBox.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<ion-icon name="cloud-upload"></ion-icon> <span>🚀 कपड़े लाइव लिस्ट करें (Publish for Rent)</span>`;
  }
});

// Run session check on page load
checkUserSession();
