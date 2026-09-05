import { db, auth } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("listItemForm");
const submitBtn = document.getElementById("submitBtn");
const statusMsgBox = document.getElementById("statusMsgBox");
const authBanner = document.getElementById("authBanner");
const authBannerText = document.getElementById("authBannerText");
const itemPhotosInput = document.getElementById("itemPhotos");
const previewsContainer = document.getElementById("previewsContainer");
const ownerContactInput = document.getElementById("ownerContact");

let activeUser = null;
let processedImageUrls = [];

// 1. Detect Logged-in User (Session check)
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
          name: user.displayName || "Customer",
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
    const displayContact = activeUser.email || activeUser.phone || "Active Session";
    authBannerText.innerHTML = `<span>👤 Logged in as: <strong>${displayName}</strong> (${displayContact})</span>`;

    if (ownerContactInput && !ownerContactInput.value && activeUser.phone) {
      ownerContactInput.value = activeUser.phone;
    }
  } else {
    authBanner.className = "auth-banner not-logged";
    authBannerText.innerHTML = `<span>⚠️ You are not logged in. <a href="../index.html" class="auth-login-link">Please log in from Home</a> to list your clothes for rent.</span>`;
  }
}

// 2. High-speed Client-Side Image Compression using HTML5 Canvas
// Converts large photos to lightweight, optimized JPEG data URLs in milliseconds!
function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.72) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.onerror = () => {
        resolve("https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=600&q=80");
      };
      img.src = e.target.result;
    };
    reader.onerror = () => {
      resolve("https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=600&q=80");
    };
    reader.readAsDataURL(file);
  });
}

// Live Photo Selection & Instant Thumbnail Preview
itemPhotosInput.addEventListener("change", async (e) => {
  previewsContainer.innerHTML = "";
  processedImageUrls = [];
  const files = e.target.files;

  if (!files || files.length === 0) return;

  for (let i = 0; i < files.length && i < 5; i++) {
    const file = files[i];
    const compressedDataUrl = await compressImage(file);
    processedImageUrls.push(compressedDataUrl);

    const img = document.createElement("img");
    img.src = compressedDataUrl;
    img.className = "preview-thumb";
    img.alt = `Outfit Photo ${i + 1}`;
    previewsContainer.appendChild(img);
  }
});

// 3. Form Submission Handler
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!activeUser) {
    alert("⚠️ Please log in from the Home page before listing clothes for rent!");
    window.location.href = "../index.html";
    return;
  }

  const files = itemPhotosInput.files;
  if ((!files || files.length === 0) && processedImageUrls.length === 0) {
    alert("⚠️ Please select at least 1 photo of your outfit!");
    return;
  }

  // Disable button & show fast loading status
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<ion-icon name="sync-outline" class="spin-icon"></ion-icon> <span>Publishing your listing...</span>`;
  statusMsgBox.style.display = "none";

  try {
    // Process photos if not already processed
    let finalImages = [...processedImageUrls];
    if (finalImages.length === 0 && files && files.length > 0) {
      for (let i = 0; i < files.length && i < 5; i++) {
        const compressed = await compressImage(files[i]);
        finalImages.push(compressed);
      }
    }

    if (finalImages.length === 0) {
      finalImages.push("https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=600&q=80");
    }

    const title = document.getElementById("title").value.trim();
    const category = document.getElementById("category").value;
    const size = document.getElementById("size").value;
    const condition = document.getElementById("condition").value;
    const city = document.getElementById("city").value.trim();
    const pricePerDay = Number(document.getElementById("pricePerDay").value);
    const securityDeposit = Number(document.getElementById("securityDeposit").value);
    const ownerContact = document.getElementById("ownerContact").value.trim();

    // Save Item to Firestore Collection 'rental_items'
    // Status is 'approved' so it appears IMMEDIATELY in 'Rent Clothes' (browse.html) for all users!
    const docRef = await addDoc(collection(db, "rental_items"), {
      ownerId: activeUser.uid || activeUser.email || "user",
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
      images: finalImages,
      status: "approved", // Live on marketplace instantly!
      consentGiven: true,
      verifiedByAdmin: true,
      createdAt: serverTimestamp()
    });

    console.log("✅ Outfit listed successfully with ID:", docRef.id);

    // Show Success Celebration Message in English
    statusMsgBox.className = "status-msg-box success";
    statusMsgBox.innerHTML = `
      <div style="font-size: 32px; margin-bottom: 6px;">🎉</div>
      <div style="font-size: 18px; font-weight: 700; color: #15803d;">Congratulations! Your outfit has been listed successfully!</div>
      <p style="margin: 8px 0; font-size: 14px; color: #166534;">
        Your listing is now live in the 'Rent Clothes' marketplace and visible to all customers immediately.
      </p>
      <a href="browse.html" class="view-market-btn">👗 View in Rent Clothes Marketplace</a>
    `;
    statusMsgBox.style.display = "block";

    form.reset();
    previewsContainer.innerHTML = "";
    processedImageUrls = [];

  } catch (err) {
    console.error("Listing Error:", err);
    statusMsgBox.className = "status-msg-box error";
    statusMsgBox.innerHTML = `❌ Error publishing listing: ${err.message || "Please check your network connection and try again."}`;
    statusMsgBox.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<ion-icon name="cloud-upload"></ion-icon> <span>🚀 Publish Clothes for Rent</span>`;
  }
});

// Run session check on page load
checkUserSession();
