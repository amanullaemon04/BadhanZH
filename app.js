// Supabase Client Initialization
const supabaseUrl = window.SUPABASE_URL || "https://qqwuweskgtoqigfvvfso.supabase.co";
const supabaseAnonKey = window.SUPABASE_ANON_KEY || "sb_publishable_A1qWn9h-TYg1dXxOgbYlxg_MXanpCxA";
const supabaseClient = supabase.createClient(supabaseUrl, supabaseAnonKey);

// DOM Elements
const bloodSelect = document.getElementById("blood");
const citySelect = document.getElementById("city");
const locationInput = document.getElementById("location");
const statusSelect = document.getElementById("status");
const resultsContainer = document.getElementById("results");
const countDisplay = document.getElementById("count");

// Normalizer helper
function normalizeBlood(bg) {
  if (!bg) return "";
  return bg.replace(/\s+/g, "").toUpperCase();
}

// Function to calculate donation status and estimated next donation date (90-day rule)
function getDonationStatus(donor) {
  let isAvailable = true;
  let nextDateStr = null;

  // 1. Calculate 90 days rule from last_donation date
  if (donor.last_donation) {
    const donationDate = new Date(donor.last_donation);
    if (!isNaN(donationDate.getTime())) {
      const nextEligibleDate = new Date(donationDate);
      nextEligibleDate.setDate(nextEligibleDate.getDate() + 90);

      const today = new Date();
      if (today < nextEligibleDate) {
        isAvailable = false;
        nextDateStr = nextEligibleDate.toISOString().split("T")[0];
      }
    }
  }

  // 2. Explicitly unavailable in DB
  if (donor.status && donor.status.toLowerCase() === "unavailable") {
    isAvailable = false;
  }

  // 3. Manual override if available
  if (donor.phone === "01608575239" && donor.status && donor.status.toLowerCase() === "available") {
    isAvailable = true;
  }

  return { isAvailable, nextDateStr };
}

// Fetch & Filter Donors
async function fetchDonors() {
  const selectedBlood = bloodSelect ? normalizeBlood(bloodSelect.value) : "";
  const selectedCity = citySelect ? citySelect.value.trim().toLowerCase() : "";
  const selectedLocation = locationInput ? locationInput.value.trim().toLowerCase() : "";
  const selectedStatus = statusSelect ? statusSelect.value.trim().toLowerCase() : "";

  // Require City or Location to show donors
  if (!selectedCity && !selectedLocation) {
    if (countDisplay) countDisplay.textContent = "0";
    if (resultsContainer) {
      resultsContainer.innerHTML = `
        <div class="no-results">
          Please select a City or enter a Specific Location to view donors.
        </div>
      `;
    }
    return;
  }

  if (resultsContainer) {
    resultsContainer.innerHTML = `<div class="no-results">ডোনারদের তথ্য খোঁজা হচ্ছে...</div>`;
  }

  try {
    let query = supabaseClient
      .from("donors")
      .select("*")
      .eq("verified", true);

    const { data, error } = await query;
    if (error) throw error;

    let donors = data || [];

    // Filter Blood Group
    if (selectedBlood) {
      donors = donors.filter(d => normalizeBlood(d.blood_group) === selectedBlood);
    }

    // Filter City
    if (selectedCity) {
      donors = donors.filter(d => (d.city || "").toLowerCase().includes(selectedCity));
    }

    // Filter Specific Location
    if (selectedLocation) {
      donors = donors.filter(d => 
        (d.location && d.location.toLowerCase().includes(selectedLocation)) ||
        (d.city && d.city.toLowerCase().includes(selectedLocation))
      );
    }

    // Filter Status if explicitly selected
    if (selectedStatus) {
      donors = donors.filter(d => {
        const { isAvailable } = getDonationStatus(d);
        return selectedStatus === "available" ? isAvailable : !isAvailable;
      });
    }

    // SORTING: Available donors first, Unavailable donors below
    donors.sort((a, b) => {
      const aAvail = getDonationStatus(a).isAvailable ? 1 : 0;
      const bAvail = getDonationStatus(b).isAvailable ? 1 : 0;
      return bAvail - aAvail; // 1 (Available) age ashbe, 0 (Unavailable) pore
    });

    renderDonors(donors);
  } catch (err) {
    console.error("Error fetching donors:", err);
    if (resultsContainer) {
      resultsContainer.innerHTML = `
        <div class="no-results" style="color: var(--danger);">
          তথ্য লোড করতে সমস্যা হয়েছে: ${err.message}
        </div>
      `;
    }
    if (countDisplay) countDisplay.textContent = "0";
  }
}

// Render Donors
function renderDonors(donors) {
  if (countDisplay) countDisplay.textContent = donors.length;

  if (donors.length === 0) {
    resultsContainer.innerHTML = `
      <div class="no-results">
        কোনো রক্তদাতার তথ্য পাওয়া যায়নি। অন্য ফিল্টার দিয়ে চেষ্টা করুন।
      </div>
    `;
    return;
  }

  resultsContainer.innerHTML = donors.map(donor => {
    const { isAvailable, nextDateStr } = getDonationStatus(donor);
    const statusClass = isAvailable ? "status-available" : "status-unavailable";
    const statusText = isAvailable ? "AVAILABLE" : "UNAVAILABLE";

    let lastDonationHtml = "";
    if (donor.last_donation) {
      lastDonationHtml = `<span>সর্বশেষ রক্তদান: <strong>${escapeHtml(donor.last_donation)}</strong></span>`;
    }

    let nextAvailableHtml = "";
    if (!isAvailable && nextDateStr) {
      nextAvailableHtml = `<span>পরবর্তী রক্তদান: <strong style="color: #b91c1c;">${escapeHtml(nextDateStr)}</strong> থেকে সম্ভাব্য</span>`;
    }

    return `
      <div class="donor-card">
        <div class="donor-header">
          <h3>${escapeHtml(donor.name)}</h3>
          <span class="blood-badge">${escapeHtml(donor.blood_group)}</span>
        </div>

        <div>
          <span class="donor-status ${statusClass}">${statusText}</span>
        </div>

        <div class="donor-details">
          <span>ঠিকানা: <strong>${escapeHtml(donor.location || 'N/A')}, ${escapeHtml(donor.city || '')}</strong></span>
          ${lastDonationHtml}
          ${nextAvailableHtml}
        </div>

        <div style="display: flex; gap: 8px; margin-top: 6px;">
          <a href="tel:${escapeHtml(donor.phone)}" class="contact-btn" style="flex: 1; text-align: center;">
            📞 কল করুন
          </a>
          <button 
            type="button" 
            onclick="reportDonor('${donor.id}', '${escapeAttr(donor.name)}', '${escapeAttr(donor.phone)}')" 
            class="report-btn" 
            style="background: rgba(220, 38, 38, 0.12); color: #dc2626; border: 1.5px solid rgba(220, 38, 38, 0.4); padding: 8px 12px; border-radius: 6px; font-weight: 700; cursor: pointer; white-space: nowrap;">
            ⚠️ রিপোর্ট
          </button>
        </div>
      </div>
    `;
  }).join("");
}

// Patient Report Feature
async function reportDonor(id, name, phone) {
  const reason = prompt(
    `${name}-এর বিষয়ে রিপোর্ট জানান:\n1. রক্ত দিয়ে ফেলেছেন (অপ্রাপ্য)\n2. ফোন বন্ধ / ধরছেন না\n3. ভুল নম্বর / অস্তিত্ব নেই\n\n(কারণটি সংক্ষেপে লিখুন):`
  );

  if (!reason || reason.trim() === "") return;

  try {
    const { error } = await supabaseClient
      .from('reports')
      .insert([{
        donor_id: id,
        donor_name: name,
        donor_phone: phone,
        reason: reason.trim(),
        report_status: 'pending'
      }]);

    if (error) throw error;
    alert("আপনার রিপোর্টটি সফলভাবে জমা হয়েছে। দ্রুত যাচাই করে ব্যবস্থা নেওয়া হবে। ধন্যবাদ!");
  } catch (err) {
    alert("রিপোর্ট জমা দিতে সমস্যা হয়েছে: " + err.message);
  }
}

// Helpers
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(str) {
  if (!str) return "";
  return String(str).replace(/'/g, "\\'");
}

// Listeners
if (bloodSelect) bloodSelect.addEventListener("change", fetchDonors);
if (citySelect) citySelect.addEventListener("change", fetchDonors);
if (statusSelect) statusSelect.addEventListener("change", fetchDonors);
if (locationInput) {
  let debounceTimeout;
  locationInput.addEventListener("input", () => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(fetchDonors, 300);
  });
}

// Initial Load
document.addEventListener("DOMContentLoaded", fetchDonors);
