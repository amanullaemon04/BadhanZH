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

// Fetch & Filter Donors
async function fetchDonors() {
  const blood = bloodSelect ? bloodSelect.value.trim() : "";
  const city = citySelect ? citySelect.value.trim() : "";
  const location = locationInput ? locationInput.value.trim().toLowerCase() : "";
  const status = statusSelect ? statusSelect.value.trim() : "";

  // Prompt user if no initial filter is selected to optimize initial render
  if (!blood && !city && !location) {
    countDisplay.textContent = "0";
    resultsContainer.innerHTML = `
      <div class="no-results">
        Please select a Blood Group, City, or enter a Specific Location to view donors.
      </div>
    `;
    return;
  }

  resultsContainer.innerHTML = `<div class="no-results">ডোনারদের তথ্য খোঁজা হচ্ছে...</div>`;

  try {
    let query = supabaseClient
      .from("donors")
      .select("*")
      .eq("verified", true); // Only verified donors

    if (blood) {
      query = query.eq("blood_group", blood);
    }

    if (city) {
      query = query.ilike("city", `%${city}%`);
    }

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Filter location in memory if user typed specific place
    let filteredData = data || [];
    if (location) {
      filteredData = filteredData.filter(d => 
        (d.location && d.location.toLowerCase().includes(location)) ||
        (d.city && d.city.toLowerCase().includes(location))
      );
    }

    renderDonors(filteredData);
  } catch (err) {
    console.error("Error fetching donors:", err);
    resultsContainer.innerHTML = `
      <div class="no-results" style="color: var(--danger);">
        তথ্য লোড করতে সমস্যা হয়েছে: ${err.message}
      </div>
    `;
    countDisplay.textContent = "0";
  }
}

// Render Donors to UI
function renderDonors(donors) {
  countDisplay.textContent = donors.length;

  if (donors.length === 0) {
    resultsContainer.innerHTML = `
      <div class="no-results">
        কোনো রক্তদাতার তথ্য পাওয়া যায়নি। অন্য ফিল্টার দিয়ে চেষ্টা করুন।
      </div>
    `;
    return;
  }

  resultsContainer.innerHTML = donors.map(donor => {
    const isAvailable = (donor.status || 'available') === 'available';
    const statusClass = isAvailable ? 'status-available' : 'status-unavailable';
    const statusText = isAvailable ? 'Available' : 'Unavailable';

    // Format last donation date if available
    let donationInfo = "";
    if (donor.last_donation) {
      donationInfo = `<span>সর্বশেষ রক্তদান: <strong>${donor.last_donation}</strong></span>`;
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
          ${donationInfo}
        </div>

        <div style="display: flex; gap: 8px; margin-top: 6px;">
          <a href="tel:${donor.phone}" class="contact-btn" style="flex: 1; text-align: center;">
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

// Helper to escape HTML tags to prevent XSS
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

// Event Listeners
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
