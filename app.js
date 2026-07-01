// BikeRoadManager - Core Application JavaScript

document.addEventListener("DOMContentLoaded", () => {
  // --- State Configuration ---
  const state = {
    startLatLng: null,  // L.LatLng of starting point
    destLatLng: null,   // L.LatLng of destination (only for A-B mode)
    mode: "loop",       // "loop", "outback", "point2point"
    targetDistance: 50, // in km
    tolerance: 5,       // in km
    direction: "any",   // "any", "N", "E", "S", "W"
    strictRoad: true,
    avoidTraffic: true,
    routesData: [null, null, null], // data returned by BRouter for each alternative
    activeRouteIdx: 0,
    polylines: [null, null, null], // Leaflet polyline objects
    startMarker: null,
    destMarker: null,
    waypointMarkers: [] // markers for waypoints
  };

  // --- Constants ---
  const ROUTE_ACCENTS = ["#00d2ff", "#10b981", "#ec4899"];
  const ROUTING_PROFILES = {
    strictRoad: {
      standard: "fastbike",
      lowtraffic: "fastbike-lowtraffic"
    },
    gravel: {
      standard: "trekking",
      lowtraffic: "trekking"
    }
  };

  // --- Map Initialization ---
  const map = L.map("map", {
    zoomControl: false // Move zoom control to top-right
  }).setView([48.8566, 2.3522], 13); // Default center Paris

  L.control.zoom({ position: "topright" }).addTo(map);

  // CartoDB Dark Matter tile layer
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // --- Geolocation ---
  function geolocateUser() {
    if (!navigator.geolocation) {
      alert("La géolocalisation n'est pas supportée par votre navigateur.");
      return;
    }
    
    const locateBtn = document.getElementById("locate-btn");
    locateBtn.disabled = true;
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setStartPoint(L.latLng(lat, lng));
        map.setView([lat, lng], 13);
        locateBtn.disabled = false;
        
        // Reverse geocode to show address in input
        reverseGeocode(lat, lng);
      },
      (error) => {
        console.error("Geolocation error:", error);
        alert("Impossible de récupérer votre position.");
        locateBtn.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  }

  // --- Set Start and Destination Points ---
  function setStartPoint(latlng) {
    state.startLatLng = latlng;
    
    if (state.startMarker) {
      state.startMarker.setLatLng(latlng);
    } else {
      const startIcon = L.divIcon({
        className: 'custom-start-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      state.startMarker = L.marker(latlng, { icon: startIcon, draggable: true }).addTo(map);
      
      // Update when start point is dragged
      state.startMarker.on("dragend", (e) => {
        const newLatLng = e.target.getLatLng();
        state.startLatLng = newLatLng;
        reverseGeocode(newLatLng.lat, newLatLng.lng);
      });
    }
    
    // Hide overlay instruction
    document.getElementById("instruction-overlay").classList.add("hidden");
  }

  function setDestPoint(latlng) {
    state.destLatLng = latlng;
    
    if (state.destMarker) {
      state.destMarker.setLatLng(latlng);
    } else {
      const destIcon = L.divIcon({
        className: 'custom-start-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      state.destMarker = L.marker(latlng, { icon: destIcon, draggable: true }).addTo(map);
      
      // Change color/pulse of dest marker in CSS or style
      state.destMarker.getElement().style.borderColor = "#ec4899";
      state.destMarker.getElement().style.boxShadow = "0 0 15px #ec4899";
      
      state.destMarker.on("dragend", (e) => {
        const newLatLng = e.target.getLatLng();
        state.destLatLng = newLatLng;
        reverseGeocodeDest(newLatLng.lat, newLatLng.lng);
      });
    }
  }

  // Handle map click
  map.on("click", (e) => {
    if (state.mode === "point2point" && state.startLatLng && !state.destLatLng) {
      setDestPoint(e.latlng);
      reverseGeocodeDest(e.latlng.lat, e.latlng.lng);
    } else {
      setStartPoint(e.latlng);
      reverseGeocode(e.latlng.lat, e.latlng.lng);
    }
  });

  // --- Geocoding / Autocomplete API ---
  const addressInput = document.getElementById("address-input");
  const autocompleteList = document.getElementById("autocomplete-list");
  const destInput = document.getElementById("dest-input");
  const destAutocompleteList = document.getElementById("dest-autocomplete-list");
  let debounceTimeout = null;

  function setupAutocomplete(inputEl, dropdownEl, onSelect) {
    inputEl.addEventListener("input", () => {
      clearTimeout(debounceTimeout);
      const query = inputEl.value.trim();
      
      if (query.length < 3) {
        dropdownEl.innerHTML = "";
        dropdownEl.classList.add("hidden");
        return;
      }
      
      debounceTimeout = setTimeout(() => {
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`)
          .then(res => res.json())
          .then(data => {
            dropdownEl.innerHTML = "";
            if (data && data.length > 0) {
              dropdownEl.classList.remove("hidden");
              data.forEach(item => {
                const div = document.createElement("div");
                div.className = "autocomplete-item";
                div.innerText = item.display_name;
                div.addEventListener("click", () => {
                  inputEl.value = item.display_name;
                  dropdownEl.innerHTML = "";
                  dropdownEl.classList.add("hidden");
                  onSelect(L.latLng(parseFloat(item.lat), parseFloat(item.lon)));
                });
                dropdownEl.appendChild(div);
              });
            } else {
              dropdownEl.classList.add("hidden");
            }
          })
          .catch(err => console.error("Nominatim geocoding error:", err));
      }, 300);
    });

    // Close list when clicking outside
    document.addEventListener("click", (e) => {
      if (e.target !== inputEl && e.target !== dropdownEl) {
        dropdownEl.innerHTML = "";
        dropdownEl.classList.add("hidden");
      }
    });
  }

  setupAutocomplete(addressInput, autocompleteList, (latlng) => {
    setStartPoint(latlng);
    map.setView(latlng, 13);
  });

  setupAutocomplete(destInput, destAutocompleteList, (latlng) => {
    setDestPoint(latlng);
    map.setView(latlng, 13);
  });

  function reverseGeocode(lat, lng) {
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.display_name) {
          addressInput.value = data.display_name;
        }
      })
      .catch(err => console.error("Reverse geocoding error:", err));
  }

  function reverseGeocodeDest(lat, lng) {
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.display_name) {
          destInput.value = data.display_name;
        }
      })
      .catch(err => console.error("Reverse geocoding error:", err));
  }

  // --- Geometry Utilities ---
  // Calculates coordinates from a start coordinate, distance in km and bearing in degrees
  function computeDestinationCoordinate(latlng, distance, bearing) {
    const R = 6371; // Earth radius in km
    const d = distance;
    const brng = (bearing * Math.PI) / 180; // convert to rad
    
    const lat1 = (latlng.lat * Math.PI) / 180;
    const lon1 = (latlng.lng * Math.PI) / 180;
    
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d / R) +
      Math.cos(lat1) * Math.sin(d / R) * Math.cos(brng)
    );
    
    const lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(d / R) * Math.cos(lat1),
      Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2)
    );
    
    return L.latLng((lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI);
  }

  // Returns bearing in degrees representing the chosen cardinal direction or auto-variations
  function getDirectionBearings(direction, altIdx) {
    let baseAngle = 0;
    
    // 1. Determine base cardinal direction angle
    if (direction === "any") {
      // By default, explore 3 entirely different directions: North, East-South-East, West-South-West
      const angles = [0, 120, 240];
      return angles[altIdx];
    }
    
    switch (direction) {
      case "N": baseAngle = 0; break;
      case "E": baseAngle = 90; break;
      case "S": baseAngle = 180; break;
      case "W": baseAngle = 270; break;
      default: baseAngle = 0;
    }
    
    // 2. Add variance for alternatives
    // Alt 0: Straight, Alt 1: -30 deg, Alt 2: +30 deg
    const offsets = [0, -30, 30];
    return (baseAngle + offsets[altIdx] + 360) % 360;
  }

  // --- UI Control Event Listeners ---
  // Mode Tabs
  const modeTabs = document.querySelectorAll(".mode-tab");
  modeTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      modeTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.mode = tab.dataset.mode;
      
      // Update UI panels according to mode
      const destGroup = document.getElementById("dest-group");
      const distanceGroup = document.getElementById("distance-group");
      const directionGroup = document.getElementById("direction-group");
      const instructionText = document.querySelector("#instruction-overlay p");

      if (state.mode === "point2point") {
        destGroup.classList.remove("hidden");
        distanceGroup.classList.add("hidden");
        directionGroup.classList.add("hidden");
        instructionText.innerText = "Définissez un point de départ et cliquez de nouveau sur la carte pour définir l'arrivée.";
      } else {
        destGroup.classList.add("hidden");
        distanceGroup.classList.remove("hidden");
        directionGroup.classList.remove("hidden");
        
        if (state.destMarker) {
          map.removeLayer(state.destMarker);
          state.destMarker = null;
          state.destLatLng = null;
          destInput.value = "";
        }
        
        if (state.mode === "loop") {
          instructionText.innerText = "Cliquez n'importe où sur la carte pour définir le point de départ de votre boucle cycliste.";
        } else if (state.mode === "outback") {
          instructionText.innerText = "Cliquez n'importe où sur la carte pour définir le point de départ de votre aller-retour.";
        }
      }
    });
  });

  // Range Sliders
  const distanceSlider = document.getElementById("distance-slider");
  const distanceVal = document.getElementById("distance-val");
  distanceSlider.addEventListener("input", (e) => {
    state.targetDistance = parseInt(e.target.value);
    distanceVal.innerText = state.targetDistance;
  });

  const toleranceSlider = document.getElementById("tolerance-slider");
  const toleranceVal = document.getElementById("tolerance-val");
  toleranceSlider.addEventListener("input", (e) => {
    state.tolerance = parseInt(e.target.value);
    toleranceVal.innerText = state.tolerance;
  });

  // Direction Selection
  const dirButtons = document.querySelectorAll(".dir-btn");
  dirButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      dirButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.direction = btn.dataset.dir;
    });
  });

  // Toggles
  const strictRoadToggle = document.getElementById("strict-road-toggle");
  strictRoadToggle.addEventListener("change", (e) => {
    state.strictRoad = e.target.checked;
  });

  const avoidTrafficToggle = document.getElementById("avoid-traffic-toggle");
  avoidTrafficToggle.addEventListener("change", (e) => {
    state.avoidTraffic = e.target.checked;
  });

  // --- Route Generation Controller ---
  const generateBtn = document.getElementById("generate-btn");
  generateBtn.addEventListener("click", () => {
    if (!state.startLatLng) {
      alert("Veuillez sélectionner un point de départ.");
      return;
    }
    if (state.mode === "point2point" && !state.destLatLng) {
      alert("Veuillez sélectionner un point d'arrivée.");
      return;
    }
    
    generateRoutes();
  });

  // Main Route Generation Routine
  async function generateRoutes() {
    // Show spinner & disable button
    generateBtn.disabled = true;
    generateBtn.querySelector(".spinner").classList.remove("hidden");
    generateBtn.querySelector(".btn-text").innerText = "Calcul des itinéraires...";
    
    // Clear existing layers
    clearRouteLayers();
    
    try {
      const promises = [];
      const alternativeNames = [
        state.mode === "loop" ? "Option A : Équilibrée" : "Option A : Directe",
        state.mode === "loop" ? "Option B : Teardrop" : "Option B : Calme",
        state.mode === "loop" ? "Option C : Wide" : "Option C : Alternative"
      ];
      
      for (let idx = 0; idx < 3; idx++) {
        promises.push(fetchAlternativeRoute(idx));
      }
      
      const results = await Promise.all(promises);
      
      // Filter out failed routings
      const validResults = results.filter(r => r !== null);
      
      if (validResults.length === 0) {
        alert("Impossible de générer des itinéraires avec les contraintes spécifiées. Essayez d'autres options.");
        return;
      }
      
      // Update state and render
      validResults.forEach(r => {
        state.routesData[r.idx] = r.data;
        renderRoute(r.idx, r.data);
      });
      
      // Fit bounds to show all routes
      const validPolylines = state.polylines.filter(p => p !== null);
      if (validPolylines.length > 0) {
        const group = L.featureGroup(validPolylines);
        map.fitBounds(group.getBounds().pad(0.1));
      }
      
      // Show results sidebar
      displayRouteStats(validResults);
      document.getElementById("results-panel").classList.remove("hidden");
      
      // Make Route A active by default
      setActiveRoute(validResults[0].idx);
      
    } catch (err) {
      console.error(err);
      alert("Une erreur est survenue lors de la communication avec le service de routage.");
    } finally {
      // Hide spinner & enable button
      generateBtn.disabled = false;
      generateBtn.querySelector(".spinner").classList.add("hidden");
      generateBtn.querySelector(".btn-text").innerText = "Générer les alternatives";
    }
  }

  // Clear existing graphics
  function clearRouteLayers() {
    state.polylines.forEach((poly, idx) => {
      if (poly) {
        map.removeLayer(poly);
        state.polylines[idx] = null;
      }
    });
    state.waypointMarkers.forEach(m => map.removeLayer(m));
    state.waypointMarkers = [];
    state.routesData = [null, null, null];
    document.getElementById("results-panel").classList.add("hidden");
  }

  // Fetch individual alternative route (with iterative distance fitting)
  async function fetchAlternativeRoute(idx) {
    const profile = getBRouterProfile();
    
    if (state.mode === "point2point") {
      // For A to B, BRouter can return alternatives using the `alternativeidx` parameter
      const url = `https://brouter.de/brouter?lonlats=${state.startLatLng.lng},${state.startLatLng.lat}|${state.destLatLng.lng},${state.destLatLng.lat}&profile=${profile}&alternativeidx=${idx}&format=geojson`;
      const data = await queryBRouter(url);
      return data ? { idx, data } : null;
    }
    
    // For Loop and Outback modes, we generate custom waypoints and fit the distance dynamically
    const bearing = getDirectionBearings(state.direction, idx);
    let detourFactor = 1.25; // standard road detour factor
    let loopCoordinates = [];
    
    // We do up to 2 fitting iterations
    for (let iter = 0; iter < 2; iter++) {
      if (state.mode === "loop") {
        loopCoordinates = calculateLoopWaypoints(state.startLatLng, state.targetDistance, bearing, idx, detourFactor);
      } else if (state.mode === "outback") {
        loopCoordinates = calculateOutbackWaypoints(state.startLatLng, state.targetDistance, bearing, detourFactor);
      }
      
      // Construct lonlats query param
      const coordsString = loopCoordinates.map(c => `${c.lng},${c.lat}`).join("|");
      const url = `https://brouter.de/brouter?lonlats=${coordsString}&profile=${profile}&alternativeidx=0&format=geojson`;
      
      const data = await queryBRouter(url);
      
      if (!data) return null;
      
      const actualDist = parseFloat(data.features[0].properties["track-length"]) / 1000; // to km
      const error = Math.abs(actualDist - state.targetDistance);
      
      // If the distance is within tolerance, or if it is the last iteration, return it!
      if (error <= state.tolerance || iter === 1) {
        // Draw waypoint markers on map for debugging/visualization (only for loop)
        if (iter === 1 || error <= state.tolerance) {
          // Render waypoint indicators on map
          if (loopCoordinates.length > 2) {
            loopCoordinates.slice(1, -1).forEach((w, wIdx) => {
              const icon = L.divIcon({
                className: 'custom-waypoint-marker',
                html: `<span>${String.fromCharCode(65 + idx)}${wIdx + 1}</span>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
              });
              const m = L.marker(w, { icon }).addTo(map);
              state.waypointMarkers.push(m);
            });
          }
        }
        return { idx, data };
      }
      
      // Adjust detour factor for next iteration:
      // If actual is 60km and target is 50km, we need shorter straight lines.
      // New factor is scaled based on how much BRouter deviated.
      const ratio = actualDist / state.targetDistance;
      detourFactor = detourFactor * ratio;
    }
    
    return null;
  }

  // Queries BRouter backend
  async function queryBRouter(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      console.error("BRouter API query failed:", e);
      return null;
    }
  }

  // Map user selections to BRouter profiles
  function getBRouterProfile() {
    const bikeType = state.strictRoad ? "strictRoad" : "gravel";
    const trafficSetting = state.avoidTraffic ? "lowtraffic" : "standard";
    return ROUTING_PROFILES[bikeType][trafficSetting];
  }

  // Loop Waypoint Placement Geometry
  function calculateLoopWaypoints(startLatLng, totalDist, mainBearing, altIdx, detourFactor) {
    // We want the total route road distance to be totalDist.
    // The straight-line perimeter of our triangle is approx totalDist / detourFactor.
    const targetPerimeter = totalDist / detourFactor;
    
    let segmentLength = 0;
    let angleOffset = 0;
    
    // We define three distinct triangle shapes:
    // Alt 0: Balanced Equilateral Triangle (angle offset 30 deg, side S = P / 3)
    // Alt 1: Narrow Teardrop (angle offset 15 deg, side S = P / 2.52)
    // Alt 2: Wide Round (angle offset 45 deg, side S = P / 3.41)
    
    if (altIdx === 0) {
      angleOffset = 30;
      segmentLength = targetPerimeter / 3.0;
    } else if (altIdx === 1) {
      angleOffset = 15;
      segmentLength = targetPerimeter / 2.52;
    } else {
      angleOffset = 45;
      segmentLength = targetPerimeter / 3.41;
    }
    
    const bearingW1 = (mainBearing - angleOffset + 360) % 360;
    const bearingW2 = (mainBearing + angleOffset + 360) % 360;
    
    const w1 = computeDestinationCoordinate(startLatLng, segmentLength, bearingW1);
    const w2 = computeDestinationCoordinate(startLatLng, segmentLength, bearingW2);
    
    return [startLatLng, w1, w2, startLatLng];
  }

  // Outback Waypoint Placement Geometry
  function calculateOutbackWaypoints(startLatLng, totalDist, mainBearing, detourFactor) {
    // For an out-and-back, we go to a single midpoint at distance D / 2.
    // Road distance is D, so straight line distance is D / (2 * detourFactor).
    const midDist = totalDist / (2 * detourFactor);
    const midpoint = computeDestinationCoordinate(startLatLng, midDist, mainBearing);
    
    return [startLatLng, midpoint, startLatLng];
  }

  // --- Rendering Routes ---
  function renderRoute(idx, geojsonData) {
    const routeCoordinates = geojsonData.features[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
    
    const color = ROUTE_ACCENTS[idx];
    
    const polyline = L.polyline(routeCoordinates, {
      color: color,
      weight: 4,
      opacity: 0.75,
      lineJoin: "round"
    }).addTo(map);
    
    // Interactive hovering
    polyline.on("mouseover", () => {
      if (state.activeRouteIdx !== idx) {
        polyline.setStyle({ opacity: 0.95, weight: 6 });
      }
    });
    
    polyline.on("mouseout", () => {
      if (state.activeRouteIdx !== idx) {
        polyline.setStyle({ opacity: 0.5, weight: 4 });
      }
    });

    polyline.on("click", () => {
      setActiveRoute(idx);
    });
    
    state.polylines[idx] = polyline;
  }

  // Sets a route active in UI and highlights it on Map
  function setActiveRoute(idx) {
    state.activeRouteIdx = idx;
    
    // 1. Highlight Route Card
    const cards = document.querySelectorAll(".route-card");
    cards.forEach(card => {
      card.classList.remove("active");
      if (parseInt(card.dataset.routeIdx) === idx) {
        card.classList.add("active");
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    
    // 2. Highlight Polyline
    state.polylines.forEach((poly, i) => {
      if (poly) {
        if (i === idx) {
          poly.setStyle({
            weight: 7,
            opacity: 1.0
          });
          poly.bringToFront();
        } else {
          poly.setStyle({
            weight: 4,
            opacity: 0.3
          });
        }
      }
    });
  }

  // Populate Sidebar Stats Cards
  function displayRouteStats(validResults) {
    const cards = document.querySelectorAll(".route-card");
    
    // Hide all cards initially
    cards.forEach(c => c.classList.add("hidden"));
    
    validResults.forEach(res => {
      const idx = res.idx;
      const data = res.data;
      const card = document.querySelector(`.route-card[data-route-idx="${idx}"]`);
      
      if (!card) return;
      
      card.classList.remove("hidden");
      
      const props = data.features[0].properties;
      const distanceKm = (parseFloat(props["track-length"]) / 1000).toFixed(1);
      const elevationM = props["filtered ascend"] || props["filtered-ascend"] || "0";
      
      // Calculate duration formatted
      const seconds = parseInt(props["total-time"]);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const durationStr = hours > 0 ? `${hours}h ${minutes}min` : `${minutes} min`;
      
      card.querySelector(".route-dist").innerText = distanceKm;
      card.querySelector(".route-elev").innerText = elevationM;
      card.querySelector(".route-time").innerText = durationStr;
      
      // Attach active trigger
      card.onclick = (e) => {
        // Prevent click if clicking child buttons
        if (e.target.closest(".route-actions")) return;
        setActiveRoute(idx);
      };
      
      // Setup Export Buttons
      setupCardExports(card, idx, data, distanceKm);
    });
  }

  // --- Export Functionalities ---
  function setupCardExports(card, idx, data, distanceKm) {
    const props = data.features[0].properties;
    const geometry = data.features[0].geometry;
    
    // 1. GPX Button
    const gpxBtn = card.querySelector(".export-gpx");
    gpxBtn.onclick = () => {
      downloadGPX(geometry.coordinates, distanceKm);
    };
    
    // 2. Google Maps Button
    const gmapsBtn = card.querySelector(".export-gmaps");
    gmapsBtn.onclick = () => {
      openGoogleMaps(geometry.coordinates);
    };
    
    // 3. Apple Maps Button
    const amapsBtn = card.querySelector(".export-amaps");
    amapsBtn.onclick = () => {
      openAppleMaps(geometry.coordinates);
    };
  }

  // Generate and Download GPX File
  function downloadGPX(coordinates, distance) {
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BikeRoadManager" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Boucle BikeRoad ${distance}km</name>
    <desc>Itinéraire vélo généré par BikeRoadManager</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>Boucle ${distance}km</name>
    <trkseg>`;

    coordinates.forEach(coord => {
      const lon = coord[0];
      const lat = coord[1];
      const ele = coord[2] !== undefined ? coord[2] : 0.0;
      gpx += `
      <trkpt lat="${lat}" lon="${lon}">
        <ele>${ele}</ele>
      </trkpt>`;
    });

    gpx += `
    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `boucle_bikeroad_${distance}km.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Opens directions in Google Maps using strategic waypoints
  function openGoogleMaps(coordinates) {
    const len = coordinates.length;
    if (len < 2) return;
    
    const start = coordinates[0];
    const end = coordinates[len - 1];
    
    // Choose waypoints to force the shape of the loop.
    // For a triangle, waypoints at 1/3 and 2/3 of coordinates index are perfect!
    const wp1 = coordinates[Math.floor(len * 0.33)];
    const wp2 = coordinates[Math.floor(len * 0.66)];
    
    const origin = `${start[1]},${start[0]}`;
    const destination = `${end[1]},${end[0]}`;
    const waypoints = `${wp1[1]},${wp1[0]}|${wp2[1]},${wp2[0]}`;
    
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${encodeURIComponent(waypoints)}&travelmode=bicycling`;
    window.open(url, "_blank");
  }

  // Opens directions in Apple Maps using waypoints
  function openAppleMaps(coordinates) {
    const len = coordinates.length;
    if (len < 2) return;
    
    const start = coordinates[0];
    const wp1 = coordinates[Math.floor(len * 0.33)];
    const wp2 = coordinates[Math.floor(len * 0.66)];
    const end = coordinates[len - 1];
    
    // Apple Maps structures multi-stop routing as successive daddr parameters:
    const saddr = `${start[1]},${start[0]}`;
    const daddrs = [
      `${wp1[1]},${wp1[0]}`,
      `${wp2[1]},${wp2[0]}`,
      `${end[1]},${end[0]}`
    ].map(coords => `daddr=${coords}`).join("&");
    
    const url = `https://maps.apple.com/?saddr=${saddr}&${daddrs}&dirflg=b`;
    window.open(url, "_blank");
  }

  // Setup locate trigger on load
  document.getElementById("locate-btn").onclick = geolocateUser;

  // Center on Paris by default initially
  geolocateUser(); // Trigger geolocation on load to make start experience fluid
});
