// js/map-picker.js - Interactive Visual Map Pinpoint Picker (Leaflet + OpenStreetMap)

let leafletLoaded = false;

// Dynamically load Leaflet CSS & JS
export function loadLeafletAssets() {
  return new Promise((resolve) => {
    if (leafletLoaded || window.L) {
      leafletLoaded = true;
      return resolve();
    }

    // Leaflet CSS
    if (!document.getElementById("leafletCss")) {
      const link = document.createElement("link");
      link.id = "leafletCss";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    // Leaflet JS
    if (!document.getElementById("leafletJs")) {
      const script = document.createElement("script");
      script.id = "leafletJs";
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => {
        leafletLoaded = true;
        resolve();
      };
      document.head.appendChild(script);
    } else {
      resolve();
    }
  });
}

/**
 * Open the interactive map picker modal
 * @param {Object} options
 * @param {number} [options.initialLat] Default latitude (e.g. 26.8467)
 * @param {number} [options.initialLng] Default longitude (e.g. 80.9462)
 * @param {Function} options.onConfirm Callback({ address, city, pincode, lat, lng })
 */
export async function openMapPicker({ initialLat, initialLng, onConfirm }) {
  await loadLeafletAssets();

  // Create or get modal elements
  let modal = document.getElementById("interactiveMapModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "interactiveMapModal";
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(4px);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      box-sizing: border-box;
    `;

    modal.innerHTML = `
      <div style="background: #ffffff; border-radius: 16px; width: 100%; max-width: 780px; height: 90vh; max-height: 640px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.35);">
        
        <!-- Modal Header -->
        <div style="padding: 16px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <ion-icon name="map" style="color: #0284c7; font-size: 24px;"></ion-icon>
            <div>
              <h3 style="margin: 0; font-size: 17px; color: #0f172a; font-weight: 700;">Pick Exact Doorstep Location on Map</h3>
              <p style="margin: 0; font-size: 12px; color: #64748b;">Drag the pin or click on the map to pinpoint the exact house / building</p>
            </div>
          </div>
          <button id="closeMapPickerBtn" style="background: none; border: none; font-size: 26px; color: #64748b; cursor: pointer; line-height: 1;">&times;</button>
        </div>

        <!-- Search & Locate Bar -->
        <div style="padding: 10px 16px; background: #ffffff; border-bottom: 1px solid #f1f5f9; display: flex; gap: 8px; align-items: center;">
          <div style="flex: 1; position: relative;">
            <input type="text" id="mapSearchInput" placeholder="🔍 Search colony, road, landmark, or city..." style="width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13.5px; box-sizing: border-box; font-family: inherit;">
          </div>
          <button id="mapSearchBtn" style="background: #0284c7; color: #fff; border: none; padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px; white-space: nowrap;">
            <ion-icon name="search"></ion-icon> Search
          </button>
          <button id="mapLocateMeBtn" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; padding: 10px 14px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px; white-space: nowrap;" title="Locate my GPS position">
            <ion-icon name="locate"></ion-icon> Locate Me
          </button>
        </div>

        <!-- Map Canvas -->
        <div id="locationPickerMap" style="flex: 1; width: 100%; background: #e2e8f0; position: relative;"></div>

        <!-- Live Selection Preview & Actions -->
        <div style="padding: 14px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 250px;">
            <div style="font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 2px;">SELECTED LOCATION:</div>
            <div id="mapAddressPreview" style="font-size: 13px; color: #0f172a; font-weight: 600; line-height: 1.4;">Drag the pin or click on map to select...</div>
            <div id="mapCoordsPreview" style="font-size: 11px; color: #64748b; margin-top: 2px;">Coordinates: -</div>
          </div>
          <button id="confirmLocationBtn" style="background: #15803d; color: #ffffff; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(21, 128, 61, 0.25);" disabled>
            <ion-icon name="checkmark-circle"></ion-icon> Confirm & Use This Location
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(modal);
  } else {
    modal.style.display = "flex";
  }

  const closeBtn = document.getElementById("closeMapPickerBtn");
  const searchInput = document.getElementById("mapSearchInput");
  const searchBtn = document.getElementById("mapSearchBtn");
  const locateMeBtn = document.getElementById("mapLocateMeBtn");
  const addressPreview = document.getElementById("mapAddressPreview");
  const coordsPreview = document.getElementById("mapCoordsPreview");
  const confirmBtn = document.getElementById("confirmLocationBtn");

  // Determine starting position (User's lat/lng, or default to Kanpur/India 26.4499, 80.3319)
  let curLat = parseFloat(initialLat) || 26.4499;
  let curLng = parseFloat(initialLng) || 80.3319;

  let selectedData = {
    address: "",
    city: "",
    pincode: "",
    lat: curLat,
    lng: curLng
  };

  // Close handler
  const closeModal = () => {
    modal.style.display = "none";
  };
  closeBtn.onclick = closeModal;

  // Initialize or reset Leaflet Map
  const mapContainer = document.getElementById("locationPickerMap");
  if (window._leafletPickerMap) {
    window._leafletPickerMap.remove();
  }

  const map = window.L.map(mapContainer).setView([curLat, curLng], 15);
  window._leafletPickerMap = map;

  // Tile layer (OpenStreetMap)
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  // Custom pulse icon for marker
  const markerIcon = window.L.divIcon({
    className: "custom-map-marker",
    html: `<div style="background: #ef4444; width: 22px; height: 22px; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;"><div style="background: #ffffff; width: 6px; height: 6px; border-radius: 50%;"></div></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  const marker = window.L.marker([curLat, curLng], {
    draggable: true,
    icon: markerIcon
  }).addTo(map);

  marker.bindPopup("<b>Your Doorstep Pin</b><br>Drag me to your exact house!").openPopup();

  // Reverse geocode handler
  async function updateLocationFromCoords(lat, lng) {
    selectedData.lat = lat;
    selectedData.lng = lng;
    coordsPreview.textContent = `Latitude: ${lat.toFixed(6)}, Longitude: ${lng.toFixed(6)}`;
    addressPreview.textContent = "Fetching doorstep address from map...";
    confirmBtn.disabled = true;

    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.address) {
          const a = data.address;
          const road = a.road || a.pedestrian || a.suburb || a.neighbourhood || a.residential || '';
          const locality = a.city || a.town || a.village || a.county || a.state_district || '';
          const state = a.state || '';
          const postcode = a.postcode || '';

          const street = [a.house_number, road, a.suburb].filter(Boolean).join(", ") || data.display_name.split(",").slice(0, 3).join(", ");
          const fullCity = locality || state || 'India';

          selectedData.address = street || fullCity;
          selectedData.city = fullCity;
          selectedData.pincode = postcode;

          addressPreview.textContent = `${street ? street + ', ' : ''}${fullCity}${postcode ? ' - ' + postcode : ''}`;
          confirmBtn.disabled = false;
          return;
        }
      }
    } catch (e) {
      console.warn("Reverse geocode error:", e);
    }

    selectedData.address = `Location near ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    addressPreview.textContent = selectedData.address;
    confirmBtn.disabled = false;
  }

  // Initial geocode
  updateLocationFromCoords(curLat, curLng);

  // Marker drag end
  marker.on("dragend", (e) => {
    const pos = marker.getLatLng();
    updateLocationFromCoords(pos.lat, pos.lng);
  });

  // Map click places marker
  map.on("click", (e) => {
    marker.setLatLng(e.latlng);
    updateLocationFromCoords(e.latlng.lat, e.latlng.lng);
  });

  // Search Address handler
  async function handleSearch() {
    const q = searchInput.value.trim();
    if (!q) return;

    searchBtn.disabled = true;
    searchBtn.textContent = "Searching...";

    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=in&limit=1`);
      if (resp.ok) {
        const results = await resp.json();
        if (results && results.length > 0) {
          const r = results[0];
          const lat = parseFloat(r.lat);
          const lng = parseFloat(r.lon);
          map.setView([lat, lng], 16);
          marker.setLatLng([lat, lng]);
          updateLocationFromCoords(lat, lng);
        } else {
          alert("Could not find this place on the map. Please try a nearby landmark or city.");
        }
      }
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      searchBtn.disabled = false;
      searchBtn.innerHTML = `<ion-icon name="search"></ion-icon> Search`;
    }
  }

  searchBtn.onclick = handleSearch;
  searchInput.onkeydown = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  // Locate Me handler
  locateMeBtn.onclick = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }

    locateMeBtn.disabled = true;
    locateMeBtn.textContent = "Locating...";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        map.setView([lat, lng], 17);
        marker.setLatLng([lat, lng]);
        updateLocationFromCoords(lat, lng);
        locateMeBtn.disabled = false;
        locateMeBtn.innerHTML = `<ion-icon name="locate"></ion-icon> Locate Me`;
      },
      (err) => {
        console.warn("Geolocation error:", err);
        alert("Could not detect GPS location automatically. Please use the search bar or move the pin on the map.");
        locateMeBtn.disabled = false;
        locateMeBtn.innerHTML = `<ion-icon name="locate"></ion-icon> Locate Me`;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Confirm Location Handler
  confirmBtn.onclick = () => {
    if (onConfirm) {
      onConfirm(selectedData);
    }
    closeModal();
  };

  // Invalidate map size after animation
  setTimeout(() => {
    map.invalidateSize();
  }, 250);
}
