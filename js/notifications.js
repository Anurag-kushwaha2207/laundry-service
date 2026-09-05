// js/notifications.js - Unified In-App & Email Notification Service
import { 
  collection, 
  addDoc, 
  setDoc,
  onSnapshot, 
  updateDoc, 
  doc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, auth } from "./firebase-config.js";
import { generateNotificationDocId, getReadableDateString } from "./db-helper.js";

// EmailJS Configuration
const EMAILJS_CONFIG = {
  serviceId: "service_zh1s3r6",
  templateId: "template_prqcd1s",
  publicKey: "b-KsCTAjFBN6kqWvJ"
};

// Initialize EmailJS if available
if (typeof emailjs !== "undefined" && EMAILJS_CONFIG.publicKey) {
  try {
    emailjs.init(EMAILJS_CONFIG.publicKey);
  } catch (e) {
    console.warn("EmailJS init warning:", e);
  }
}

/**
 * Send an in-app notification (and optionally send an EmailJS email)
 * Guaranteed to store exact user UID, lowercase email, and normalized phone for airtight delivery.
 */
export async function sendNotification({
  recipientUid = "",
  recipientEmail = "",
  recipientPhone = "",
  recipientName = "",
  title = "Notification",
  message = "",
  type = "info", // "item_rejection", "item_approval", "order_update", "refund", "damage_deduction"
  relatedId = "",
  emailSubject = ""
}) {
  try {
    const cleanEmail = (recipientEmail || "").trim().toLowerCase();
    const cleanPhone = (recipientPhone || "").replace(/[^0-9]/g, "");
    const cleanPhone10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : "";
    const cleanUid = (recipientUid || "").trim();

    // Prevent orphan notifications with no target identity
    if (!cleanEmail && !cleanPhone10 && !cleanUid) {
      console.warn("sendNotification skipped: No recipient identifier provided.");
      return null;
    }

    // 1. Write to Firestore `notifications` collection with structured readable ID
    const targetPhone = cleanPhone10 || cleanPhone || "";
    const targetName = (recipientName || cleanEmail.split("@")[0] || "User").trim();
    const notifDocId = generateNotificationDocId(targetName, targetPhone, type);

    const notifData = {
      recipientUid: cleanUid,
      recipientEmail: cleanEmail,
      recipientPhone: cleanPhone,
      recipientPhone10: cleanPhone10,
      recipientName: targetName,
      title,
      message,
      type,
      relatedId,
      read: false,
      readableDate: getReadableDateString(),
      displaySummary: `[${type || 'info'}] To: ${targetName} (${targetPhone || cleanEmail}) - ${title}`,
      createdAt: serverTimestamp()
    };

    await setDoc(doc(db, "notifications", notifDocId), notifData);
    console.log("In-app notification created with ID:", notifDocId);

    // 2. Send email via EmailJS in background if recipient email is present
    if (cleanEmail && typeof emailjs !== "undefined") {
      const templateParams = {
        to_email: cleanEmail,
        to_name: recipientName || cleanEmail.split("@")[0],
        subject: emailSubject || title,
        message: message,
        order_id: relatedId || "N/A"
      };

      emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, templateParams)
        .then(() => console.log("Email notification dispatched to:", cleanEmail))
        .catch(err => console.warn("Email dispatch failed (non-blocking):", err));
    }

    return notifDocId;
  } catch (error) {
    console.error("Error creating notification:", error);
    return null;
  }
}

/**
 * Initialize Notification Bell & Tray for the active user in the DOM
 */
export function initNotificationCenter() {
  const user = getActiveUser();
  if (!user) return;

  // Insert styles if not already present
  if (!document.getElementById("notifStyles")) {
    const style = document.createElement("style");
    style.id = "notifStyles";
    style.textContent = `
      .notif-bell-btn {
        position: relative;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        border-radius: 50%;
        width: 38px;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: #1e293b;
        font-size: 20px;
        transition: all 0.2s;
      }
      .notif-bell-btn:hover {
        background: #e2e8f0;
        transform: scale(1.05);
      }
      .notif-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        background: #ef4444;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 10px;
        box-shadow: 0 2px 6px rgba(239, 68, 68, 0.4);
      }
      .notif-dropdown {
        display: none;
        position: absolute;
        top: 48px;
        right: 0;
        width: 350px;
        max-width: 90vw;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.18);
        z-index: 10000;
        overflow: hidden;
      }
      .notif-dropdown.show {
        display: block;
        animation: notifFadeIn 0.2s ease-out;
      }
      @keyframes notifFadeIn {
        from { opacity: 0; transform: translateY(-8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .notif-header {
        padding: 14px 16px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .notif-header h4 {
        margin: 0;
        font-size: 15px;
        color: #0f172a;
        font-weight: 700;
      }
      .notif-list {
        max-height: 380px;
        overflow-y: auto;
        padding: 0;
        margin: 0;
        list-style: none;
      }
      .notif-item {
        padding: 14px 16px;
        border-bottom: 1px solid #f1f5f9;
        transition: background 0.15s;
        cursor: pointer;
      }
      .notif-item:hover {
        background: #f8fafc;
      }
      .notif-item.unread {
        background: #f0fdf4;
        border-left: 3px solid #16a34a;
      }
      .notif-item.unread.rejection {
        background: #fef2f2;
        border-left: 3px solid #ef4444;
      }
      .notif-item-title {
        font-size: 13.5px;
        font-weight: 700;
        color: #0f172a;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .notif-item-msg {
        font-size: 12.5px;
        color: #475569;
        line-height: 1.4;
        margin: 0;
      }
      .notif-item-time {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 6px;
      }
      .notif-empty {
        padding: 30px 20px;
        text-align: center;
        color: #94a3b8;
        font-size: 13.5px;
      }
    `;
    document.head.appendChild(style);
  }

  // Find placement container (nav-right or header)
  const navRight = document.querySelector(".nav-right") || document.querySelector(".list-nav") || document.querySelector(".nav-links");
  if (!navRight || document.getElementById("notifContainer")) return;

  const notifContainer = document.createElement("div");
  notifContainer.id = "notifContainer";
  notifContainer.style.position = "relative";
  notifContainer.style.display = "inline-block";

  notifContainer.innerHTML = `
    <button class="notif-bell-btn" id="notifBellBtn" title="In-App Notifications">
      <ion-icon name="notifications-outline"></ion-icon>
      <span class="notif-badge" id="notifBadge" style="display: none;">0</span>
    </button>
    <div class="notif-dropdown" id="notifDropdown">
      <div class="notif-header">
        <h4>🔔 In-App Notifications</h4>
        <button id="markAllReadBtn" style="background: none; border: none; font-size: 12px; color: #0284c7; cursor: pointer; font-weight: 600;">Mark all read</button>
      </div>
      <div class="notif-list" id="notifList">
        <div class="notif-empty">Loading notifications...</div>
      </div>
    </div>
  `;

  // Prepend or insert before username
  if (navRight.firstChild) {
    navRight.insertBefore(notifContainer, navRight.firstChild);
  } else {
    navRight.appendChild(notifContainer);
  }

  const bellBtn = document.getElementById("notifBellBtn");
  const dropdown = document.getElementById("notifDropdown");
  const notifBadge = document.getElementById("notifBadge");
  const notifList = document.getElementById("notifList");
  const markAllReadBtn = document.getElementById("markAllReadBtn");

  bellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("show");
  });

  document.addEventListener("click", (e) => {
    if (!notifContainer.contains(e.target)) {
      dropdown.classList.remove("show");
    }
  });

  // Function to listen to user's notifications in real time with 100% airtight precision
  let activeUnsubscribe = null;

  function listenToUserNotifications() {
    if (activeUnsubscribe) {
      activeUnsubscribe();
      activeUnsubscribe = null;
    }

    const currentUser = getActiveUser();
    if (!currentUser) {
      notifBadge.style.display = "none";
      notifList.innerHTML = `<div class="notif-empty">Please log in to view your notifications.</div>`;
      return;
    }

    const userUid = (currentUser.uid || "").trim();
    const userEmail = (currentUser.email || "").toLowerCase().trim();
    const rawUserPhone = (currentUser.phone || "").replace(/[^0-9]/g, "");
    const userPhone10 = rawUserPhone.length >= 10 ? rawUserPhone.slice(-10) : "";

    // Safety: If no identity is present, strictly show nothing to prevent leaks
    if (!userUid && !userEmail && !userPhone10) {
      notifBadge.style.display = "none";
      notifList.innerHTML = `<div class="notif-empty">Please log in to view your notifications.</div>`;
      return;
    }

    const notifsRef = collection(db, "notifications");
    activeUnsubscribe = onSnapshot(notifsRef, (snapshot) => {
      const userNotifs = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();

        // 3-Tier Strict Identity Matching:
        // 1. Exact UID match
        const notifUid = (data.recipientUid || "").trim();
        const matchUid = Boolean(userUid && notifUid && userUid === notifUid);

        // 2. Exact lowercase Email match
        const notifEmail = (data.recipientEmail || "").toLowerCase().trim();
        const matchEmail = Boolean(userEmail && notifEmail && userEmail === notifEmail);

        // 3. Normalized 10-digit Phone match (handles +91, 0, spaces, dashes)
        const rawNotifPhone = (data.recipientPhone || data.recipientPhone10 || "").replace(/[^0-9]/g, "");
        const notifPhone10 = rawNotifPhone.length >= 10 ? rawNotifPhone.slice(-10) : "";
        const matchPhone = Boolean(userPhone10 && notifPhone10 && userPhone10 === notifPhone10);

        // A notification is ONLY shown if it explicitly belongs to this user
        if (matchUid || matchEmail || matchPhone) {
          userNotifs.push({ id: docSnap.id, ...data });
        }
      });

      // Sort by createdAt desc
      userNotifs.sort((a, b) => {
        const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt || 0);
        const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt || 0);
        return tB - tA;
      });

      const unreadCount = userNotifs.filter(n => !n.read).length;
      if (unreadCount > 0) {
        notifBadge.textContent = unreadCount > 9 ? "9+" : unreadCount;
        notifBadge.style.display = "inline-block";
      } else {
        notifBadge.style.display = "none";
      }

      if (userNotifs.length === 0) {
        notifList.innerHTML = `<div class="notif-empty">No notifications yet. You're all caught up!</div>`;
        return;
      }

      notifList.innerHTML = userNotifs.map(n => {
        const isRejection = n.type === "item_rejection" || n.type === "damage_deduction";
        const icon = isRejection ? "alert-circle" : (n.type === "refund" ? "cash" : "information-circle");
        const iconColor = isRejection ? "#ef4444" : "#16a34a";

        return `
          <div class="notif-item ${!n.read ? 'unread ' + (isRejection ? 'rejection' : '') : ''}" data-id="${n.id}">
            <div class="notif-item-title">
              <ion-icon name="${icon}" style="color: ${iconColor}; font-size: 16px;"></ion-icon>
              <span>${n.title}</span>
            </div>
            <p class="notif-item-msg">${n.message}</p>
            <div class="notif-item-time">${formatNotifDate(n.createdAt)}</div>
          </div>
        `;
      }).join("");

      // Add click to mark single as read
      notifList.querySelectorAll(".notif-item").forEach(itemEl => {
        itemEl.addEventListener("click", async () => {
          const id = itemEl.dataset.id;
          try {
            await updateDoc(doc(db, "notifications", id), { read: true });
          } catch (err) {
            console.error("Error marking read:", err);
          }
        });
      });

      // Mark all as read
      markAllReadBtn.onclick = async () => {
        for (const n of userNotifs) {
          if (!n.read) {
            try {
              await updateDoc(doc(db, "notifications", n.id), { read: true });
            } catch (e) {}
          }
        }
      };
    }, (err) => {
      console.warn("Notifications listener error:", err);
    });
  }

  // Initial listener start
  listenToUserNotifications();

  // Also auto-refresh when Firebase Auth state changes
  if (auth && auth.onAuthStateChanged) {
    auth.onAuthStateChanged(() => {
      listenToUserNotifications();
    });
  }

  // Auto-refresh when localStorage user changes (login / logout across tabs or same tab)
  window.addEventListener("storage", (e) => {
    if (!e.key || e.key === "laundry_current_user") {
      listenToUserNotifications();
    }
  });

  // Custom event for immediate same-page session changes
  window.addEventListener("userSessionChanged", () => {
    listenToUserNotifications();
  });
}

function formatNotifDate(ts) {
  if (!ts) return "Just now";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function getActiveUser() {
  let user = null;
  try {
    const raw = localStorage.getItem("laundry_current_user");
    if (raw) user = JSON.parse(raw);
  } catch (e) {}

  if (auth && auth.currentUser) {
    if (!user) {
      user = {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email || "",
        phone: auth.currentUser.phoneNumber || "",
        name: auth.currentUser.displayName || "Valued Customer"
      };
    } else {
      if (!user.uid && auth.currentUser.uid) user.uid = auth.currentUser.uid;
      if (!user.email && auth.currentUser.email) user.email = auth.currentUser.email;
      if (!user.phone && auth.currentUser.phoneNumber) user.phone = auth.currentUser.phoneNumber;
    }
  }

  return user;
}

export const sendStatusNotification = sendNotification;

