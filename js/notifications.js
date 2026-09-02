/**
 * Notifications Utility Module (Step 15)
 * Triggers Toast alerts and WhatsApp / SMS link notifications on booking status changes
 */

/**
 * Trigger SMS / WhatsApp alert link or browser notification
 * @param {Object} params - { recipientPhone, recipientType, title, newStatus, bookingId }
 */
export function sendStatusNotification({ recipientPhone, recipientType, title, newStatus, bookingId }) {
  const statusMessages = {
    confirmed: `Your booking for "${title}" (ID: ${bookingId}) is confirmed! Payment received.`,
    picked_up_from_owner: `Pickup completed from Owner! "${title}" is heading to our laundry hub for professional cleaning.`,
    cleaning_in_progress: `"${title}" is currently undergoing premium eco-friendly dry cleaning.`,
    delivered_to_renter: `"${title}" has been delivered to Renter! Enjoy your outfit.`,
    picked_up_from_renter: `Return pickup completed! "${title}" is heading back for post-rental cleaning.`,
    returned_to_owner: `"${title}" has been cleaned and returned safely to the Owner. Booking completed!`
  };

  const messageText = statusMessages[newStatus] || `Booking update for "${title}": Status is now ${newStatus}.`;

  console.log(`[NOTIFICATION ALERT to ${recipientType} (${recipientPhone || 'N/A'})]:`, messageText);

  // If WhatsApp phone is available, generate quick WhatsApp API URL
  if (recipientPhone) {
    const cleanPhone = recipientPhone.replace(/[^0-9]/g, '');
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent("🧺 Laundry Service Update: " + messageText)}`;
    console.log("WhatsApp Notification Link:", waUrl);
  }

  // Display Toast Banner
  showToastNotification(`🔔 Notification: ${messageText}`);
}

/**
 * Toast Notification Banner
 */
export function showToastNotification(message, duration = 4000) {
  let toastContainer = document.getElementById("toastContainer");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toastContainer";
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  toast.className = "toast-banner";
  toast.innerHTML = `<span>${message}</span>`;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
