import { db, auth } from "./firebase-config.js";
import { 
  collection, 
  addDoc, 
  setDoc,
  doc,
  getDocs, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { openMapPicker } from "./map-picker.js";
import { sendNotification } from "./notifications.js";
import { generateItemDocId, generateComplaintDocId, getReadableDateString } from "./db-helper.js";

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
    loadOwnerDashboardData();
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
    const ownerStreetAddress = document.getElementById("ownerStreetAddress") ? document.getElementById("ownerStreetAddress").value.trim() : "";
    const ownerLat = document.getElementById("ownerLat") ? document.getElementById("ownerLat").value : "";
    const ownerLng = document.getElementById("ownerLng") ? document.getElementById("ownerLng").value : "";
    const pricePerDay = Number(document.getElementById("pricePerDay").value);
    const securityDeposit = Number(document.getElementById("securityDeposit").value);
    const ownerContact = document.getElementById("ownerContact").value.trim();

    // Save Item to Firestore Collection 'rental_items' with clean readable ID
    const itemDocId = generateItemDocId(category, title, activeUser.name || ownerContact);
    const itemData = {
      ownerId: activeUser.uid || activeUser.email || "user",
      ownerName: activeUser.name || "Valued Owner",
      ownerEmail: activeUser.email || "",
      ownerPhone: ownerContact || activeUser.phone || "",
      title: title,
      category: category,
      size: size,
      condition: condition,
      city: city || "India",
      ownerStreetAddress: ownerStreetAddress,
      ownerLat: ownerLat || null,
      ownerLng: ownerLng || null,
      pricePerDay: pricePerDay,
      securityDeposit: securityDeposit,
      images: finalImages,
      status: "pending", // Enters 'Pending Approval' for admin review!
      consentGiven: true,
      verifiedByAdmin: false,
      readableDate: getReadableDateString(),
      displaySummary: `[Pending Approval] ${title} (${category}) by ${activeUser.name || 'Owner'} - ₹${pricePerDay}/day`,
      createdAt: serverTimestamp()
    };
    await setDoc(doc(db, "rental_items", itemDocId), itemData);

    console.log("✅ Outfit submitted for approval with ID:", itemDocId);

    // Send In-App & Email Notification to Owner
    sendNotification({
      recipientUid: activeUser.uid || "",
      recipientEmail: activeUser.email || "",
      recipientPhone: ownerContact || activeUser.phone || "",
      recipientName: activeUser.name || "Valued Owner",
      title: "Outfit Submitted for Review ⏳",
      message: `Your outfit "${title}" has been submitted for admin verification. Once verified, it will go live on the Rent Clothes marketplace!`,
      type: "info",
      relatedId: docRef.id,
      emailSubject: `Listing Submitted for Review: ${title}`
    });

    // Show Success Submission Message in English
    statusMsgBox.className = "status-msg-box success";
    statusMsgBox.innerHTML = `
      <div style="font-size: 32px; margin-bottom: 6px;">⏳</div>
      <div style="font-size: 18px; font-weight: 700; color: #0284c7;">Outfit Submitted for Review!</div>
      <p style="margin: 8px 0; font-size: 14px; color: #334155;">
        Thank you! Your outfit listing has been received. Our admin team will verify and approve it shortly. You can track status in your notifications.
      </p>
      <a href="browse.html" class="view-market-btn" style="background: #0284c7;">👗 View Rent Clothes Marketplace</a>
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

// Interactive Visual Map Picker for Owner Pickup
const pickOwnerOnMapBtn = document.getElementById("pickOwnerOnMapBtn");
const detectOwnerGpsBtn = document.getElementById("detectOwnerGpsBtn");
const ownerGpsStatus = document.getElementById("ownerGpsStatus");
const ownerStreetAddressInput = document.getElementById("ownerStreetAddress");
const ownerLatInput = document.getElementById("ownerLat");
const ownerLngInput = document.getElementById("ownerLng");
const cityInput = document.getElementById("city");

if (pickOwnerOnMapBtn) {
  pickOwnerOnMapBtn.addEventListener("click", () => {
    openMapPicker({
      initialLat: ownerLatInput ? ownerLatInput.value : null,
      initialLng: ownerLngInput ? ownerLngInput.value : null,
      onConfirm: (loc) => {
        if (ownerStreetAddressInput) ownerStreetAddressInput.value = loc.address;
        if (cityInput && loc.city) cityInput.value = loc.city;
        if (ownerLatInput) ownerLatInput.value = loc.lat;
        if (ownerLngInput) ownerLngInput.value = loc.lng;

        if (ownerGpsStatus) {
          ownerGpsStatus.style.display = "block";
          ownerGpsStatus.style.color = "#15803d";
          ownerGpsStatus.textContent = `📍 Doorstep Pinned on Map: ${loc.address} (Lat: ${loc.lat.toFixed(5)}, Lng: ${loc.lng.toFixed(5)})`;
        }
      }
    });
  });
}

if (detectOwnerGpsBtn) {
  detectOwnerGpsBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    detectOwnerGpsBtn.disabled = true;
    detectOwnerGpsBtn.innerHTML = `<ion-icon name="sync-outline" class="spin-icon"></ion-icon> <span>Detecting GPS...</span>`;
    ownerGpsStatus.style.display = "block";
    ownerGpsStatus.style.color = "#0369a1";
    ownerGpsStatus.textContent = "Connecting to GPS satellites for precise location...";

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        if (ownerLatInput) ownerLatInput.value = lat;
        if (ownerLngInput) ownerLngInput.value = lng;
        ownerGpsStatus.textContent = `📍 GPS Acquired (${lat.toFixed(5)}, ${lng.toFixed(5)}). Fetching address...`;

        try {
          const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
          if (resp.ok) {
            const geoData = await resp.json();
            if (geoData && geoData.address) {
              const road = geoData.address.road || geoData.address.suburb || geoData.address.neighbourhood || '';
              const locality = geoData.address.city || geoData.address.town || geoData.address.village || geoData.address.county || '';
              const postcode = geoData.address.postcode || '';

              if (road && ownerStreetAddressInput && !ownerStreetAddressInput.value) {
                ownerStreetAddressInput.value = `${road}${locality ? ', ' + locality : ''}${postcode ? ' - ' + postcode : ''}`;
              }
              if (locality && cityInput && (!cityInput.value || cityInput.value === 'India')) {
                cityInput.value = locality;
              }
            }
          }
        } catch (e) {
          console.warn("Reverse geocode warning:", e);
        }

        ownerGpsStatus.style.color = "#15803d";
        ownerGpsStatus.textContent = `✅ Exact GPS Doorstep Location Pinned (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
        detectOwnerGpsBtn.disabled = false;
        detectOwnerGpsBtn.innerHTML = `<ion-icon name="checkmark-circle"></ion-icon> <span>GPS Pinned!</span>`;
      },
      (error) => {
        console.warn("GPS error:", error);
        ownerGpsStatus.style.color = "#dc2626";
        ownerGpsStatus.textContent = "Could not automatically fetch GPS location. Please enter your address manually.";
        detectOwnerGpsBtn.disabled = false;
        detectOwnerGpsBtn.innerHTML = `<ion-icon name="locate"></ion-icon> <span>📍 Retry GPS</span>`;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// In-app Notifications
import("./notifications.js").then(module => {
  if (module.initNotificationCenter) module.initNotificationCenter();
}).catch(e => console.warn("Notifications init warning:", e));

// Run session check on page load
checkUserSession();

// ==========================================
// OWNER RENTAL & EARNINGS DASHBOARD LOGIC
// ==========================================
const tabListNewBtn = document.getElementById("tabListNewBtn");
const tabMyListingsBtn = document.getElementById("tabMyListingsBtn");
const listFormCard = document.getElementById("listFormCard");
const myListingsCard = document.getElementById("myListingsCard");
const myListingsBadge = document.getElementById("myListingsBadge");
const refreshMyListingsBtn = document.getElementById("refreshMyListingsBtn");

const statTotalListed = document.getElementById("statTotalListed");
const statApproved = document.getElementById("statApproved");
const statPending = document.getElementById("statPending");
const statTotalBookings = document.getElementById("statTotalBookings");
const statTotalPayout = document.getElementById("statTotalPayout");

const ownerItemsList = document.getElementById("ownerItemsList");
const ownerComplaintsList = document.getElementById("ownerComplaintsList");
const complaintsCountBadge = document.getElementById("complaintsCountBadge");

let myItemsData = [];
let myBookingsData = [];
let myComplaintsData = [];
let activeOwnerFilter = "all";

// Tab Switching
if (tabListNewBtn && tabMyListingsBtn) {
  tabListNewBtn.addEventListener("click", () => {
    tabListNewBtn.classList.add("active");
    tabMyListingsBtn.classList.remove("active");
    tabListNewBtn.style.background = "#0284c7";
    tabListNewBtn.style.color = "#ffffff";
    tabMyListingsBtn.style.background = "transparent";
    tabMyListingsBtn.style.color = "#475569";
    if (listFormCard) listFormCard.style.display = "block";
    if (myListingsCard) myListingsCard.style.display = "none";
  });

  tabMyListingsBtn.addEventListener("click", () => {
    tabMyListingsBtn.classList.add("active");
    tabListNewBtn.classList.remove("active");
    tabMyListingsBtn.style.background = "#0284c7";
    tabMyListingsBtn.style.color = "#ffffff";
    tabListNewBtn.style.background = "transparent";
    tabListNewBtn.style.color = "#475569";
    if (listFormCard) listFormCard.style.display = "none";
    if (myListingsCard) myListingsCard.style.display = "block";
    loadOwnerDashboardData();
  });
}

if (refreshMyListingsBtn) {
  refreshMyListingsBtn.addEventListener("click", () => loadOwnerDashboardData());
}

// Filter Buttons
document.querySelectorAll(".owner-filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".owner-filter-btn").forEach(b => {
      b.style.background = "#fff";
      b.style.color = "#475569";
      b.classList.remove("active");
    });
    btn.style.background = "#0284c7";
    btn.style.color = "#fff";
    btn.classList.add("active");
    activeOwnerFilter = btn.dataset.filter || "all";
    renderOwnerItems();
  });
});

// Load Owner Data from Firestore
async function loadOwnerDashboardData() {
  if (!activeUser) {
    if (ownerItemsList) {
      ownerItemsList.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #64748b;">
          <ion-icon name="lock-closed-outline" style="font-size: 36px; color: #94a3b8; margin-bottom: 8px;"></ion-icon>
          <h3 style="margin: 0 0 6px; color: #1e293b;">Please Log In to View Your Clothes</h3>
          <p style="margin: 0 0 16px; font-size: 14px;">Log in from the Home page with your account to access your rental listings and track earnings.</p>
          <a href="../index.html" class="view-market-btn" style="background: #0284c7;">Go to Home & Log In</a>
        </div>
      `;
    }
    return;
  }

  if (ownerItemsList) {
    ownerItemsList.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #64748b;">
        <ion-icon name="sync-outline" class="spin-icon" style="font-size: 28px;"></ion-icon>
        <p>Fetching your clothes & rental orders...</p>
      </div>
    `;
  }

  try {
    // 1. Fetch all items and filter by this user's identity
    const itemsSnap = await getDocs(collection(db, "rental_items"));
    myItemsData = [];
    itemsSnap.forEach(snap => {
      const data = snap.data();
      const isOwner = (activeUser.uid && data.ownerId === activeUser.uid) ||
                      (activeUser.email && data.ownerEmail && data.ownerEmail.toLowerCase() === activeUser.email.toLowerCase()) ||
                      (activeUser.phone && data.ownerPhone && data.ownerPhone === activeUser.phone);
      if (isOwner) {
        myItemsData.push({ id: snap.id, ...data });
      }
    });

    // 2. Fetch all bookings and match with user's items
    const bookingsSnap = await getDocs(collection(db, "rental_bookings"));
    myBookingsData = [];
    bookingsSnap.forEach(snap => {
      const bData = snap.data();
      const isMyBooking = myItemsData.some(it => it.id === bData.itemId) ||
                          (activeUser.uid && bData.ownerId === activeUser.uid) ||
                          (activeUser.email && bData.ownerEmail && bData.ownerEmail.toLowerCase() === activeUser.email.toLowerCase());
      if (isMyBooking) {
        myBookingsData.push({ id: snap.id, ...bData });
      }
    });

    // 3. Fetch complaints filed by this user
    const complaintsSnap = await getDocs(collection(db, "rental_complaints"));
    myComplaintsData = [];
    complaintsSnap.forEach(snap => {
      const cData = snap.data();
      const isMyComplaint = (activeUser.uid && cData.complainantId === activeUser.uid) ||
                            (activeUser.email && cData.complainantEmail && cData.complainantEmail.toLowerCase() === activeUser.email.toLowerCase()) ||
                            (activeUser.phone && cData.complainantPhone && cData.complainantPhone === activeUser.phone);
      if (isMyComplaint) {
        myComplaintsData.push({ id: snap.id, ...cData });
      }
    });

    // Calculate Summary Stats
    const totalListed = myItemsData.length;
    const approvedCount = myItemsData.filter(i => i.status === "approved").length;
    const pendingCount = myItemsData.filter(i => i.status === "pending").length;
    const totalBookings = myBookingsData.length;
    const totalRentEarned = myBookingsData.reduce((sum, b) => sum + (Number(b.rentalAmount) || 0), 0);

    if (myListingsBadge) myListingsBadge.textContent = totalListed;
    if (statTotalListed) statTotalListed.textContent = totalListed;
    if (statApproved) statApproved.textContent = approvedCount;
    if (statPending) statPending.textContent = pendingCount;
    if (statTotalBookings) statTotalBookings.textContent = totalBookings;
    if (statTotalPayout) statTotalPayout.textContent = `₹${totalRentEarned}`;

    renderOwnerItems();
    renderOwnerComplaints();

  } catch (err) {
    console.error("Error loading owner dashboard:", err);
    if (ownerItemsList) {
      ownerItemsList.innerHTML = `<div style="color: #b91c1c; padding: 20px; text-align: center;">❌ Error loading data: ${err.message}</div>`;
    }
  }
}

// Render Owner Item Cards with Tracking, Payout & Rejection Details
function renderOwnerItems() {
  if (!ownerItemsList) return;

  let filtered = [...myItemsData];
  if (activeOwnerFilter === "approved") {
    filtered = filtered.filter(i => i.status === "approved");
  } else if (activeOwnerFilter === "pending") {
    filtered = filtered.filter(i => i.status === "pending");
  } else if (activeOwnerFilter === "rejected") {
    filtered = filtered.filter(i => i.status === "rejected");
  } else if (activeOwnerFilter === "booked") {
    filtered = filtered.filter(i => myBookingsData.some(b => b.itemId === i.id));
  }

  if (filtered.length === 0) {
    ownerItemsList.innerHTML = `
      <div style="text-align: center; padding: 35px 20px; color: #64748b; background: #f8fafc; border-radius: 12px; border: 1px dashed #cbd5e1;">
        <ion-icon name="shirt-outline" style="font-size: 34px; color: #94a3b8; margin-bottom: 6px;"></ion-icon>
        <p style="margin: 0; font-weight: 600;">No clothes found in this category.</p>
        <p style="margin: 4px 0 0; font-size: 13px;">List more clothes to earn rental income!</p>
      </div>
    `;
    return;
  }

  ownerItemsList.innerHTML = filtered.map(item => {
    const itemImg = (item.images && item.images.length > 0) ? item.images[0] : 'https://via.placeholder.com/80x95?text=No+Photo';
    
    // Status Badge
    let statusBadge = `<span class="badge-status badge-pending">⏳ Under Admin Review</span>`;
    if (item.status === "approved") {
      statusBadge = `<span class="badge-status badge-approved">✅ Approved & Live</span>`;
    } else if (item.status === "rejected") {
      statusBadge = `<span class="badge-status badge-rejected">❌ Rejected</span>`;
    }

    // Matching Bookings for this item
    const itemBookings = myBookingsData.filter(b => b.itemId === item.id);

    return `
      <div class="owner-item-card">
        <div class="owner-item-header">
          <img src="${itemImg}" alt="${item.title}" class="owner-item-img">
          <div class="owner-item-details">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap;">
              <h3 style="margin: 0 0 4px; font-size: 16px; color: #0f172a; font-weight: 700;">${item.title}</h3>
              ${statusBadge}
            </div>
            <p style="margin: 0 0 6px; font-size: 13px; color: #64748b;">
              Category: <strong>${item.category || 'Clothing'}</strong> | Size: <strong>${item.size || 'Free Size'}</strong> | Location: <strong>${item.city || 'India'}</strong>
            </p>
            <div style="display: flex; gap: 14px; font-size: 13px;">
              <span>Rent: <strong style="color: #0284c7;">₹${item.pricePerDay || 0}/day</strong></span>
              <span>Deposit: <strong style="color: #475569;">₹${item.securityDeposit || 0}</strong></span>
              <span>Total Bookings: <strong style="color: #15803d;">${itemBookings.length}</strong></span>
            </div>
          </div>
        </div>

        ${item.status === "rejected" ? `
          <div class="rejection-banner">
            <ion-icon name="alert-circle-outline" style="font-size: 22px; flex-shrink: 0;"></ion-icon>
            <div>
              <strong style="display: block; margin-bottom: 2px;">❌ Listing Rejected by Admin</strong>
              <span>Reason: <em>${item.rejectionReason || 'The outfit details, images, or condition did not meet quality standards.'}</em></span>
            </div>
          </div>
        ` : ''}

        ${itemBookings.length > 0 ? `
          <div class="booking-tracking-box">
            <h4 style="margin: 0 0 10px; font-size: 14px; color: #166534; display: flex; align-items: center; gap: 6px;">
              <ion-icon name="car-sport-outline"></ion-icon> Active / Past Rental Bookings (${itemBookings.length})
            </h4>
            ${itemBookings.map(b => {
              // Stage name translation
              const stageMap = {
                "pickup_from_owner": "🚴 Rider Picking Up from You",
                "hub_cleaning": "🫧 At Washing Hub (Sanitizing & Dry Cleaning)",
                "out_for_delivery": "🚚 Out for Delivery to Customer",
                "delivered_to_customer": "✨ Outfit In Use by Customer",
                "return_to_hub": "🔄 Returned to Hub for Quality Inspection",
                "completed": "🎉 Returned to You & Completed"
              };
              const stageText = stageMap[b.deliveryStage] || "Processing Order";

              // Payout status badge
              const isPayoutDone = b.ownerPayoutStatus === "paid";
              const payoutBadge = isPayoutDone
                ? `<span style="color: #15803d; font-weight: 700;">✅ Rent Paid to Your Account</span>`
                : `<span style="color: #ea580c; font-weight: 700;">⏳ Payout Pending (Disbursed upon safe return)</span>`;

              // Deposit status badge
              let depositBadge = `<span style="color: #0369a1; font-weight: 600;">Held in Safe Custody</span>`;
              if (b.securityDepositStatus === "refunded") {
                depositBadge = `<span style="color: #15803d; font-weight: 700;">Refunded to Customer (No damage found)</span>`;
              } else if (b.securityDepositStatus === "forfeited") {
                depositBadge = `<span style="color: #b91c1c; font-weight: 700;">Deducted for Damage: ${b.deductionReason || 'Reported'}</span>`;
              }

              return `
                <div style="background: #ffffff; border: 1px solid #dcfce7; border-radius: 8px; padding: 12px; margin-bottom: 8px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 6px;">
                    <span style="font-size: 13px; font-weight: 700; color: #1e293b;">
                      Customer: ${b.renterName || 'Renter'} (<a href="tel:${b.renterPhone || ''}" style="color: #0284c7; text-decoration: none;">📞 ${b.renterPhone || 'N/A'}</a>)
                    </span>
                    <span style="font-size: 12px; background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 4px; font-weight: 700;">
                      ${stageText}
                    </span>
                  </div>
                  <div style="font-size: 12.5px; color: #475569; margin-bottom: 8px;">
                    <span>Rental Duration: <strong>${b.startDate || ''} to ${b.endDate || ''} (${b.rentalDays || 1} days)</strong></span>
                  </div>
                  <div class="finance-badge-row">
                    <div class="finance-badge">
                      <span>💰 Rent Earned: <strong>₹${b.rentalAmount || 0}</strong> &mdash; ${payoutBadge}</span>
                    </div>
                    <div class="finance-badge">
                      <span>🛡️ Security Deposit (₹${b.securityDeposit || 0}): ${depositBadge}</span>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        <!-- Action / Complaint Button -->
        <div style="display: flex; justify-content: flex-end;">
          <button type="button" class="raise-complaint-btn" 
            data-item-id="${item.id}" 
            data-item-title="${encodeURIComponent(item.title || 'Outfit')}"
            data-booking-id="${itemBookings.length > 0 ? itemBookings[0].id : ''}"
            style="background: #fef2f2; color: #b91c1c; border: 1px solid #fca5a5; padding: 7px 14px; border-radius: 6px; font-size: 12.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
            <ion-icon name="warning-outline"></ion-icon> ⚠️ Raise Complaint / Dispute to Admin
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Attach complaint button listeners
  document.querySelectorAll(".raise-complaint-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      openComplaintModal({
        itemId: btn.dataset.itemId,
        itemTitle: decodeURIComponent(btn.dataset.itemTitle || ''),
        bookingId: btn.dataset.bookingId || ''
      });
    });
  });
}

// Render User Complaints History
function renderOwnerComplaints() {
  if (!ownerComplaintsList) return;

  if (complaintsCountBadge) complaintsCountBadge.textContent = `${myComplaintsData.length} Ticket${myComplaintsData.length === 1 ? '' : 's'}`;

  if (myComplaintsData.length === 0) {
    ownerComplaintsList.innerHTML = `<p style="color: #94a3b8; font-size: 13.5px; margin: 0;">No complaints filed yet. You can report damage, payment delays, or disputes on any item above.</p>`;
    return;
  }

  ownerComplaintsList.innerHTML = myComplaintsData.map(c => {
    const isResolved = c.status === "resolved";
    const statusBadge = isResolved
      ? `<span style="background: #dcfce7; color: #15803d; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px;">✅ Resolved</span>`
      : `<span style="background: #fee2e2; color: #b91c1c; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px;">⏳ Open & Under Review by Admin</span>`;

    return `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 6px;">
          <strong style="font-size: 14px; color: #0f172a;">${c.category || 'Complaint'} &bull; ${c.itemTitle || 'Outfit'}</strong>
          ${statusBadge}
        </div>
        <p style="margin: 0 0 8px; font-size: 13px; color: #334155;">${c.description}</p>
        ${c.adminReply ? `
          <div style="background: #eff6ff; border-left: 3px solid #0284c7; padding: 8px 12px; border-radius: 0 6px 6px 0; font-size: 12.5px; color: #0369a1; margin-top: 6px;">
            <strong>💬 Admin Response:</strong> ${c.adminReply}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// Complaint Modal Management
const complaintModal = document.getElementById("complaintModal");
const complaintForm = document.getElementById("complaintForm");
const complaintItemId = document.getElementById("complaintItemId");
const complaintBookingId = document.getElementById("complaintBookingId");
const complaintItemTitle = document.getElementById("complaintItemTitle");
const complaintCategory = document.getElementById("complaintCategory");
const complaintDescription = document.getElementById("complaintDescription");
const closeComplaintModalBtn = document.getElementById("closeComplaintModalBtn");
const cancelComplaintBtn = document.getElementById("cancelComplaintBtn");

function openComplaintModal({ itemId, itemTitle, bookingId }) {
  if (complaintItemId) complaintItemId.value = itemId || '';
  if (complaintBookingId) complaintBookingId.value = bookingId || '';
  if (complaintItemTitle) complaintItemTitle.value = itemTitle || 'Rental Outfit';
  if (complaintCategory) complaintCategory.value = '';
  if (complaintDescription) complaintDescription.value = '';
  if (complaintModal) complaintModal.style.display = "flex";
}

if (closeComplaintModalBtn) {
  closeComplaintModalBtn.addEventListener("click", () => {
    if (complaintModal) complaintModal.style.display = "none";
  });
}
if (cancelComplaintBtn) {
  cancelComplaintBtn.addEventListener("click", () => {
    if (complaintModal) complaintModal.style.display = "none";
  });
}

if (complaintForm) {
  complaintForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeUser) {
      alert("Please log in first to submit a complaint.");
      return;
    }

    const itemId = complaintItemId.value;
    const bookingId = complaintBookingId.value;
    const itemTitle = complaintItemTitle.value;
    const category = complaintCategory.value;
    const description = complaintDescription.value.trim();

    try {
      const compDocId = generateComplaintDocId(category, itemTitle, activeUser.name || "Owner");
      const compData = {
        itemId: itemId,
        bookingId: bookingId,
        itemTitle: itemTitle,
        category: category,
        description: description,
        complainantId: activeUser.uid || activeUser.email || "user",
        complainantName: activeUser.name || "Owner",
        complainantEmail: activeUser.email || "",
        complainantPhone: activeUser.phone || "",
        complainantRole: "owner",
        status: "open",
        adminReply: "",
        readableDate: getReadableDateString(),
        displaySummary: `[Open] Complaint on ${itemTitle} (${category}) by ${activeUser.name || 'Owner'}: "${description}"`,
        createdAt: serverTimestamp()
      };
      await setDoc(doc(db, "rental_complaints", compDocId), compData);

      console.log("✅ Complaint submitted with ID:", compDocId);

      // In-app & Email Notification to Owner
      sendNotification({
        recipientUid: activeUser.uid || "",
        recipientEmail: activeUser.email,
        recipientPhone: activeUser.phone,
        recipientName: activeUser.name || "Valued User",
        title: "Dispute / Complaint Registered",
        message: `Your complaint regarding "${itemTitle}" has been submitted to the admin team. We will review it shortly.`,
        type: "info",
        relatedId: compRef.id,
        emailSubject: `Complaint Registered: ${category}`
      });

      alert("✅ Your complaint has been submitted directly to the Admin. You will receive updates in your dashboard.");
      if (complaintModal) complaintModal.style.display = "none";
      loadOwnerDashboardData();

    } catch (err) {
      console.error("Error submitting complaint:", err);
      alert("Error submitting complaint: " + err.message);
    }
  });
}


