import { db, auth, storage } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const form = document.getElementById("listItemForm");
const statusMsg = document.getElementById("statusMsg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusMsg.textContent = "Uploading... please wait";

  try {
    const user = auth.currentUser;
    if (!user) {
      statusMsg.textContent = "⚠️ Pehle login karein.";
      return;
    }

    // 1. Upload photos
    const files = document.getElementById("itemPhotos").files;
    let imageUrls = [];
    for (let file of files) {
      const storageRef = ref(storage, `rental-images/${Date.now()}-${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      imageUrls.push(url);
    }

    // 2. Save to Firestore
    await addDoc(collection(db, "rental_items"), {
      ownerId: user.uid,
      title: document.getElementById("title").value,
      category: document.getElementById("category").value,
      size: document.getElementById("size").value,
      condition: document.getElementById("condition").value,
      pricePerDay: Number(document.getElementById("pricePerDay").value),
      securityDeposit: Number(document.getElementById("securityDeposit").value),
      images: imageUrls,
      status: "pending",
      consentGiven: true,
      verifiedByAdmin: false,
      createdAt: serverTimestamp()
    });

    statusMsg.textContent = "✅ Submit ho gaya! Admin approval ke baad live hoga.";
    form.reset();

  } catch (err) {
    console.error(err);
    statusMsg.textContent = "❌ Kuch galat hua: " + err.message;
  }
});
