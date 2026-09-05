// js/db-helper.js - Structured Document ID & Metadata Generator for Firebase Firestore

/**
 * Sanitizes any text string into a clean, Firestore-safe slug (alphanumeric and underscores).
 */
export function sanitizeIdToken(str, maxLen = 20) {
  if (!str) return 'data';
  const cleaned = String(str)
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned.substring(0, maxLen) || 'data';
}

/**
 * Returns formatted Indian Standard Time string for rich third-column readability.
 * Example: "05 Sep 2026, 04:15:30 PM"
 */
export function getReadableDateString(date = new Date()) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch (e) {
    return new Date().toISOString();
  }
}

/**
 * Returns compact timestamp for unique document IDs.
 * Example: "20260905_161530"
 */
export function getCompactTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  const ms = String(now.getMilliseconds()).padStart(3, '0').slice(0, 2);
  return `${y}${m}${d}_${hh}${mm}${ss}_${ms}`;
}

/**
 * Generates structured, self-descriptive Document ID for pickup_delivery_logs
 * Example: "LOG_Order_Maw6iIf_Step1_OwnerPickup_20260905_161530"
 */
export function generateLogDocId(bookingId, stage, stageStepNumber) {
  const bShort = sanitizeIdToken(bookingId || 'booking', 8);
  const stageSlug = sanitizeIdToken(stage || 'status', 15);
  const time = getCompactTimestamp();
  return `LOG_${bShort}_Step${stageStepNumber || 1}_${stageSlug}_${time}`;
}

/**
 * Generates structured, self-descriptive Document ID for rental_bookings
 * Example: "BOOKING_Sherwani_AnuragSingh_20260905_161530"
 */
export function generateBookingDocId(itemTitle, customerName) {
  const itemSlug = sanitizeIdToken(itemTitle || 'outfit', 14);
  const userSlug = sanitizeIdToken(customerName || 'customer', 12);
  const time = getCompactTimestamp();
  return `BOOKING_${itemSlug}_${userSlug}_${time}`;
}

/**
 * Generates structured, self-descriptive Document ID for rental_items
 * Example: "ITEM_EthnicWear_BlueSherwani_983710_20260905_161530"
 */
export function generateItemDocId(category, title, ownerPhoneOrName) {
  const catSlug = sanitizeIdToken(category || 'cloth', 10);
  const titleSlug = sanitizeIdToken(title || 'item', 14);
  const ownerSlug = sanitizeIdToken(ownerPhoneOrName || 'owner', 8);
  const time = getCompactTimestamp();
  return `ITEM_${catSlug}_${titleSlug}_${ownerSlug}_${time}`;
}

/**
 * Generates structured, self-descriptive Document ID for rental_complaints
 * Example: "COMPLAINT_DamagedOutfit_Sherwani_Anurag_20260905_161530"
 */
export function generateComplaintDocId(category, itemTitle, complainantName) {
  const catSlug = sanitizeIdToken(category || 'dispute', 14);
  const itemSlug = sanitizeIdToken(itemTitle || 'item', 12);
  const userSlug = sanitizeIdToken(complainantName || 'user', 10);
  const time = getCompactTimestamp();
  return `COMPLAINT_${catSlug}_${itemSlug}_${userSlug}_${time}`;
}

/**
 * Generates structured, self-descriptive Document ID for notifications
 * Example: "NOTIF_AnuragSingh_9837_OrderUpdate_20260905_161530"
 */
export function generateNotificationDocId(recipientName, recipientPhone, type) {
  const nameSlug = sanitizeIdToken(recipientName || 'user', 10);
  const phoneSlug = (recipientPhone || '').replace(/[^0-9]/g, '').slice(-4) || 'phone';
  const typeSlug = sanitizeIdToken(type || 'alert', 12);
  const time = getCompactTimestamp();
  return `NOTIF_${nameSlug}_${phoneSlug}_${typeSlug}_${time}`;
}

/**
 * Generates structured, self-descriptive Document ID for payments
 * Example: "PAY_pay_TYIIZldGd_Rs1110_AnuragSingh_20260905_161530"
 */
export function generatePaymentDocId(paymentId, amount, renterName) {
  const paySlug = sanitizeIdToken(paymentId || 'rzp', 14);
  const userSlug = sanitizeIdToken(renterName || 'user', 10);
  const time = getCompactTimestamp();
  return `PAY_${paySlug}_Rs${amount || 0}_${userSlug}_${time}`;
}
