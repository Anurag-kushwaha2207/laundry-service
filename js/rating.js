import { db, auth } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showToastNotification } from "./notifications.js";

/**
 * Open Rating Modal Component (Step 16)
 * Allows Owner or Renter to rate each other out of 5 stars with feedback.
 */
export function openRatingModal({ bookingId, itemId, itemTitle, targetUserId, role }) {
  // Remove existing modal if any
  const oldModal = document.getElementById("ratingModal");
  if (oldModal) oldModal.remove();

  const modal = document.createElement("div");
  modal.id = "ratingModal";
  modal.className = "modal active";
  modal.innerHTML = `
    <div class="modal-content rating-modal-content">
      <span class="close-modal-btn" id="closeRatingModal">&times;</span>
      <h2>⭐ Rate & Review</h2>
      <p class="rating-subtitle">How was your rental experience for <strong>${itemTitle}</strong>?</p>

      <form id="ratingForm">
        <div class="star-rating-box">
          <input type="radio" name="stars" id="star5" value="5" required><label for="star5">★</label>
          <input type="radio" name="stars" id="star4" value="4"><label for="star4">★</label>
          <input type="radio" name="stars" id="star3" value="3"><label for="star3">★</label>
          <input type="radio" name="stars" id="star2" value="2"><label for="star2">★</label>
          <input type="radio" name="stars" id="star1" value="1"><label for="star1">★</label>
        </div>

        <textarea id="ratingFeedback" placeholder="Write feedback about outfit condition, cleanliness, or punctuality..." rows="3"></textarea>

        <button type="submit" class="submit-rating-btn">Submit Review</button>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("closeRatingModal").onclick = () => modal.remove();

  document.getElementById("ratingForm").onsubmit = async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) {
      alert("Pehele login karein.");
      return;
    }

    const selectedStar = document.querySelector('input[name="stars"]:checked');
    const ratingValue = selectedStar ? Number(selectedStar.value) : 5;
    const feedback = document.getElementById("ratingFeedback").value.trim();

    try {
      await addDoc(collection(db, "rental_ratings"), {
        bookingId: bookingId,
        itemId: itemId,
        reviewerId: user.uid,
        targetUserId: targetUserId,
        reviewerRole: role, // "renter" or "owner"
        stars: ratingValue,
        feedback: feedback,
        createdAt: serverTimestamp()
      });

      showToastNotification("⭐ Thank you! Your review has been submitted.");
      modal.remove();
    } catch (err) {
      console.error("Error submitting rating:", err);
      alert("Error submitting rating: " + err.message);
    }
  };
}
